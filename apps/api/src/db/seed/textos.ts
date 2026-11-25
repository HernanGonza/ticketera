/** Textos de los pedidos de demostración: [título, descripción, solución] por categoría. */
export const PEDIDOS: Record<string, [string, string, string][]> = {
  'Internet/Red': [
    ['Sin conexión a Internet en la oficina', 'Desde esta mañana ninguna computadora de la oficina tiene Internet.', 'Se reemplazó el patch cord del switch y volvió la conexión.'],
    ['La red está muy lenta', 'Abrir cualquier página demora varios minutos.', 'Había un equipo saturando el enlace; ya se normalizó.'],
    ['No accedo a las carpetas compartidas', 'Al abrir la unidad de red aparece un error de acceso.', 'Se volvió a mapear la unidad de red con sus credenciales.'],
  ],
  'Wi-Fi': [
    ['No me puedo conectar al Wi-Fi', 'La notebook ve la red pero rechaza la contraseña.', 'Se actualizó la contraseña guardada en el equipo.'],
    ['El Wi-Fi se corta en la sala de reuniones', 'La señal se pierde cada pocos minutos.', 'Se reubicó el punto de acceso y se cambió el canal.'],
  ],
  'PC no enciende': [
    ['La computadora no enciende', 'Presiono el botón y no pasa nada.', 'La fuente estaba dañada; se reemplazó.'],
    ['El equipo se apaga solo', 'Se apaga a los pocos minutos de uso.', 'Se limpió el equipo y se cambió la pasta térmica.'],
    ['Pantalla negra al iniciar', 'Enciende la luz pero el monitor queda en negro.', 'Se reajustó el módulo de memoria.'],
  ],
  Impresora: [
    ['La impresora no imprime', 'Los trabajos quedan en la cola y no salen.', 'Se reinició la cola de impresión y se reinstaló el controlador.'],
    ['Atasco de papel recurrente', 'Se traba el papel en cada impresión.', 'Se retiró un resto de papel y se limpiaron los rodillos.'],
    ['Necesitamos tóner', 'Las hojas salen muy claras.', 'Se colocó un tóner nuevo.'],
    ['No funciona el escáner', 'No puedo escanear a la carpeta compartida.', 'Se corrigió la ruta de destino del escáner.'],
  ],
  Correo: [
    ['No puedo ingresar a mi correo', 'Me pide la contraseña una y otra vez.', 'Se restableció la contraseña de la cuenta.'],
    ['No me llegan los correos', 'Hace dos días que no recibo mensajes.', 'La casilla estaba llena; se liberó espacio.'],
    ['Configurar el correo en el celular', 'Necesito recibir el correo institucional en el teléfono.', 'Se configuró la cuenta en el dispositivo.'],
  ],
  'Alta/baja de usuario': [
    ['Alta de usuario para personal nuevo', 'Ingresa una persona al área y necesita usuario y correo.', 'Usuario y correo creados; se enviaron las credenciales.'],
    ['Baja de usuario', 'La persona dejó de prestar servicios en el área.', 'Se deshabilitaron el usuario y el correo.'],
    ['Permisos para una carpeta del área', 'Necesito acceso de escritura a la carpeta de informes.', 'Se otorgaron los permisos solicitados.'],
  ],
  'Sistemas del Ministerio': [
    ['Error al guardar un expediente', 'El sistema muestra un error al confirmar el pase.', 'Se corrigió el dato que impedía guardar el expediente.'],
    ['No puedo emitir guías forestales', 'La pantalla queda cargando al generar la guía.', 'Se reinició el servicio de emisión y se verificó el circuito.'],
    ['Reporte de personal con datos incompletos', 'Faltan agentes en el listado mensual.', 'Se ajustó el filtro del reporte.'],
  ],
  'Telefonía/interno': [
    ['El interno no tiene tono', 'El teléfono del escritorio está mudo.', 'Se reparó la ficha de la línea.'],
    ['Cambio de nombre en un interno', 'El interno figura con el nombre de otra persona.', 'Se actualizó la guía de internos.'],
  ],
  'Software/instalación': [
    ['Instalar programa de mapas', 'Necesito QGIS para trabajar con las capas de bosques.', 'Se instaló la última versión estable.'],
    ['Actualizar la suite de oficina', 'No puedo abrir archivos nuevos.', 'Se actualizó la suite de oficina.'],
    ['Instalar lector de firma digital', 'Necesito firmar documentos desde mi equipo.', 'Se instaló el controlador del token.'],
  ],
  'Proyector/sala': [
    ['El proyector no detecta la notebook', 'Tenemos reunión y no se ve la imagen.', 'Se reemplazó el cable HDMI.'],
    ['Preparar sala para videoconferencia', 'Necesitamos cámara y audio para una reunión virtual.', 'Se dejó la sala probada y lista.'],
  ],
  Cámaras: [
    ['Cámara de la entrada sin imagen', 'En el monitor aparece sin señal.', 'Se reemplazó la fuente de la cámara.'],
    ['Solicitud de grabación', 'Necesitamos revisar la grabación del acceso principal.', 'Se entregó el fragmento solicitado.'],
  ],
  Otro: [
    ['Mudanza de puesto de trabajo', 'Cambiamos de oficina y hay que trasladar el equipo.', 'Se trasladó e instaló el equipo en el nuevo puesto.'],
    ['Consulta sobre equipo nuevo', 'Queremos saber cómo pedir una notebook.', 'Se envió el instructivo del pedido.'],
  ],
};

