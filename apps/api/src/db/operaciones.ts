/**
 * Única vía de mutación del dominio, compartida por API y worker.
 * Cada función es transaccional y escribe `ticket_eventos` y `outbox_eventos` en la misma transacción.
 * Todas aceptan la conexión o una transacción en curso (en ese caso usan un savepoint).
 * Los errores de negocio son `ErrorHttp`.
 */
export { leerConfiguracion } from './configuracion';
export * from './eventos';
export {
  actualizarTicket,
  autoasignar,
  calificarTicket,
  crearTicket,
  validarDatosCategoria,
  type CambiosPedidos,
  type DatosNuevoTicket,
  type OpcionesActualizacion,
  type Posicion,
  type ResultadoActualizacion,
} from './operaciones-tickets';
export * from './operaciones-mensajes';
export * from './operaciones-admin';
export * from './operaciones-sistema';
