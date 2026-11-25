/** Datos base (áreas y categorías) que se cargan en cualquier instalación nueva. */
import type { Prioridad } from '@eco/shared/dominio';
import type { CampoExtra } from '@eco/shared/schemas';
import type { ModoAsignacion } from '../schema';

export const AREAS_BASE = [
  { id: 1, nombre: 'Desarrollo y Soporte' },
  { id: 2, nombre: 'Dirección General de Administración' },
  { id: 3, nombre: 'Dirección de Recursos Humanos' },
  { id: 4, nombre: 'Dirección de Asuntos Jurídicos' },
  { id: 5, nombre: 'Dirección General de Bosques Nativos' },
  { id: 6, nombre: 'Dirección de Áreas Naturales Protegidas' },
  { id: 7, nombre: 'Dirección de Impacto Ambiental' },
  { id: 8, nombre: 'Mesa de Entradas y Despacho' },
] as const;

export interface CategoriaBase {
  nombre: string;
  descripcion: string;
  icono: string;
  prioridad: Prioridad;
  respuestaMin: number;
  resolucionMin: number;
  campos: CampoExtra[];
  /** Solo se aplica en la demo (en una instalación real quedan en `manual`). */
  modo: ModoAsignacion;
  /** Para `fija`: índice del técnico de demostración. */
  tecnico?: number;
}

const campo = (
  clave: string,
  etiqueta: string,
  tipo: CampoExtra['tipo'],
  requerido = false,
  opciones?: string[],
  ayuda?: string,
): CampoExtra => ({ clave, etiqueta, tipo, requerido, ...(opciones && { opciones }), ...(ayuda && { ayuda }) });

export const CATEGORIAS_BASE: CategoriaBase[] = [
  {
    nombre: 'Internet/Red',
    descripcion: 'Sin conexión, lentitud o problemas con la red cableada',
    icono: 'network',
    prioridad: 'alta',
    respuestaMin: 60,
    resolucionMin: 480,
    campos: [
      campo('alcance', '¿A quiénes afecta?', 'seleccion', true, ['Solo a mí', 'A mi oficina', 'A todo el edificio']),
    ],
    modo: 'fija',
    tecnico: 0,
  },
  {
    nombre: 'Wi-Fi',
    descripcion: 'Conexión inalámbrica y contraseñas de la red',
    icono: 'wifi',
    prioridad: 'media',
    respuestaMin: 120,
    resolucionMin: 720,
    campos: [campo('dispositivo', 'Dispositivo', 'seleccion', false, ['Notebook', 'Celular', 'Tablet', 'Otro'])],
    modo: 'round_robin',
  },
  {
    nombre: 'PC no enciende',
    descripcion: 'La computadora no arranca o se apaga sola',
    icono: 'monitor-x',
    prioridad: 'alta',
    respuestaMin: 60,
    resolucionMin: 720,
    campos: [
      campo('inventario', 'N.º de inventario', 'texto', false, undefined, 'Figura en la etiqueta del equipo'),
      campo('hace_ruido', '¿Hace algún ruido o enciende alguna luz?', 'casilla'),
    ],
    modo: 'round_robin',
  },
  {
    nombre: 'Impresora',
    descripcion: 'Atascos, tóner, escáner y configuración',
    icono: 'printer',
    prioridad: 'media',
    respuestaMin: 120,
    resolucionMin: 960,
    campos: [
      campo('modelo', 'Modelo de la impresora', 'texto'),
      campo('problema', 'Tipo de problema', 'seleccion', true, [
        'No imprime',
        'Atasco de papel',
        'Falta tóner',
        'Escáner',
        'Otro',
      ]),
    ],
    modo: 'round_robin',
  },
  {
    nombre: 'Correo',
    descripcion: 'Correo institucional: acceso, envío y recepción',
    icono: 'mail',
    prioridad: 'media',
    respuestaMin: 120,
    resolucionMin: 720,
    campos: [campo('cuenta', 'Cuenta afectada', 'texto', true, undefined, 'Dirección de correo completa')],
    modo: 'fija',
    tecnico: 1,
  },
  {
    nombre: 'Alta/baja de usuario',
    descripcion: 'Altas, bajas y permisos de usuarios',
    icono: 'user-cog',
    prioridad: 'media',
    respuestaMin: 240,
    resolucionMin: 1440,
    campos: [
      campo('tipo', 'Trámite', 'seleccion', true, ['Alta', 'Baja', 'Cambio de permisos']),
      campo('persona', 'Nombre y apellido de la persona', 'texto', true),
      campo('fecha_efectiva', 'Fecha a partir de la cual rige', 'fecha'),
    ],
    modo: 'fija',
    tecnico: 2,
  },
  {
    nombre: 'Sistemas del Ministerio',
    descripcion: 'Errores o consultas sobre sistemas propios',
    icono: 'app-window',
    prioridad: 'alta',
    respuestaMin: 90,
    resolucionMin: 960,
    campos: [
      campo('sistema', 'Sistema', 'seleccion', true, ['Expedientes', 'Personal', 'Guías forestales', 'Otro']),
      campo('mensaje_error', 'Mensaje de error', 'texto_largo'),
    ],
    modo: 'fija',
    tecnico: 1,
  },
  {
    nombre: 'Telefonía/interno',
    descripcion: 'Teléfonos fijos e internos',
    icono: 'phone',
    prioridad: 'baja',
    respuestaMin: 240,
    resolucionMin: 2160,
    campos: [campo('interno', 'Número de interno', 'numero')],
    modo: 'manual',
  },
  {
    nombre: 'Software/instalación',
    descripcion: 'Instalación y actualización de programas',
    icono: 'package-plus',
    prioridad: 'baja',
    respuestaMin: 240,
    resolucionMin: 1440,
    campos: [campo('programa', 'Programa solicitado', 'texto', true)],
    modo: 'round_robin',
  },
  {
    nombre: 'Proyector/sala',
    descripcion: 'Proyectores, pantallas y salas de reunión',
    icono: 'projector',
    prioridad: 'media',
    respuestaMin: 60,
    resolucionMin: 480,
    campos: [
      campo('sala', 'Sala', 'seleccion', true, ['Salón principal', 'Sala de reuniones', 'Otra']),
      campo('fecha_evento', 'Fecha de la actividad', 'fecha'),
    ],
    modo: 'manual',
  },
  {
    nombre: 'Cámaras',
    descripcion: 'Cámaras de seguridad y grabaciones',
    icono: 'cctv',
    prioridad: 'media',
    respuestaMin: 120,
    resolucionMin: 1440,
    campos: [campo('ubicacion_camara', 'Ubicación de la cámara', 'texto')],
    modo: 'manual',
  },
  {
    nombre: 'Otro',
    descripcion: 'Cualquier otro pedido de soporte',
    icono: 'circle-help',
    prioridad: 'baja',
    respuestaMin: 240,
    resolucionMin: 2160,
    campos: [],
    modo: 'manual',
  },
];
