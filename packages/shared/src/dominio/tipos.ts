export const ROLES = ['solicitante', 'tecnico', 'admin'] as const;
export type Rol = (typeof ROLES)[number];

export const ESTADOS = [
  'nuevo',
  'asignado',
  'en_curso',
  'en_espera',
  'resuelto',
  'cerrado',
  'cancelado',
] as const;
export type Estado = (typeof ESTADOS)[number];

export const PRIORIDADES = ['baja', 'media', 'alta', 'critica'] as const;
export type Prioridad = (typeof PRIORIDADES)[number];

export const ETIQUETA_ROL: Record<Rol, string> = {
  solicitante: 'Solicitante',
  tecnico: 'Técnico',
  admin: 'Administrador',
};
export const ETIQUETA_ESTADO: Record<Estado, string> = {
  nuevo: 'Nuevo',
  asignado: 'Asignado',
  en_curso: 'En curso',
  en_espera: 'En espera',
  resuelto: 'Resuelto',
  cerrado: 'Cerrado',
  cancelado: 'Cancelado',
};
export const ETIQUETA_PRIORIDAD: Record<Prioridad, string> = {
  baja: 'Baja',
  media: 'Media',
  alta: 'Alta',
  critica: 'Crítica',
};

/** Tipos de fila del historial inmutable `ticket_eventos`. `de`/`a` son texto (estado, prioridad, uuid de usuario o id de categoría). */
export const TIPOS_EVENTO = [
  'creado',
  'estado',
  'asignacion',
  'prioridad',
  'categoria',
  'primera_respuesta',
  'reabierto',
  'calificacion',
  'sla_por_vencer',
  'sla_vencido',
] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

export const TIPOS_NOTIFICACION = [
  'ticket_creado',
  'ticket_asignado',
  'estado_cambiado',
  'mensaje_nuevo',
  'ticket_resuelto',
  'sla_por_vencer',
  'sla_vencido',
] as const;
export type TipoNotificacion = (typeof TIPOS_NOTIFICACION)[number];
