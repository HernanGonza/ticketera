import { useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { NOMBRE_SISTEMA } from '@eco/shared/marca';
import { Boton, Campo } from '../../componentes/ui/basicos';
import { api } from '../../lib/api';
import { useTitulo } from '../../lib/hooks';
import { Altcha } from './Altcha';
import { Alerta, Marco } from './Marco';

export function Recuperar() {
  useTitulo(`Recuperar contraseña · ${NOMBRE_SISTEMA}`);
  const [email, setEmail] = useState('');
  const [altcha, setAltcha] = useState('');
  const [intento, setIntento] = useState(0);
  const enviar = useMutation({
    mutationFn: () => api('/api/auth/recuperar', { metodo: 'POST', cuerpo: { email, altcha } }),
    onError: () => setIntento((n) => n + 1),
  });
  return (
    <Marco titulo="Recuperar contraseña">
      {enviar.isSuccess ? (
        <Alerta tono="exito">
          Si el correo corresponde a un usuario habilitado, en unos minutos recibirá un enlace para definir una nueva
          contraseña.
        </Alerta>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            if (altcha) enviar.mutate();
          }}
        >
          <Campo etiqueta="Correo electrónico" ayuda="Ingrese su correo institucional.">
            {(p) => (
              <input {...p} className="entrada" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
            )}
          </Campo>
          <Altcha alVerificar={setAltcha} intento={intento} />
          <Boton type="submit" ocupado={enviar.isPending} disabled={!altcha}>
            Enviar enlace
          </Boton>
        </form>
      )}
      <p className="mt-4 text-center">
        <Link to="/login" className="text-sm text-enlace underline">
          Volver al ingreso
        </Link>
      </p>
    </Marco>
  );
}
