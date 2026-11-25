import type { ReactNode } from 'react';
import { MINISTERIO } from '@eco/shared/marca';
import { Firma, NombreSistema } from '../../componentes/Firma';
import { FlorLapacho } from '../../componentes/FlorLapacho';

/** Marco de las pantallas públicas. */
export function Marco({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex justify-center border-b border-borde bg-superficie px-4 py-3">
        <Firma />
      </header>
      <main className="flex flex-1 items-start justify-center px-4 py-8">
        <div className="tarjeta w-full max-w-md p-6">
          <div className="mb-5 flex flex-col items-center gap-2 text-center">
            <FlorLapacho animada className="size-20" />
            <p className="text-2xl">
              <NombreSistema />
            </p>
            <h1 className="text-lg">{titulo}</h1>
          </div>
          {children}
        </div>
      </main>
      <footer className="px-4 py-4 text-center text-xs text-suave">{MINISTERIO}</footer>
    </div>
  );
}

export function Alerta({ children, tono = 'peligro' }: { children: ReactNode; tono?: 'peligro' | 'exito' }) {
  return (
    <div
      role={tono === 'peligro' ? 'alert' : 'status'}
      className={
        tono === 'peligro'
          ? 'rounded-md bg-peligro-suave p-3 text-sm text-peligro-sobre-suave'
          : 'rounded-md bg-exito-suave p-3 text-sm text-exito-sobre-suave'
      }
    >
      {children}
    </div>
  );
}
