import { useEffect, useRef, useState } from 'react';

const TEXTOS = JSON.stringify({
  ariaLinkLabel: 'Visite Altcha.org',
  enterCode: 'Ingrese el código',
  enterCodeAria: 'Ingrese el código que escucha. Presione Espacio para reproducir el audio.',
  error: 'La verificación falló. Intente nuevamente.',
  expired: 'La verificación venció. Intente nuevamente.',
  footer: 'Protegido por <a href="https://altcha.org/" target="_blank" rel="noreferrer">ALTCHA</a>',
  getAudioChallenge: 'Obtener un desafío de audio',
  label: 'No soy un robot',
  loading: 'Cargando…',
  reload: 'Recargar',
  verify: 'Verificar',
  verificationRequired: 'Se requiere verificación',
  verified: 'Verificación completa',
  verifying: 'Verificando…',
  waitAlert: 'Verificando… espere un momento.',
});

let carga: Promise<string> | undefined;
/** Versión "external": el worker y los estilos son archivos propios (compatible con CSP estricta). */
const cargar = () =>
  (carga ??= Promise.all([
    import('altcha/worker?url'),
    import('altcha/external'),
    import('altcha/altcha.css'),
  ]).then(([w]) => w.default));

/** Captcha autoalojado. Llama a `alVerificar` con el valor para el envío (vacío si se invalida). */
export function Altcha({ alVerificar, intento }: { alVerificar: (v: string) => void; intento: number }) {
  const [worker, setWorker] = useState<string>();
  const [fallo, setFallo] = useState(false);
  const contenedor = useRef<HTMLDivElement>(null);
  const aviso = useRef(alVerificar);
  aviso.current = alVerificar;

  useEffect(() => {
    cargar().then(setWorker, () => setFallo(true));
  }, []);

  useEffect(() => {
    const nodo = contenedor.current;
    if (!worker || !nodo) return;
    // Se crea a mano: `intento` fuerza un desafío nuevo (cada uno sirve una sola vez).
    const w = document.createElement('altcha-widget');
    const atributos = {
      challengeurl: '/api/auth/altcha',
      workerurl: worker,
      strings: TEXTOS,
      auto: 'onfocus',
      hidelogo: 'true',
    };
    for (const [k, v] of Object.entries(atributos)) w.setAttribute(k, v);
    const alCambiar = (e: Event) => {
      const d = (e as CustomEvent<{ state: string; payload?: string }>).detail;
      aviso.current(d.state === 'verified' ? (d.payload ?? '') : '');
    };
    w.addEventListener('statechange', alCambiar);
    nodo.replaceChildren(w);
    aviso.current('');
    return () => {
      w.removeEventListener('statechange', alCambiar);
      w.remove();
    };
  }, [worker, intento]);

  if (fallo)
    return (
      <p role="alert" className="text-sm text-peligro">
        No se pudo cargar la verificación. Recargue la página.
      </p>
    );
  return (
    <div ref={contenedor} className="min-h-14" data-testid="altcha">
      <div className="esqueleto h-14" />
    </div>
  );
}
