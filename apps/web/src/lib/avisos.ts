/** Sonido (WebAudio, sin archivos) y notificaciones del navegador. */
let contexto: AudioContext | undefined;

export function sonar(critico = false) {
  try {
    contexto ??= new AudioContext();
    void contexto.resume();
    const t0 = contexto.currentTime;
    const notas = critico ? [880, 660, 880] : [660, 880];
    notas.forEach((f, i) => {
      const o = contexto!.createOscillator();
      const g = contexto!.createGain();
      const t = t0 + i * 0.16;
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.12, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      o.connect(g).connect(contexto!.destination);
      o.start(t);
      o.stop(t + 0.16);
    });
  } catch {
    /* audio no disponible */
  }
}

export async function pedirPermisoNotificaciones(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  return (await Notification.requestPermission()) === 'granted';
}

export function notificarNavegador(titulo: string, cuerpo: string, ruta: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(titulo, { body: cuerpo, tag: ruta, icon: '/favicon.svg' });
    n.onclick = () => {
      window.focus();
      window.location.assign(ruta);
    };
  } catch {
    /* algunos navegadores móviles no permiten el constructor */
  }
}
