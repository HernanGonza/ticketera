CREATE TYPE "public"."estado_ticket" AS ENUM('nuevo', 'asignado', 'en_curso', 'en_espera', 'resuelto', 'cerrado', 'cancelado');--> statement-breakpoint
CREATE TYPE "public"."modo_asignacion" AS ENUM('manual', 'fija', 'round_robin');--> statement-breakpoint
CREATE TYPE "public"."prioridad" AS ENUM('baja', 'media', 'alta', 'critica');--> statement-breakpoint
CREATE TYPE "public"."rol" AS ENUM('solicitante', 'tecnico', 'admin');--> statement-breakpoint
CREATE TABLE "adjuntos" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"mensaje_id" uuid,
	"ruta" text NOT NULL,
	"nombre" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"interno" boolean DEFAULT false NOT NULL,
	"subido_por_id" uuid NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adjuntos_bytes_ck" CHECK ("adjuntos"."bytes" >= 0)
);
--> statement-breakpoint
CREATE TABLE "areas" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"activo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categorias" (
	"id" serial PRIMARY KEY NOT NULL,
	"nombre" text NOT NULL,
	"descripcion" text DEFAULT '' NOT NULL,
	"icono" text DEFAULT 'circle-help' NOT NULL,
	"padre_id" integer,
	"prioridad_default" "prioridad" DEFAULT 'media' NOT NULL,
	"sla_respuesta_min" integer NOT NULL,
	"sla_resolucion_min" integer NOT NULL,
	"campos" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"modo_asignacion" "modo_asignacion" DEFAULT 'manual' NOT NULL,
	"tecnico_default_id" uuid,
	"activa" boolean DEFAULT true NOT NULL,
	"orden" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "categorias_sla_ck" CHECK ("categorias"."sla_respuesta_min" > 0 and "categorias"."sla_resolucion_min" > 0)
);
--> statement-breakpoint
CREATE TABLE "configuracion" (
	"clave" text PRIMARY KEY NOT NULL,
	"valor" jsonb NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contadores_codigo" (
	"anio" integer PRIMARY KEY NOT NULL,
	"ultimo" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "lecturas" (
	"usuario_id" uuid NOT NULL,
	"ticket_id" uuid NOT NULL,
	"ultimo_mensaje_id" uuid,
	"ultimo_mensaje_at" timestamp with time zone NOT NULL,
	"leido_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "lecturas_usuario_id_ticket_id_pk" PRIMARY KEY("usuario_id","ticket_id")
);
--> statement-breakpoint
CREATE TABLE "mensajes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"ticket_id" uuid NOT NULL,
	"autor_id" uuid NOT NULL,
	"cuerpo" text NOT NULL,
	"interno" boolean DEFAULT false NOT NULL,
	"cliente_id" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"editado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "notificaciones" (
	"id" serial PRIMARY KEY NOT NULL,
	"usuario_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"payload" jsonb NOT NULL,
	"leida" boolean DEFAULT false NOT NULL,
	"creada_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox_eventos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"tipo" text NOT NULL,
	"payload" jsonb NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"publicado_at" timestamp with time zone,
	"intentos" integer DEFAULT 0 NOT NULL,
	"ultimo_error" text
);
--> statement-breakpoint
CREATE TABLE "portal_jti" (
	"jti" text PRIMARY KEY NOT NULL,
	"expira_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recuperaciones_password" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"token_hash" text,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"usado_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "respuestas_rapidas" (
	"id" serial PRIMARY KEY NOT NULL,
	"titulo" text NOT NULL,
	"cuerpo" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sesiones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" uuid NOT NULL,
	"familia" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expira_at" timestamp with time zone NOT NULL,
	"usado_at" timestamp with time zone,
	"revocado_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "ticket_eventos" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"ticket_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"de" text,
	"a" text,
	"usuario_id" uuid,
	"fecha" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"codigo" text DEFAULT '' NOT NULL,
	"titulo" text NOT NULL,
	"descripcion" text NOT NULL,
	"categoria_id" integer NOT NULL,
	"prioridad" "prioridad" NOT NULL,
	"estado" "estado_ticket" DEFAULT 'nuevo' NOT NULL,
	"solicitante_id" uuid NOT NULL,
	"area_id" integer,
	"asignado_id" uuid,
	"ubicacion" text,
	"datos" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"orden_kanban" numeric DEFAULT 0 NOT NULL,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"primera_respuesta_at" timestamp with time zone,
	"resuelto_at" timestamp with time zone,
	"cerrado_at" timestamp with time zone,
	"sla_respuesta_min" integer NOT NULL,
	"sla_resolucion_min" integer NOT NULL,
	"vence_respuesta_at" timestamp with time zone,
	"vence_resolucion_at" timestamp with time zone,
	"minutos_en_espera" integer DEFAULT 0 NOT NULL,
	"en_espera_desde" timestamp with time zone,
	"min_primera_respuesta" integer,
	"min_resolucion" integer,
	"alertas_sla" text[] DEFAULT '{}'::text[] NOT NULL,
	"autocierre_at" timestamp with time zone,
	"reabierto" integer DEFAULT 0 NOT NULL,
	"calificacion" integer,
	"comentario_calificacion" text,
	"version" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "tickets_calificacion_ck" CHECK ("tickets"."calificacion" between 1 and 5)
);
--> statement-breakpoint
CREATE TABLE "usuarios" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"nombre" text NOT NULL,
	"area_id" integer,
	"rol" "rol" DEFAULT 'solicitante' NOT NULL,
	"password_hash" text,
	"activo" boolean DEFAULT true NOT NULL,
	"ultimo_acceso" timestamp with time zone,
	"creado_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actualizado_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_mensaje_id_mensajes_id_fk" FOREIGN KEY ("mensaje_id") REFERENCES "public"."mensajes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "adjuntos" ADD CONSTRAINT "adjuntos_subido_por_id_usuarios_id_fk" FOREIGN KEY ("subido_por_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_padre_id_categorias_id_fk" FOREIGN KEY ("padre_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categorias" ADD CONSTRAINT "categorias_tecnico_default_id_usuarios_id_fk" FOREIGN KEY ("tecnico_default_id") REFERENCES "public"."usuarios"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturas" ADD CONSTRAINT "lecturas_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturas" ADD CONSTRAINT "lecturas_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lecturas" ADD CONSTRAINT "lecturas_ultimo_mensaje_id_mensajes_id_fk" FOREIGN KEY ("ultimo_mensaje_id") REFERENCES "public"."mensajes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mensajes" ADD CONSTRAINT "mensajes_autor_id_usuarios_id_fk" FOREIGN KEY ("autor_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notificaciones" ADD CONSTRAINT "notificaciones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recuperaciones_password" ADD CONSTRAINT "recuperaciones_password_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sesiones" ADD CONSTRAINT "sesiones_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_eventos" ADD CONSTRAINT "ticket_eventos_ticket_id_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."tickets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ticket_eventos" ADD CONSTRAINT "ticket_eventos_usuario_id_usuarios_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_categoria_id_categorias_id_fk" FOREIGN KEY ("categoria_id") REFERENCES "public"."categorias"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_solicitante_id_usuarios_id_fk" FOREIGN KEY ("solicitante_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tickets" ADD CONSTRAINT "tickets_asignado_id_usuarios_id_fk" FOREIGN KEY ("asignado_id") REFERENCES "public"."usuarios"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usuarios" ADD CONSTRAINT "usuarios_area_id_areas_id_fk" FOREIGN KEY ("area_id") REFERENCES "public"."areas"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "adjuntos_ticket_idx" ON "adjuntos" USING btree ("ticket_id","creado_at");--> statement-breakpoint
CREATE INDEX "adjuntos_mensaje_idx" ON "adjuntos" USING btree ("mensaje_id");--> statement-breakpoint
CREATE UNIQUE INDEX "areas_nombre_uq" ON "areas" USING btree (lower("nombre"));--> statement-breakpoint
CREATE UNIQUE INDEX "categorias_nombre_uq" ON "categorias" USING btree (lower("nombre"));--> statement-breakpoint
CREATE INDEX "categorias_orden_idx" ON "categorias" USING btree ("orden");--> statement-breakpoint
CREATE INDEX "lecturas_ticket_idx" ON "lecturas" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "mensajes_ticket_idx" ON "mensajes" USING btree ("ticket_id","creado_at");--> statement-breakpoint
CREATE INDEX "mensajes_publicos_idx" ON "mensajes" USING btree ("ticket_id","creado_at") WHERE not "mensajes"."interno";--> statement-breakpoint
CREATE INDEX "mensajes_autor_idx" ON "mensajes" USING btree ("autor_id","ticket_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mensajes_cliente_uq" ON "mensajes" USING btree ("ticket_id","autor_id","cliente_id") WHERE "mensajes"."cliente_id" is not null;--> statement-breakpoint
CREATE INDEX "notificaciones_usuario_idx" ON "notificaciones" USING btree ("usuario_id","id");--> statement-breakpoint
CREATE INDEX "notificaciones_sin_leer_idx" ON "notificaciones" USING btree ("usuario_id") WHERE not "notificaciones"."leida";--> statement-breakpoint
CREATE INDEX "outbox_pendientes_idx" ON "outbox_eventos" USING btree ("id") WHERE "outbox_eventos"."publicado_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_publicados_idx" ON "outbox_eventos" USING btree ("publicado_at");--> statement-breakpoint
CREATE INDEX "portal_jti_expira_idx" ON "portal_jti" USING btree ("expira_at");--> statement-breakpoint
CREATE UNIQUE INDEX "recuperaciones_token_uq" ON "recuperaciones_password" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "recuperaciones_usuario_idx" ON "recuperaciones_password" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "recuperaciones_expira_idx" ON "recuperaciones_password" USING btree ("expira_at");--> statement-breakpoint
CREATE UNIQUE INDEX "sesiones_token_uq" ON "sesiones" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sesiones_usuario_idx" ON "sesiones" USING btree ("usuario_id");--> statement-breakpoint
CREATE INDEX "sesiones_familia_idx" ON "sesiones" USING btree ("familia");--> statement-breakpoint
CREATE INDEX "sesiones_expira_idx" ON "sesiones" USING btree ("expira_at");--> statement-breakpoint
CREATE INDEX "ticket_eventos_ticket_idx" ON "ticket_eventos" USING btree ("ticket_id","id");--> statement-breakpoint
CREATE INDEX "ticket_eventos_tipo_fecha_idx" ON "ticket_eventos" USING btree ("tipo","fecha");--> statement-breakpoint
CREATE UNIQUE INDEX "tickets_codigo_uq" ON "tickets" USING btree ("codigo");--> statement-breakpoint
CREATE INDEX "tickets_kanban_idx" ON "tickets" USING btree ("estado","orden_kanban");--> statement-breakpoint
CREATE INDEX "tickets_cerrados_idx" ON "tickets" USING btree ("cerrado_at") WHERE "tickets"."estado" = 'cerrado';--> statement-breakpoint
CREATE INDEX "tickets_solicitante_idx" ON "tickets" USING btree ("solicitante_id","actualizado_at");--> statement-breakpoint
CREATE INDEX "tickets_area_idx" ON "tickets" USING btree ("area_id","actualizado_at");--> statement-breakpoint
CREATE INDEX "tickets_asignado_idx" ON "tickets" USING btree ("asignado_id","estado");--> statement-breakpoint
CREATE INDEX "tickets_categoria_idx" ON "tickets" USING btree ("categoria_id");--> statement-breakpoint
CREATE INDEX "tickets_creado_idx" ON "tickets" USING btree ("creado_at");--> statement-breakpoint
CREATE INDEX "tickets_actualizado_idx" ON "tickets" USING btree ("actualizado_at");--> statement-breakpoint
CREATE INDEX "tickets_resuelto_idx" ON "tickets" USING btree ("resuelto_at");--> statement-breakpoint
CREATE INDEX "tickets_autocierre_idx" ON "tickets" USING btree ("autocierre_at") WHERE "tickets"."estado" = 'resuelto';--> statement-breakpoint
CREATE INDEX "tickets_sla_idx" ON "tickets" USING btree ("vence_resolucion_at") WHERE "tickets"."estado" in ('nuevo','asignado','en_curso','en_espera');--> statement-breakpoint
CREATE INDEX "tickets_titulo_trgm_idx" ON "tickets" USING gin (eco_normalizar("titulo") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_descripcion_trgm_idx" ON "tickets" USING gin (eco_normalizar("descripcion") gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "tickets_codigo_trgm_idx" ON "tickets" USING gin (eco_normalizar("codigo") gin_trgm_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "usuarios_email_lower_uq" ON "usuarios" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "usuarios_rol_idx" ON "usuarios" USING btree ("rol") WHERE "usuarios"."activo";--> statement-breakpoint
CREATE INDEX "usuarios_area_idx" ON "usuarios" USING btree ("area_id");