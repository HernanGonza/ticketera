import './styles/base.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { Toaster } from 'sonner';
import { alExpirarSesion } from './lib/api';
import { useAlmacen } from './lib/almacen';
import { claves, crearQueryClient } from './lib/consultas';
import { aplicarTema, preferencias } from './lib/preferencias';
import { rutaInterna } from './lib/rutas';
import { crearRouter } from './router';

aplicarTema(preferencias.leer().tema);

const qc = crearQueryClient();
const router = crearRouter(qc);

alExpirarSesion(() => {
  if (!qc.getQueryData(claves.sesion)) return;
  const redirect = rutaInterna(router.state.location.href);
  qc.clear();
  void router.navigate({ to: '/login', search: { redirect } });
});

function Avisos() {
  const tema = useAlmacen(preferencias, (p) => p.tema);
  return (
    <Toaster
      theme={tema === 'oscuro' ? 'dark' : 'light'}
      position="bottom-right"
      closeButton
      containerAriaLabel="Avisos"
      toastOptions={{
        style: {
          background: 'var(--superficie)',
          color: 'var(--texto)',
          border: '1px solid var(--borde-fuerte)',
          fontFamily: 'inherit',
        },
      }}
    />
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={qc}>
      <RouterProvider router={router} />
      <Avisos />
    </QueryClientProvider>
  </StrictMode>,
);
