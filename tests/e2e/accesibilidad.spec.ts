/** axe en todas las pantallas, tema claro y oscuro: sin infracciones serias ni críticas. */
import AxeBuilder from '@axe-core/playwright';
import { CUENTAS, expect, MOVIL, test } from './apoyo';
import { asentada, enOscuro, PANTALLAS, prepararDatos, type Datos } from './pantallas';

let datos: Datos | undefined;

for (const tema of ['claro', 'oscuro'] as const)
  for (const dispositivo of ['escritorio', 'móvil'] as const)
    for (const p of PANTALLAS) {
      if (dispositivo === 'móvil' && !p.movil) continue;
      test(`accesibilidad: ${p.nombre} (${tema}, ${dispositivo})`, async ({ abrir }) => {
        datos ??= await prepararDatos(await abrir(CUENTAS.tecnico), await abrir(CUENTAS.solicitante));
        const sesion = await abrir(p.cuenta, {
          ...(dispositivo === 'móvil' ? MOVIL : {}),
          // El contraste se mide sobre el estado final, sin transiciones a medias.
          reducedMotion: 'reduce',
          esperados: p.esperados,
        });
        if (tema === 'oscuro') await enOscuro(sesion);
        await p.ir(sesion.page, datos);
        await asentada(sesion.page);
        await expect(sesion.page.locator('html')).toHaveAttribute('data-theme', tema === 'oscuro' ? 'dark' : 'light');
        const { violations } = await new AxeBuilder({ page: sesion.page })
          .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'best-practice'])
          .analyze();
        const graves = violations
          .filter((v) => v.impact === 'serious' || v.impact === 'critical')
          .map((v) => ({
            regla: v.id,
            nodos: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} :: ${n.failureSummary?.split('\n')[1]?.trim()}`),
            cantidad: v.nodes.length,
          }));
        expect(graves).toEqual([]);
      });
    }
