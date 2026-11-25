/** Quita datos sensibles de lo que guardan los trabajos antes de mostrarlo. */
const CLAVES = /token|passw|contrase|clave|secret|cookie|authorization|e-?mail|correo|stack|query|params/i;
const CORREO = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const TOKEN = /((?:token|password|key)=)[^&\s"']+/gi;
const JWT = /eyJ[\w-]+\.[\w-]+\.[\w-]+/g;

export function depurar(valor: unknown, nivel = 0): unknown {
  if (typeof valor === 'string')
    return valor.replace(TOKEN, '$1[oculto]').replace(JWT, '[oculto]').replace(CORREO, '[oculto]').slice(0, 500);
  if (valor === null || typeof valor !== 'object') return valor ?? null;
  if (nivel >= 4) return '[…]';
  if (Array.isArray(valor)) return valor.slice(0, 50).map((v) => depurar(v, nivel + 1));
  return Object.fromEntries(
    Object.entries(valor).map(([k, v]) => [k, CLAVES.test(k) ? '[oculto]' : depurar(v, nivel + 1)]),
  );
}
