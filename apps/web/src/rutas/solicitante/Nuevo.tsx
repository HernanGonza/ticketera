import { useMemo, useState } from 'react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link } from '@tanstack/react-router';
import { ArrowLeft, CircleCheck } from 'lucide-react';
import { useForm, type FieldPath } from 'react-hook-form';
import type { Adjunto, Categoria, CrearTicket, TicketDetalle } from '@eco/shared/schemas';
import { ZonaAdjuntos } from '../../componentes/Adjuntos';
import { CamposExtra } from '../../componentes/CamposExtra';
import { IconoCategoria } from '../../componentes/IconoCategoria';
import { Boton, Campo, Encabezado, ErrorVista, Esqueletos, EstadoVacio, estilosBoton } from '../../componentes/ui/basicos';
import { api } from '../../lib/api';
import { claves, qCatalogo } from '../../lib/consultas';
import { aDatos, esquemaPedido, valoresIniciales, type ValoresPedido } from '../../lib/formulario';

const ruta = getRouteApi('/app/nuevo');

interface Confirmado {
  ticket: TicketDetalle;
  fallidos: string[];
}

export function Nuevo() {
  const { categoria: id } = ruta.useSearch();
  const navegar = ruta.useNavigate();
  const catalogo = useQuery(qCatalogo);
  const [confirmado, setConfirmado] = useState<Confirmado | null>(null);

  if (confirmado)
    return (
      <Confirmacion
        {...confirmado}
        otro={() => {
          setConfirmado(null);
          void navegar({ search: {} });
        }}
      />
    );
  if (catalogo.isPending) return <Esqueletos filas={5} />;
  if (!catalogo.data) return <ErrorVista error={catalogo.error} reintentar={() => void catalogo.refetch()} />;

  const activas = catalogo.data.categorias.filter((c) => c.activa).sort((a, b) => a.orden - b.orden);
  const elegida = activas.find((c) => c.id === id);
  if (elegida)
    return (
      <Formulario
        key={elegida.id}
        categoria={elegida}
        maxMb={catalogo.data.configuracion.adjuntoMaxMb}
        listo={setConfirmado}
      />
    );

  // Las categorías con subcategorías funcionan como grupo.
  const hijas = (p: number) => activas.filter((c) => c.padreId === p);
  const raices = activas.filter((c) => !c.padreId || !activas.some((p) => p.id === c.padreId));
  const sueltas = raices.filter((c) => !hijas(c.id).length);
  const grupos = [
    ...(sueltas.length ? [{ titulo: '', items: sueltas }] : []),
    ...raices.filter((c) => hijas(c.id).length).map((c) => ({ titulo: c.nombre, items: [c, ...hijas(c.id)] })),
  ];
  return (
    <div className="mx-auto max-w-4xl">
      <Encabezado titulo="Nuevo pedido">¿Con qué necesita ayuda?</Encabezado>
      {!activas.length && <EstadoVacio titulo="No hay categorías disponibles">Comuníquese con el área de Soporte.</EstadoVacio>}
      {grupos.map((g) => (
        <section key={g.titulo} className="mb-5">
          {g.titulo && <h2 className="mb-2">{g.titulo}</h2>}
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {g.items.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  data-testid={`categoria-${c.id}`}
                  onClick={() => void navegar({ search: { categoria: c.id } })}
                  title={c.descripcion || undefined}
                  className="tarjeta flex h-full w-full flex-col items-center gap-2 p-4 text-center transition-colors hover:border-primario hover:bg-primario-suave hover:text-primario-sobre-suave"
                >
                  <span className="flex size-12 items-center justify-center rounded-full bg-primario-suave text-primario-sobre-suave">
                    <IconoCategoria nombre={c.icono} className="size-6" />
                  </span>
                  <span className="font-semibold">{c.nombre}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function Formulario({ categoria, maxMb, listo }: { categoria: Categoria; maxMb: number; listo: (c: Confirmado) => void }) {
  const qc = useQueryClient();
  const [archivos, setArchivos] = useState<File[]>([]);
  const esquema = useMemo(() => esquemaPedido(categoria.campos), [categoria.campos]);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<ValoresPedido>({
    // El esquema se arma según la categoría, por eso el tipo es dinámico.
    resolver: zodResolver(esquema as never),
    defaultValues: valoresIniciales(categoria.campos),
  });

  const crear = useMutation({
    mutationFn: async (v: ValoresPedido): Promise<Confirmado> => {
      const cuerpo: CrearTicket = {
        categoriaId: categoria.id,
        titulo: v.titulo.trim(),
        descripcion: v.descripcion.trim(),
        ubicacion: v.ubicacion.trim() || undefined,
        datos: aDatos(categoria.campos, v.datos),
      };
      const ticket = await api<TicketDetalle>('/api/tickets', { metodo: 'POST', cuerpo });
      const fallidos: string[] = [];
      for (const f of archivos) {
        const datos = new FormData();
        datos.append('archivo', f);
        try {
          await api<Adjunto>(`/api/tickets/${ticket.id}/adjuntos`, { metodo: 'POST', cuerpo: datos });
        } catch (e) {
          fallidos.push(`${f.name}: ${e instanceof Error ? e.message : 'no se pudo subir'}`);
        }
      }
      return { ticket, fallidos };
    },
    onSuccess: (r) => {
      void qc.invalidateQueries({ queryKey: claves.tickets });
      listo(r);
    },
  });

  return (
    <div className="mx-auto max-w-2xl">
      <Link to="/nuevo" className="mb-2 inline-flex items-center gap-1 text-sm text-enlace">
        <ArrowLeft aria-hidden className="size-4" /> Cambiar categoría
      </Link>
      <Encabezado titulo={categoria.nombre} />
      <form noValidate className="tarjeta flex flex-col gap-4 p-4 md:p-6" onSubmit={handleSubmit((v) => crear.mutate(v))}>
        <Campo etiqueta="Título" requerido error={errors.titulo?.message}>
          {(p) => <input className="entrada" maxLength={150} placeholder="El problema en una línea" {...p} {...register('titulo')} />}
        </Campo>
        <Campo etiqueta="Descripción" requerido error={errors.descripcion?.message}>
          {(p) => <textarea rows={5} className="entrada" {...p} {...register('descripcion')} />}
        </Campo>
        <CamposExtra
          campos={categoria.campos}
          registrar={(k) => register(`datos.${k}` as FieldPath<ValoresPedido>)}
          errores={errors.datos as Record<string, { message?: string }> | undefined}
        />
        <Campo etiqueta="Ubicación o interno" error={errors.ubicacion?.message}>
          {(p) => <input className="entrada" maxLength={120} placeholder="Oficina, piso o interno" {...p} {...register('ubicacion')} />}
        </Campo>
        <ZonaAdjuntos archivos={archivos} cambiar={setArchivos} maxMb={maxMb} />
        <Boton type="submit" tamano="lg" ocupado={crear.isPending}>
          {crear.isPending ? 'Enviando…' : 'Enviar pedido'}
        </Boton>
      </form>
    </div>
  );
}

function Confirmacion({ ticket, fallidos, otro }: Confirmado & { otro: () => void }) {
  return (
    <div className="tarjeta mx-auto mt-4 flex max-w-lg flex-col items-center gap-3 p-6 text-center" role="status">
      <CircleCheck aria-hidden className="size-14 text-primario" />
      <h1>Pedido registrado</h1>
      <p className="text-sm text-suave">Su código de seguimiento es</p>
      <p className="text-2xl font-bold tracking-wide" data-testid="codigo-confirmacion">
        {ticket.codigo}
      </p>
      <p className="text-sm text-suave">Le avisaremos por correo cuando haya novedades.</p>
      {fallidos.length > 0 && (
        <div role="alert" className="w-full rounded-md bg-aviso-suave p-3 text-left text-sm text-aviso-sobre-suave">
          <p className="font-semibold">Algunos archivos no se pudieron adjuntar. Puede enviarlos desde el pedido.</p>
          <ul className="list-disc pl-5">
            {fallidos.map((f) => (
              <li key={f}>{f}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-2 flex flex-wrap justify-center gap-2">
        <Link to="/tickets/$id" params={{ id: ticket.codigo }} className={estilosBoton()}>
          Ver el pedido
        </Link>
        <Boton variante="secundario" onClick={otro}>
          Cargar otro
        </Boton>
      </div>
    </div>
  );
}
