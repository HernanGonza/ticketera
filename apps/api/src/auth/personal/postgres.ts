import pg from 'pg';
import type { EmpleadoPersonalExterno, PersonalProvider } from './index';
import { TABLA_PERSONAL, type TablaPersonal } from './tabla';

const ACTIVO = new Set(['true', 't', '1', 's', 'si', 'sí', 'a', 'activo']);

/** Consulta de solo lectura: toda sesión arranca con `default_transaction_read_only`. */
export class PersonalPostgresProvider implements PersonalProvider {
  readonly pool: pg.Pool;
  private readonly consulta: string;

  constructor(url: string, tabla: TablaPersonal = TABLA_PERSONAL) {
    this.pool = new pg.Pool({
      connectionString: url,
      max: 3,
      connectionTimeoutMillis: 5000,
      statement_timeout: 5000,
      query_timeout: 6000,
      options: '-c default_transaction_read_only=on',
    });
    this.pool.on('error', () => {});
    const id = pg.escapeIdentifier;
    const c = tabla.columnas;
    // Con correos repetidos gana el registro activo.
    this.consulta = `select ${id(c.nombre)} as nombre, ${id(c.areaId)} as area_id,
        ${id(c.areaNombre)} as area_nombre, ${id(c.activo)} as activo
      from ${id(tabla.esquema)}.${id(tabla.tabla)}
      where lower(trim(${id(c.email)})) = $1
      order by ${id(c.activo)} desc nulls last
      limit 20`;
  }

  async buscarPorEmail(email: string): Promise<EmpleadoPersonalExterno | null> {
    const { rows } = await this.pool.query<{
      nombre: unknown;
      area_id: number | string | null;
      area_nombre: string | null;
      activo: unknown;
    }>(this.consulta, [email.trim().toLowerCase()]);
    const esActivo = (v: unknown) => ACTIVO.has(String(v).trim().toLowerCase());
    const f = rows.find((r) => esActivo(r.activo)) ?? rows[0];
    if (!f) return null;
    return {
      nombre: String(f.nombre ?? '').trim() || email,
      area_id: f.area_id,
      area_nombre: f.area_nombre,
      activo: esActivo(f.activo),
    };
  }

  cerrar() {
    return this.pool.end();
  }
}