export const UBICACIONES = [
  'Planta baja, oficina 3',
  'Primer piso, oficina 12',
  'Interno 214',
  'Mesa de entradas',
  'Interno 118',
  'Segundo piso',
  null,
];

export const PRIMERAS_RESPUESTAS = [
  'Buen día. Recibimos su pedido y ya lo estamos revisando.',
  'Hola, en un momento me acerco a verificarlo.',
  'Recibido. ¿Podría confirmarnos si el inconveniente sigue ocurriendo?',
  'Tomamos su pedido. Le avisamos apenas tengamos novedades.',
];
export const RESPUESTAS_SOLICITANTE = [
  'Sí, sigue igual. Gracias.',
  'Estoy en la oficina hasta las 13.',
  'Ya probé reiniciar y no cambió nada.',
  '¿Tienen una idea de cuándo podrían pasar?',
];
export const MENSAJES_ESPERA = [
  'Quedamos a la espera de un repuesto para continuar.',
  'Necesitamos que nos confirme un horario para revisar el equipo.',
  'Se hizo el reclamo al proveedor; aguardamos respuesta.',
];
export const NOTAS_INTERNAS = [
  'Revisar si hay otro equipo con la misma falla en el área.',
  'Queda un repuesto en el depósito.',
  'Ya había ocurrido el mes pasado; conviene reemplazarlo.',
];
export const AGRADECIMIENTOS = ['¡Muchas gracias! Funciona bien.', 'Perfecto, quedó resuelto.', 'Gracias por la rapidez.'];
export const MOTIVOS_REAPERTURA = ['El problema volvió a ocurrir.', 'Todavía no funciona correctamente.'];
export const COMENTARIOS = ['Muy buena atención.', 'Rápido y claro.', 'Tardó un poco, pero quedó bien.', null, null, null];

export const RESPUESTAS_RAPIDAS = [
  ['Pedido recibido', 'Buen día. Recibimos su pedido y ya lo estamos revisando.'],
  ['Solicitar más datos', 'Para avanzar necesitamos que nos indique **qué estaba haciendo** cuando ocurrió el problema y, si puede, adjunte una captura de pantalla.'],
  ['Reiniciar el equipo', 'Le pedimos que reinicie el equipo y nos confirme si el inconveniente persiste.'],
  ['Coordinar visita', '¿En qué horario podemos acercarnos a su puesto de trabajo?'],
  ['A la espera de repuesto', 'Quedamos a la espera de un repuesto. Le avisaremos apenas esté disponible.'],
  ['Resuelto', 'Su pedido quedó resuelto. Si el problema vuelve a ocurrir puede reabrirlo desde esta misma pantalla. Le agradeceremos que califique la atención.'],
] as const;
