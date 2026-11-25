// Crea o actualiza el usuario de solo lectura que usa Metabase (perfil `stats`). Se ejecuta en cada
// arranque de la API, después de las migraciones: así alcanza a las vistas nuevas y toma cambios de clave.
// Permisos por lista blanca: nunca hashes de contraseñas, sesiones, tokens, mensajes ni adjuntos.
import pg from 'pg';

const ROL = 'metabase_ro';
const TABLAS = ['areas', 'categorias', 'tickets', 'ticket_eventos'];
const COLUMNAS_USUARIOS = ['id', 'email', 'nombre', 'area_id', 'rol', 'activo', 'ultimo_acceso', 'creado_at'];

const url = process.env.DATABASE_URL;
const clave = process.env.METABASE_DB_PASSWORD;

if (!url || !clave || clave.startsWith('cambiar')) {
  console.log('Metabase: sin una METABASE_DB_PASSWORD propia, no se crea el usuario de solo lectura.');
  process.exit(0);
}

const c = new pg.Client({ connectionString: url });
try {
  await c.connect();
  const rol = c.escapeIdentifier(ROL);
  const consultar = async (texto, params) => (await c.query(texto, params)).rows;

  await c.query('begin');
  const [existe] = await consultar('select 1 from pg_roles where rolname = $1', [ROL]);
  await c.query(`${existe ? 'alter' : 'create'} role ${rol} login password ${c.escapeLiteral(clave)}`);
  await c.query(`alter role ${rol} set default_transaction_read_only = on`);
  await c.query(`alter role ${rol} set statement_timeout = '60s'`);
  const [{ base }] = await consultar('select current_database() as base');
  await c.query(`grant connect on database ${c.escapeIdentifier(base)} to ${rol}`);
  await c.query(`grant usage on schema public to ${rol}`);
  await c.query(`revoke all on all tables in schema public from ${rol}`);

  // Tablas de la lista blanca y todas las vistas de estadísticas (prefijo v_).
  const objetos = await consultar(
    `select table_name as nombre from information_schema.tables
      where table_schema = 'public'
        and (table_name = any($1) or (table_type = 'VIEW' and left(table_name, 2) = 'v_'))`,
    [TABLAS],
  );
  for (const { nombre } of objetos)
    await c.query(`grant select on public.${c.escapeIdentifier(nombre)} to ${rol}`);

  const columnas = await consultar(
    `select column_name as nombre from information_schema.columns
      where table_schema = 'public' and table_name = 'usuarios' and column_name = any($1)`,
    [COLUMNAS_USUARIOS],
  );
  if (columnas.length) {
    const lista = columnas.map((x) => c.escapeIdentifier(x.nombre)).join(', ');
    await c.query(`grant select (${lista}) on public.usuarios to ${rol}`);
  }
  await c.query('commit');
  console.log(`Metabase: usuario ${ROL} actualizado (${objetos.length} tablas/vistas y columnas públicas de usuarios).`);
} catch (e) {
  // Las estadísticas externas son opcionales: un fallo acá no debe impedir el arranque del sistema.
  console.warn(`Metabase: no se pudo configurar el usuario de solo lectura (${e.message}).`);
} finally {
  await c.end().catch(() => {});
}
