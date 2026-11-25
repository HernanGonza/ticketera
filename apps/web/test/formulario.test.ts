import { describe, expect, it } from 'vitest';
import type { CampoExtra } from '@eco/shared/schemas';
import { aDatos, esquemaPedido, valoresIniciales } from '../src/lib/formulario';
import { aCampos, claveDesdeEtiqueta, validarCategoria } from '../src/lib/categorias';

const campos: CampoExtra[] = [
  { clave: 'equipo', etiqueta: 'Equipo', tipo: 'texto', requerido: true },
  { clave: 'cantidad', etiqueta: 'Cantidad', tipo: 'numero', requerido: false },
  { clave: 'tipo', etiqueta: 'Tipo', tipo: 'seleccion', requerido: true, opciones: ['A', 'B'] },
  { clave: 'acepta', etiqueta: 'Acepta', tipo: 'casilla', requerido: true },
  { clave: 'cuando', etiqueta: 'Cuándo', tipo: 'fecha', requerido: false },
];
const base = { titulo: 'Sin red', descripcion: 'No conecta', ubicacion: '' };
const validos = { equipo: 'PC 3', cantidad: '2,5', tipo: 'A', acepta: true, cuando: '' };

describe('formulario dinámico', () => {
  const esquema = esquemaPedido(campos);
  const errores = (datos: object) =>
    esquema.safeParse({ ...base, datos }).error?.issues.map((i) => i.path.join('.')) ?? [];

  it('acepta valores válidos', () => expect(errores(validos)).toEqual([]));
  it('exige los obligatorios y valida tipos', () => {
    expect(errores({ equipo: ' ', cantidad: 'dos', tipo: 'C', acepta: false, cuando: '1/2/26' })).toEqual([
      'datos.equipo',
      'datos.cantidad',
      'datos.tipo',
      'datos.acepta',
      'datos.cuando',
    ]);
  });
  it('convierte números y omite vacíos', () => {
    expect(aDatos(campos, validos)).toEqual({ equipo: 'PC 3', cantidad: 2.5, tipo: 'A', acepta: true });
  });
  it('arma los valores iniciales', () => {
    expect(valoresIniciales(campos).datos).toMatchObject({ equipo: '', acepta: false });
  });
});

describe('editor de categorías', () => {
  it('genera claves válidas y únicas', () => {
    expect(claveDesdeEtiqueta('Número de equipo')).toBe('numero_de_equipo');
    expect(claveDesdeEtiqueta('Sala', ['sala'])).toBe('sala_2');
    expect(claveDesdeEtiqueta('¿?')).toBe('campo');
  });
  it('conserva la clave de campos guardados y limpia opciones', () => {
    const r = aCampos([
      { uid: '1', guardado: true, clave: 'viejo', etiqueta: 'Nuevo nombre', tipo: 'seleccion', requerido: false, opcionesTexto: 'A\n\nA\n B ' },
    ]);
    expect(r[0]).toMatchObject({ clave: 'viejo', opciones: ['A', 'B'] });
  });
  it('informa errores de validación', () => {
    const e = validarCategoria({ nombre: 'x', icono: 'wifi', prioridadDefault: 'media', slaRespuestaMin: 1, slaResolucionMin: 60, modoAsignacion: 'fija' });
    expect(e).toHaveLength(3);
  });
});
