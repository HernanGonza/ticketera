/** Genera docs/capturas/ con los datos de demostración (`npm run e2e:capturas`). */
import path from 'node:path';
import { CUENTAS, MOVIL, test } from '../apoyo';
import { asentada, enOscuro, PANTALLAS, prepararDatos, type Datos } from '../pantallas';

const DESTINO = path.resolve('docs/capturas');
let datos: Datos | undefined;

const VARIANTES = [
  { sufijo: '', opciones: { viewport: { width: 1440, height: 900 } }, si: () => true },
  { sufijo: '-movil', opciones: MOVIL, si: (p: (typeof PANTALLAS)[number]) => !!p.movil },
  { sufijo: '-oscuro', opciones: { viewport: { width: 1440, height: 900 } }, si: (p: (typeof PANTALLAS)[number]) => !!p.oscuro },
];

for (const [i, p] of PANTALLAS.entries())
  for (const v of VARIANTES) {
    if (!v.si(p)) continue;
    const archivo = `${String(i + 1).padStart(2, '0')}-${p.nombre}${v.sufijo}.png`;
    test(archivo, async ({ abrir }) => {
      datos ??= await prepararDatos(await abrir(CUENTAS.tecnico), await abrir(CUENTAS.solicitante));
      const sesion = await abrir(p.cuenta, { ...v.opciones, reducedMotion: 'reduce', esperados: p.esperados });
      if (v.sufijo === '-oscuro') await enOscuro(sesion);
      await p.ir(sesion.page, datos);
      await asentada(sesion.page);
      await sesion.page.screenshot({
        path: path.join(DESTINO, archivo),
        fullPage: !p.soloVisible,
        animations: 'disabled',
        scale: 'css',
      });
    });
  }
