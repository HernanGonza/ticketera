import { useState, type FormEvent } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { ETIQUETA_ROL, ROLES, formatearFechaHora, type Rol } from '@eco/shared/dominio';
import type { Usuario } from '@eco/shared/schemas';
import { Boton, Campo, Encabezado, ErrorVista, Esqueletos, EstadoVacio, Paginador } from '../../componentes/ui/basicos';
import { Dialogo } from '../../componentes/ui/flotantes';
import { api, aQuery } from '../../lib/api';
import { claves } from '../../lib/consultas';
import { useCatalogo, useDiferido } from '../../lib/hooks';

const POR_PAGINA = 25;

export function Usuarios() {
  const [q, setQ] = useState('');
  const [rol, setRol] = useState('');
  const [pagina, setPagina] = useState(1);
  const [editando, setEditando] = useState<Usuario | 'nuevo' | null>(null);
  const busqueda = useDiferido(q.trim());
  const filtro = { q: busqueda, rol, pagina, porPagina: POR_PAGINA };
  const consulta = useQuery({
    queryKey: [...claves.usuarios, filtro],
    queryFn: ({ signal }) => api<{ items: Usuario[]; total: number }>(`/api/admin/usuarios${aQuery(filtro)}`, { signal }),
    placeholderData: keepPreviousData,
  });
  return (
    <div className="mx-auto max-w-6xl">
      <Encabezado
        titulo="Usuarios"
        acciones={
          <Boton onClick={() => setEditando('nuevo')}>
            <Plus aria-hidden className="size-4" /> Nuevo usuario
          </Boton>
        }
      />
      <div role="search" className="mb-3 flex flex-wrap gap-2">
        <input
          type="search"
          aria-label="Buscar por nombre o correo"
          placeholder="Buscar por nombre o correo…"
          className="entrada sm:!w-80"
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setPagina(1);
          }}
        />
        <select
          aria-label="Rol"
          className="entrada !w-auto"
          value={rol}
          onChange={(e) => {
            setRol(e.target.value);
            setPagina(1);
          }}
        >
          <option value="">Todos los roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {ETIQUETA_ROL[r]}
            </option>
          ))}
        </select>
      </div>
      {consulta.isPending ? (
        <Esqueletos filas={8} alto="h-11" />
      ) : !consulta.data ? (
        <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />
      ) : !consulta.data.items.length ? (
        <EstadoVacio titulo="No se encontraron usuarios" />
      ) : (
        <>
          <div className="tarjeta overflow-x-auto" tabIndex={0} role="region" aria-label="Tabla de usuarios">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-borde bg-superficie-2 text-left">
                  {['Nombre', 'Correo', 'Rol', 'Área', 'Estado', 'Último acceso', 'Acciones'].map((t) => (
                    <th key={t} scope="col" className="p-2 font-semibold">
                      {t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {consulta.data.items.map((u) => (
                  <tr key={u.id} className="border-b border-borde last:border-0">
                    <th scope="row" className="p-2 text-left font-semibold">
                      {u.nombre}
                    </th>
                    <td className="p-2">{u.email}</td>
                    <td className="p-2">{ETIQUETA_ROL[u.rol]}</td>
                    <td className="p-2">{u.areaNombre ?? '—'}</td>
                    <td className="p-2">{u.activo ? 'Activo' : 'Inactivo'}</td>
                    <td className="p-2 whitespace-nowrap">{u.ultimoAcceso ? formatearFechaHora(u.ultimoAcceso) : 'Nunca'}</td>
                    <td className="p-2">
                      <Boton variante="secundario" tamano="sm" aria-label={`Editar ${u.nombre}`} onClick={() => setEditando(u)}>
                        Editar
                      </Boton>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Paginador pagina={pagina} porPagina={POR_PAGINA} total={consulta.data.total} cambiar={setPagina} />
        </>
      )}
      {editando && <Editor usuario={editando === 'nuevo' ? null : editando} cerrar={() => setEditando(null)} />}
    </div>
  );
}

function Editor({ usuario, cerrar }: { usuario: Usuario | null; cerrar: () => void }) {
  const qc = useQueryClient();
  const areas = useCatalogo()?.areas ?? [];
  const [f, setF] = useState({
    email: usuario?.email ?? '',
    nombre: usuario?.nombre ?? '',
    rol: usuario?.rol ?? ('solicitante' as Rol),
    areaId: usuario?.areaId ?? null,
    activo: usuario?.activo ?? true,
    password: '',
  });
  const [error, setError] = useState<string>();
  const poner = (c: Partial<typeof f>) => setF((v) => ({ ...v, ...c }));
  const guardar = useMutation({
    mutationFn: () => {
      const { email, activo, password, ...comun } = f;
      const cuerpo = usuario
        ? { ...comun, activo, password: password || undefined }
        : { ...comun, email: email.trim(), password: password || undefined };
      return api(`/api/admin/usuarios${usuario ? `/${usuario.id}` : ''}`, { metodo: usuario ? 'PATCH' : 'POST', cuerpo });
    },
    onSuccess: () => {
      toast.success('Usuario guardado.');
      cerrar();
      void qc.invalidateQueries({ queryKey: claves.catalogo });
      return qc.invalidateQueries({ queryKey: claves.usuarios });
    },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const fallo =
      f.nombre.trim().length < 2
        ? 'Escriba el nombre completo.'
        : !usuario && !/^\S+@\S+\.\S+$/.test(f.email.trim())
          ? 'Escriba un correo válido.'
          : f.password && f.password.length < 10
            ? 'La contraseña debe tener al menos 10 caracteres.'
            : undefined;
    setError(fallo);
    if (!fallo) guardar.mutate();
  };
  return (
    <Dialogo
      abierto
      cerrar={cerrar}
      titulo={usuario ? `Editar ${usuario.nombre}` : 'Nuevo usuario'}
      descripcion="En cada ingreso, el nombre, el área y el estado se actualizan según el sistema de Personal."
    >
      <form noValidate onSubmit={enviar} className="flex flex-col gap-3">
        {!usuario && (
          <Campo etiqueta="Correo electrónico" requerido>
            {(p) => <input {...p} type="email" className="entrada" value={f.email} onChange={(e) => poner({ email: e.target.value })} />}
          </Campo>
        )}
        <Campo etiqueta="Nombre y apellido" requerido>
          {(p) => <input {...p} className="entrada" maxLength={120} value={f.nombre} onChange={(e) => poner({ nombre: e.target.value })} />}
        </Campo>
        <Campo etiqueta="Rol">
          {(p) => (
            <select {...p} className="entrada" value={f.rol} onChange={(e) => poner({ rol: e.target.value as Rol })}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {ETIQUETA_ROL[r]}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo etiqueta="Área">
          {(p) => (
            <select {...p} className="entrada" value={f.areaId ?? ''} onChange={(e) => poner({ areaId: Number(e.target.value) || null })}>
              <option value="">Sin área</option>
              {areas.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nombre}
                </option>
              ))}
            </select>
          )}
        </Campo>
        <Campo
          etiqueta={usuario ? 'Nueva contraseña (opcional)' : 'Contraseña (opcional)'}
          ayuda={usuario?.tienePassword ? 'Ya tiene contraseña de respaldo. Déjelo vacío para no cambiarla.' : 'Al menos 10 caracteres.'}
        >
          {(p) => <input {...p} type="password" autoComplete="new-password" className="entrada" value={f.password} onChange={(e) => poner({ password: e.target.value })} />}
        </Campo>
        {usuario && (
          <label className="flex items-center gap-2 text-sm font-semibold">
            <input type="checkbox" className="size-5 accent-primario" checked={f.activo} onChange={(e) => poner({ activo: e.target.checked })} />
            Usuario activo
          </label>
        )}
        {error && (
          <p role="alert" className="text-sm text-peligro">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Boton variante="secundario" onClick={cerrar}>
            Cancelar
          </Boton>
          <Boton type="submit" ocupado={guardar.isPending}>
            Guardar
          </Boton>
        </div>
      </form>
    </Dialogo>
  );
}
