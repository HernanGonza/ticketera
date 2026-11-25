import { lazy, Suspense } from 'react';

const Markdown = lazy(() => import('./Markdown'));

export function Texto({ texto }: { texto: string }) {
  return (
    <Suspense fallback={<p className="whitespace-pre-wrap">{texto}</p>}>
      <Markdown texto={texto} />
    </Suspense>
  );
}
