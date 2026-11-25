import { lazy, Suspense, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getRouteApi, Link, useRouter } from '@tanstack/react-router';
import { EMAIL_CONTACTO, NOMBRE_SISTEMA } from '@eco/shared/marca';
import { ETIQUETA_ROL, type Rol } from '@eco/shared/dominio';
import type { Login as DatosLogin, UsuarioActual } from '@eco/shared/schemas';
import { Boton, Campo, estilosBoton } from '../../componentes/ui/basicos';
import { api, ErrorApiCliente } from '../../lib/api';
import { claves } from '../../lib/consultas';
import { useTitulo } from '../../lib/hooks';
import { enlacePortal } from '../../lib/rutas';
import { qAuthConfig } from '../../lib/sesion';
import { Alerta, Marco } from './Marco';

const Altcha = lazy(() => import('./Altcha').then((m) => ({ default: m.Altcha })));
const ruta = getRouteApi('/login');

export const MENSAJES_ERROR: Record<string, string> = {
  token_invalido: 'El enlace de ingreso no es válido o venció. Vuelva a ingresar desde el Portal.',
  no_autenticado: 'Su sesión venció. Ingrese nuevamente.',
  usuario_no_habilitado: `Su usuario no está habilitado. Escriba a ${EMAIL_CONTACTO}.`,
  demasiados_intentos: 'Se registraron demasiados intentos. Espere unos minutos.',
  validacion: 'El pedido de ingreso está incompleto. Vuelva a intentarlo desde el Portal.',
};
const PLURAL_ACCESO: Record<Rol, string> = { solicitante: 'solicitante', tecnico: 'técnico', admin: 'admin' };

export function Login() {
  useTitulo(`Ingresar · ${NOMBRE_SISTEMA}`);
  const { redirect, error } = ruta.useSearch();
  const router = useRouter();
  const qc = useQueryClient();
  const config = useQuery(qAuthConfig).data;
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [altcha, setAltcha] = useState('');
  const [intento, setIntento] = useState(0);
  const [verCaptcha, setVerCaptcha] = useState(false);

  const ingresar = useMutation({
    mutationFn: (cuerpo: DatosLogin) => api<UsuarioActual>('/api/auth/login', { metodo: 'POST', cuerpo }),
    meta: { silencioso: true },
    onSuccess: (u) => {
      qc.clear();
      qc.setQueryData(claves.sesion, u);
      router.history.push(redirect ?? '/');
    },
    onError: () => setIntento((n) => n + 1),
  });
  const dev = useMutation({
    mutationFn: (rol: Rol) => api<{ url: string }>('/api/auth/dev/token', { metodo: 'POST', cuerpo: { rol } }),
    onSuccess: ({ url }) => {
      const u = new URL(url, window.location.origin);
      if (redirect) u.searchParams.set('redirect', redirect);
      window.location.assign(u.toString());
    },
  });

  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (altcha) ingresar.mutate({ email, password, altcha });
  };

  return (
    <Marco titulo="Mesa de soporte técnico">
      <div className="flex flex-col gap-4">
        {error && <Alerta>{MENSAJES_ERROR[error] ?? 'No se pudo completar el ingreso. Intente nuevamente.'}</Alerta>}
        <a
          href={config ? enlacePortal(config.portalUrl, redirect) : undefined}
          aria-disabled={!config}
          className={estilosBoton({ tamano: 'lg' })}
        >
          Ingresar con el Portal del Ministerio
        </a>
        <div className="flex items-center gap-3 text-xs text-suave">
          <span className="h-px flex-1 bg-borde" />
          o con su correo y contraseña
          <span className="h-px flex-1 bg-borde" />
        </div>
        <form onSubmit={enviar} onFocus={() => setVerCaptcha(true)} className="flex flex-col gap-3">
          <Campo etiqueta="Correo electrónico">
            {(p) => (
              <input {...p} className="entrada" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Contraseña">
            {(p) => (
              <input {...p} className="entrada" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Campo>
          {verCaptcha ? (
            <Suspense fallback={<div className="esqueleto h-14" />}>
              <Altcha alVerificar={setAltcha} intento={intento} />
            </Suspense>
          ) : (
            <Boton variante="secundario" onClick={() => setVerCaptcha(true)}>
              Mostrar verificación
            </Boton>
          )}
          {ingresar.error && (
            <Alerta>
              {ingresar.error instanceof ErrorApiCliente ? ingresar.error.message : 'No se pudo ingresar.'}
            </Alerta>
          )}
          <Boton type="submit" variante="secundario" ocupado={ingresar.isPending} disabled={!altcha}>
            Ingresar
          </Boton>
          {!altcha && <p className="text-center text-xs text-suave">Complete la verificación para ingresar.</p>}
        </form>
        <Link to="/recuperar" className="text-center text-sm text-enlace underline">
          Olvidé mi contraseña
        </Link>
        {config?.modoDev && (
          <section aria-label="Accesos de desarrollo" className="rounded-md border border-dashed border-borde-fuerte p-3">
            <p className="mb-2 text-center text-xs font-semibold text-suave">Modo desarrollo</p>
            <div className="flex flex-col gap-2">
              {(['solicitante', 'tecnico', 'admin'] as const).map((rol) => (
                <Boton
                  key={rol}
                  variante="secundario"
                  tamano="sm"
                  title={`${ETIQUETA_ROL[rol]}: ${config.accesosDev.find((a) => a.rol === rol)?.email ?? ''}`}
                  disabled={dev.isPending}
                  onClick={() => dev.mutate(rol)}
                >
                  Entrar como {PLURAL_ACCESO[rol]}
                </Boton>
              ))}
            </div>
          </section>
        )}
      </div>
    </Marco>
  );
}
