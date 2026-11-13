import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  initDB, 
  createAttendee, 
  getAllAttendees, 
  deleteAttendee, 
  getStats,
  getAttendeeByTicket
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar base de datos SQLite con soporte para C.I. y Boletos
initDB();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del frontend
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(__dirname));

// ==========================================
// RUTAS API
// ==========================================

// Estado y métricas
app.get('/api/stats', (req, res) => {
  try {
    const stats = getStats();
    res.json({ success: true, stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Guardar nueva confirmación de asistencia
app.post('/api/confirm', (req, res) => {
  try {
    const { 
      fullName, 
      ci,
      email, 
      phone, 
      ticketCount,
      institution, 
      position, 
      attending, 
      companion, 
      companionName, 
      dietary, 
      comments 
    } = req.body;

    // Validación: Todos los campos son obligatorios a excepción de fecha de nacimiento
    if (!fullName || !ci || !email || !phone || !institution || !position) {
      return res.status(400).json({ 
        success: false, 
        error: 'Por favor complete todos los campos obligatorios (*).' 
      });
    }

    const attendee = createAttendee({
      fullName,
      ci: ci || '',
      email: email || '',
      phone: phone || '',
      ticketCount: ticketCount || 1,
      institution: institution || 'Ingelab',
      position: position || 'Participante',
      attending: attending || 'yes',
      companion: companion || 'no',
      companionName: companionName || '',
      dietary: dietary || 'Menú Estándar',
      comments: comments || ''
    });

    res.status(201).json({
      success: true,
      message: '¡Registro guardado exitosamente en la base de datos!',
      attendee
    });
  } catch (err) {
    console.error('Error al guardar asistencia:', err);
    res.status(500).json({ success: false, error: 'Error interno: ' + err.message });
  }
});

// Consultar lista de asistentes (Panel de control)
app.get('/api/attendees', (req, res) => {
  try {
    const attendees = getAllAttendees();
    res.json({ success: true, attendees });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Consultar ticket por código
app.get('/api/ticket/:code', (req, res) => {
  try {
    const attendee = getAttendeeByTicket(req.params.code);
    if (!attendee) {
      return res.status(404).json({ success: false, error: 'Pase de asistencia no encontrado.' });
    }
    res.json({ success: true, attendee });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar un registro
app.delete('/api/attendees/:id', (req, res) => {
  try {
    const { id } = req.params;
    deleteAttendee(id);
    res.json({ success: true, message: 'Registro eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Exportar respuestas en CSV compatible con Excel
app.get('/api/export-csv', (req, res) => {
  try {
    const attendees = getAllAttendees();
    
    const headers = [
      'ID',
      'Código Principal',
      'Participante',
      'C.I. / Documento',
      'Correo Electrónico',
      'Teléfono / WhatsApp',
      'Cant. Boletos',
      'Lista de Boletos',
      'Institución / Laboratorio',
      'Cargo',
      'Estado Asistencia',
      'Requerimientos Dietéticos',
      'Comentarios',
      'Fecha Registro'
    ];

    const escapeCsv = (val) => {
      if (val === null || val === undefined) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    let csvContent = '\uFEFF' + headers.join(';') + '\n';

    attendees.forEach(a => {
      const row = [
        a.id,
        a.ticket_code,
        a.full_name,
        a.ci || '',
        a.email,
        a.phone,
        a.ticket_count || 1,
        a.ticket_list || a.ticket_code,
        a.institution || '',
        a.position || '',
        a.attending === 'yes' ? 'CONFIRMADO' : 'NO ASISTE',
        a.dietary || 'Menú Estándar',
        a.comments || '',
        a.created_at
      ].map(escapeCsv).join(';');
      csvContent += row + '\n';
    });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename=Asistentes_INGELAB_13Nov2026.csv');
    res.send(csvContent);
  } catch (err) {
    res.status(500).send('Error generando archivo CSV: ' + err.message);
  }
});

// Redirigir cualquier otra petición a la aplicación web
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.listen(PORT, () => {
  console.log(`
  ==============================================================
  🚀 SERVIDOR WEB INGELAB INICIADO EXITOSAMENTE
  ==============================================================
  🌐 URL Local:      http://localhost:${PORT}
  📊 Panel Admin:    http://localhost:${PORT}#admin
  💾 Base de Datos:  SQLite (ingelab_evento.db)
  📅 Fecha Evento:   13 de Noviembre de 2026
  ==============================================================
  `);
});
