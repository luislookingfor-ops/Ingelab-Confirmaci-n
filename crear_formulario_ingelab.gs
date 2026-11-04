/**
 * SCRIPT DE GOOGLE APPS SCRIPT PARA GENERAR AUTOMÁTICAMENTE EL FORMULARIO
 * 
 * INSTRUCCIONES:
 * 1. Ve a https://script.google.com o crea un nuevo proyecto en Google Apps Script.
 * 2. Borra el código existente y pega este archivo completo.
 * 3. Haz clic en "Ejecutar" (Run).
 * 4. Acepta los permisos de Google (solo la primera vez).
 * 5. ¡Listo! En el panel "Registro de ejecución" verás el enlace público de tu formulario.
 */

function crearFormularioIngelab() {
  // 1. Crear el formulario con título
  const form = FormApp.create('Confirmación de Asistencia - Evento INGELAB 2026');
  
  // 2. Descripción institucional del evento
  form.setDescription(
    'Estimado(a) colega y aliado estratégico:\n\n' +
    'En INGELAB nos complace invitarle a nuestro gran evento institucional y de relacionamiento.\n\n' +
    '📅 Fecha: Viernes, 13 de Noviembre de 2026\n' +
    '⏰ Hora: [Especificar Hora, ej: 18:00 hrs]\n' +
    '📍 Lugar: [Especificar Salón / Hotel / Sede]\n' +
    '🎯 Dirigido a: Profesionales, directores de laboratorio clínico y aliados comerciales.\n\n' +
    'Por favor confirme su participación completando los siguientes datos antes del [Fecha Límite].'
  );

  // Configuración general
  form.setAllowResponseEdits(true);
  form.setCollectEmail(true);
  form.setShowLinkToRespondAgain(false);
  form.setConfirmationMessage(
    '¡Muchas gracias por confirmar tu asistencia!\n\n' +
    'En INGELAB nos complace contar con tu presencia el próximo 13 de noviembre de 2026. ' +
    'Te hemos enviado un correo de confirmación y en los próximos días recibirás la agenda detallada.'
  );

  // PREGUNTA 1: Nombre completo
  form.addTextItem()
    .setTitle('Nombre y Apellidos completos')
    .setHelpText('Tal como desea que aparezca en su escarapela / acreditación.')
    .setRequired(true);

  // PREGUNTA 2: Institución / Laboratorio
  form.addTextItem()
    .setTitle('Institución, Clínica o Laboratorio Clínico al que representa')
    .setRequired(true);

  // PREGUNTA 3: Cargo o Especialidad
  form.addTextItem()
    .setTitle('Cargo o Especialidad')
    .setHelpText('Ej: Director Técnico, Bioquímico, Jefe de Compras, etc.')
    .setRequired(true);

  // PREGUNTA 4: WhatsApp / Teléfono móvil
  form.addTextItem()
    .setTitle('Número de Teléfono / WhatsApp')
    .setHelpText('Para enviarle recordatorios y detalles de acceso.')
    .setRequired(true);

  // PREGUNTA 5: Confirmación de asistencia (con bifurcación o simple)
  const asistenciaItem = form.addMultipleChoiceItem();
  asistenciaItem.setTitle('¿Confirmas tu asistencia al evento el 13 de Noviembre de 2026?')
    .setChoiceValues([
      'Sí, asistiré con total seguridad',
      'No podré asistir en esta ocasión'
    ])
    .setRequired(true);

  // PREGUNTA 6: Acompañante
  form.addMultipleChoiceItem()
    .setTitle('¿Asistirás con un acompañante?')
    .setHelpText('Sujeto a aforo disponible.')
    .setChoiceValues([
      'Asistiré solo(a)',
      'Asistiré con un(a) colega / acompañante'
    ])
    .setRequired(true);

  // PREGUNTA 7: Restricciones alimentarias / Cóctel
  form.addCheckboxItem()
    .setTitle('Requerimientos alimentarios para el servicio de cóctel/catering')
    .setChoiceValues([
      'Ninguna / Estándar',
      'Vegetariano',
      'Vegano',
      'Celíaco (Sin gluten)',
      'Intolerante a la lactosa',
      'Otro'
    ])
    .showOtherOption(true)
    .setRequired(false);

  // PREGUNTA 8: Comentarios adicionales
  form.addParagraphTextItem()
    .setTitle('¿Desea dejar algún comentario, consulta o requerimiento para el equipo de INGELAB?')
    .setRequired(false);

  // 3. Crear hoja de cálculo vinculada automáticamente para recibir las respuestas
  const spreadsheet = SpreadsheetApp.create('Respuestas - Confirmación Asistencia INGELAB 2026');
  form.setDestination(FormApp.DestinationType.SPREADSHEET, spreadsheet.getId());

  // 4. Imprimir URLs en consola
  const publishedUrl = form.getPublishedUrl();
  const editUrl = form.getEditUrl();
  const sheetUrl = spreadsheet.getUrl();

  Logger.log('====================================================');
  Logger.log('🎉 ¡FORMULARIO DE INGELAB CREADO CON ÉXITO!');
  Logger.log('====================================================');
  Logger.log('👉 LINK PÚBLICO PARA COMPARTIR: ' + publishedUrl);
  Logger.log('✏️ LINK PARA EDITAR: ' + editUrl);
  Logger.log('📊 LINK DE LA HOJA DE RESPUESTAS (SHEET): ' + sheetUrl);
  Logger.log('====================================================');
}
