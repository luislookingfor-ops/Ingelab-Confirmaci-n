import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { 
  db,
  initDB, 
  createAttendee, 
  getAllAttendees, 
  deleteAttendee, 
  getStats,
  getAttendeeByTicket,
  recordGalleryAccess,
  getGalleryAccessLogs
} from './database.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Inicializar base de datos SQLite con soporte para C.I. y Boletos
initDB();

// Sincronización automática de asistentes de Supabase a SQLite local
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfxgmeykdxnoapqdspzn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_cx0IDgIzs4N6hIbhcklc2A_SEh2yPrQ';

async function syncFromSupabase() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/attendees?select=*&order=id.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!res.ok) return;
    const list = await res.json();
    if (!Array.isArray(list) || list.length === 0) return;

    const stmt = db.prepare(`
      INSERT OR REPLACE INTO attendees (
        id, ticket_code, full_name, ci, institution, position, email, phone,
        ticket_count, ticket_list, attending, companion, companion_name, dietary, comments, created_at
      ) VALUES (
        ?, ?, ?, ?, ?, ?, ?,
        ?, ?, ?, ?, ?, ?, ?, ?, ?
      )
    `);

    db.exec('BEGIN TRANSACTION');
    for (const a of list) {
      let finalComments = a.comments || '';
      
      // Preservar tags de fotos locales si Supabase vino sin ellos
      try {
        const existing = db.prepare('SELECT comments FROM attendees WHERE id = ?').get(a.id);
        if (existing && existing.comments && existing.comments.includes('FOTOS_ACCESO') && !finalComments.includes('FOTOS_ACCESO')) {
          const fotosMatch = existing.comments.match(/\[FOTOS_ACCESO:[^\]]+\]/);
          if (fotosMatch) {
            finalComments = `${fotosMatch[0]} ${finalComments}`.trim();
          }
        }
      } catch (e) {}

      // Si existe en logs de auditoría local de fotos, asegurar tag de acceso
      const cleanCi = (a.ci || '').replace(/\D/g, '').trim();
      if (cleanCi && !finalComments.includes('FOTOS_ACCESO')) {
        try {
          const log = db.prepare('SELECT created_at, authorized_media FROM gallery_access_logs WHERE ci = ? ORDER BY id DESC LIMIT 1').get(cleanCi);
          if (log) {
            finalComments = `[FOTOS_ACCESO: ${log.created_at} | FOTOS_AUTORIZO: ${log.authorized_media ? 'SI' : 'NO'}] ${finalComments}`.trim();
          }
        } catch (e) {}
      }

      stmt.run(
        a.id,
        a.ticket_code || `ING-${a.id}`,
        a.full_name || '',
        a.ci || '',
        a.institution || '',
        a.position || '',
        a.email || '',
        a.phone || '',
        a.ticket_count || 1,
        Array.isArray(a.ticket_list) ? a.ticket_list.join(', ') : (a.ticket_list || ''),
        a.attending || 'yes',
        a.companion || 'no',
        a.companion_name || '',
        Array.isArray(a.dietary) ? a.dietary.join(', ') : (a.dietary || ''),
        finalComments,
        a.created_at || new Date().toISOString()
      );
    }
    db.exec('COMMIT');
    console.log(`✅ Sincronizados ${list.length} asistentes de Supabase a SQLite local.`);
  } catch (err) {
    console.warn('Sync warning from Supabase:', err.message);
  }
}
syncFromSupabase().catch(() => {});


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
    const logs = getGalleryAccessLogs();
    
    // Mapear logs de auditoría por C.I. (el más reciente por CI)
    const logsByCi = new Map();
    for (const log of logs) {
      const clean = (log.ci || '').replace(/\D/g, '').trim();
      if (!clean) continue;
      const existing = logsByCi.get(clean);
      if (!existing || new Date(log.created_at) > new Date(existing.created_at)) {
        logsByCi.set(clean, log);
      }
    }

    // Enriquecer asistentes con su estado de acceso a fotos
    const enriched = attendees.map(a => {
      const cleanCi = (a.ci || '').replace(/\D/g, '').trim();
      const log = cleanCi ? logsByCi.get(cleanCi) : null;
      // También verificar tag en comments si no hay log
      const galleryMatch = (a.comments || '').match(/\[FOTOS_ACCESO:\s*([^\|\]]+)(?:\|\s*FOTOS_AUTORIZO:\s*([^\]]+))?\]/);
      const galleryAtFromComments = galleryMatch ? galleryMatch[1].trim() : null;
      const galleryAuthFromComments = galleryMatch && galleryMatch[2] ? galleryMatch[2].trim() === 'SI' : false;
      
      if (log) {
        return {
          ...a,
          gallery_access_at: log.created_at,
          gallery_media_auth: Boolean(log.authorized_media)
        };
      } else if (galleryAtFromComments) {
        return {
          ...a,
          gallery_access_at: galleryAtFromComments,
          gallery_media_auth: galleryAuthFromComments
        };
      }
      return a;
    });

    // Deduplicar por CI en el servidor: por cada CI, quedarse con el registro
    // que tenga gallery_access_at, o el de mayor ID si ninguno lo tiene.
    const byCi = new Map();
    const noCI = [];
    for (const a of enriched) {
      const cleanCi = (a.ci || '').replace(/\D/g, '').trim();
      if (!cleanCi) { noCI.push(a); continue; }
      const existing = byCi.get(cleanCi);
      if (!existing) {
        byCi.set(cleanCi, a);
      } else {
        // Preferir el que tiene gallery_access_at; si ambos o ninguno, el de mayor ID
        const aHasGallery = Boolean(a.gallery_access_at);
        const exHasGallery = Boolean(existing.gallery_access_at);
        if (aHasGallery && !exHasGallery) {
          byCi.set(cleanCi, a);
        } else if (!aHasGallery && exHasGallery) {
          // keep existing
        } else {
          // Ambos o ninguno: quedarse con el de mayor ID (más reciente en Supabase)
          if (Number(a.id) > Number(existing.id)) {
            byCi.set(cleanCi, { ...a, gallery_access_at: a.gallery_access_at || existing.gallery_access_at, gallery_media_auth: a.gallery_media_auth || existing.gallery_media_auth });
          }
        }
      }
    }
    const deduped = [...byCi.values(), ...noCI];

    res.json({ success: true, attendees: deduped });
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

