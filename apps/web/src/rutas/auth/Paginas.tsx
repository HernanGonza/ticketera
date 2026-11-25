import { useEffect, useState, type FormEvent } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { EMAIL_CONTACTO, NOMBRE_SISTEMA } from '@eco/shared/marca';
import { Boton, Campo, estilosBoton } from '../../componentes/ui/basicos';
import { api, ErrorApiCliente } from '../../lib/api';
import { useTitulo } from '../../lib/hooks';
import { qAuthConfig } from '../../lib/sesion';
import { Alerta, Marco } from './Marco';

export function NoHabilitado() {
  useTitulo(`Usuario no habilitado · ${NOMBRE_SISTEMA}`);
  const portal = useQuery(qAuthConfig).data?.portalUrl;
  return (
    <Marco titulo="Su usuario no está habilitado">
      <div className="flex flex-col gap-4 text-center text-sm">
        <p>
          Su cuenta no figura como activa en el sistema de Personal del Ministerio, por lo que no puede ingresar a{' '}
          {NOMBRE_SISTEMA}.
        </p>
        <p>
          Comuníquese con{' '}
          <a href={`mailto:${EMAIL_CONTACTO}`} className="font-semibold wrap-anywhere text-enlace underline">
            {EMAIL_CONTACTO.split('@')[0]}@
            <wbr />
            {EMAIL_CONTACTO.split('@')[1]}
          </a>
          .
        </p>
        {portal && (
          <a href={portal} className={estilosBoton()}>
            Volver al Portal
          </a>
        )}
        <Link to="/login" className="text-enlace underline">
          Ingresar con otra cuenta
        </Link>
      </div>
    </Marco>
  );
}

export function Restablecer() {
  useTitulo(`Nueva contraseña · ${NOMBRE_SISTEMA}`);
  // Se lee del navegador para no alterar el token (el router interpreta valores numéricos).
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token')?.replaceAll('"', '') ?? '');
  // El enlace no debe quedar en la barra de direcciones ni en el historial.
  useEffect(() => window.history.replaceState(window.history.state, '', window.location.pathname), []);
  const [password, setPassword] = useState('');
  const [repetida, setRepetida] = useState('');
  const [local, setLocal] = useState<{ password?: string; repetida?: string }>({});
  const guardar = useMutation({
    mutationFn: () => api('/api/auth/restablecer', { metodo: 'POST', cuerpo: { token, password } }),
    meta: { silencioso: true },
  });
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const err = {
      password: password.length < 10 ? 'La contraseña debe tener al menos 10 caracteres' : undefined,
      repetida: password !== repetida ? 'Las contraseñas no coinciden' : undefined,
    };
    setLocal(err);
    if (!err.password && !err.repetida) guardar.mutate();
  };
  return (
    <Marco titulo="Definir nueva contraseña">
      {!token ? (
        <Alerta>El enlace está incompleto. Solicite uno nuevo.</Alerta>
      ) : guardar.isSuccess ? (
        <Alerta tono="exito">Su contraseña fue actualizada. Ya puede ingresar.</Alerta>
      ) : (
        <form className="flex flex-col gap-3" onSubmit={enviar} noValidate>
          <Campo etiqueta="Nueva contraseña" ayuda="Al menos 10 caracteres." error={local.password}>
            {(p) => (
              <input {...p} className="entrada" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            )}
          </Campo>
          <Campo etiqueta="Repita la contraseña" error={local.repetida}>
            {(p) => (
              <input {...p} className="entrada" type="password" autoComplete="new-password" value={repetida} onChange={(e) => setRepetida(e.target.value)} />
            )}
          </Campo>
          {guardar.error && (
            <Alerta>
              {guardar.error instanceof ErrorApiCliente ? guardar.error.message : 'No se pudo guardar.'}
            </Alerta>
          )}
          <Boton type="submit" ocupado={guardar.isPending}>
            Guardar contraseña
          </Boton>
        </form>
      )}
      <p className="mt-4 flex justify-center gap-4 text-sm">
        <Link to="/login" className="text-enlace underline">
          Ir al ingreso
        </Link>
        <Link to="/recuperar" className="text-enlace underline">
          Pedir otro enlace
        </Link>
      </p>
    </Marco>
  );
}