// Registrar acceso y consentimiento de la galería fotográfica con C.I.
app.post('/api/gallery-access', (req, res) => {
  try {
    const { ci, acceptedTerms, authorizedMedia } = req.body;
    const cleanCi = (ci || '').replace(/\D/g, '').trim();

    if (!cleanCi || cleanCi.length < 9) {
      return res.status(400).json({ 
        success: false, 
        error: 'Por favor ingrese un número de cédula válido (al menos 9 dígitos).' 
      });
    }

    if (!acceptedTerms) {
      return res.status(400).json({ 
        success: false, 
        error: 'Debe aceptar los términos y condiciones obligatorios para ingresar.' 
      });
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
    const userAgent = req.headers['user-agent'] || '';

    const result = recordGalleryAccess({
      ci: cleanCi,
      acceptedTerms,
      authorizedMedia,
      ip,
      userAgent
    });

    if (!result.success) {
      return res.status(403).json(result);
    }

    // Persistir también de forma permanente en Supabase (INSERT)
    if (result.attendee) {
      const nowIso = result.created_at || new Date().toISOString();
      const updatedComments = `[FOTOS_ACCESO: ${nowIso} | FOTOS_AUTORIZO: ${authorizedMedia ? 'SI' : 'NO'}]`;
      fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          full_name: result.attendee.full_name,
          ci: result.attendee.ci || cleanCi,
          email: `${cleanCi}@ingelab.com`,
          phone: '0000000000',
          ticket_count: 1,
          institution: 'Particular',
          position: 'Profesional',
          attending: 'yes',
          comments: updatedComments,
          created_at: nowIso
        }])
      }).catch(e => console.warn('Sync to Supabase err:', e.message));
    }

    res.json(result);
  } catch (err) {
    console.error('Error al registrar acceso a galería:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// Consultar auditoría de accesos a la galería (Unifica SQLite local + Supabase)
app.get('/api/gallery-access-logs', async (req, res) => {
  try {
    const localLogs = getGalleryAccessLogs();
    const logs = [...localLogs];

    // Enriquecer con registros de Supabase si existen
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?select=id,full_name,ci,comments,created_at&comments=ilike.*FOTOS_ACCESO*&order=id.desc`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (getRes.ok) {
        const cloudRows = await getRes.json();
        for (const row of cloudRows) {
          const match = (row.comments || '').match(/\[FOTOS_ACCESO:\s*([^|\]]+)(?:\|\s*FOTOS_AUTORIZO:\s*([^\]]+))?\]/);
          if (match) {
            const rowCi = (row.ci || '').replace(/\D/g, '').trim();
            if (rowCi && !logs.some(l => (l.ci || '').replace(/\D/g, '').trim() === rowCi)) {
              logs.push({
                id: row.id,
                ci: row.ci,
                full_name: row.full_name,
                attendee_id: row.id,
                accepted_terms: true,
                authorized_media: match[2] ? match[2].trim() === 'SI' : false,
                created_at: match[1].trim()
              });
            }
          }
        }
      }
    } catch (e) {}

    res.json({ success: true, logs });
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
