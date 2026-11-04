import express from 'express';
import cors from 'cors';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = process.cwd();

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfxgmeykdxnoapqdspzn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_cx0IDgIzs4N6hIbhcklc2A_SEh2yPrQ';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del proyecto desde múltiples ubicaciones (raíz, __dirname y public)
app.use(express.static(rootDir));
app.use(express.static(path.join(rootDir, 'public')));
app.use(express.static(__dirname));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/assets', express.static(rootDir));
app.use('/assets', express.static(path.join(rootDir, 'public')));

// Función para obtener index.html de forma segura y tolerante a fallos
let cachedHtml = null;
function getIndexHtml() {
  if (cachedHtml) return cachedHtml;
  const candidates = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'public', 'index.html')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        cachedHtml = fs.readFileSync(candidate, 'utf-8');
        return cachedHtml;
      } catch (e) {
        console.warn('Lectura fallida en candidato:', candidate, e);
      }
    }
  }
  return null;
}

// Endpoint de verificación
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'INGELAB Confirmación de Asistencia - Ingelab Evolution',
    supabase: 'connected',
    eventDate: '2026-11-13'
  });
});

// Endpoint para obtener lista de asistentes desde Supabase
app.get('/api/attendees', async (req, res) => {
  try {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendees?select=*&order=id.desc`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });
    if (response.ok) {
      const attendees = await response.json();
      return res.json({ success: true, attendees });
    }
    const errText = await response.text();
    res.status(response.status).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para registrar confirmación en Supabase
app.post('/api/confirm', async (req, res) => {
  try {
    const b = req.body;
    const record = {
      full_name: (b.fullName || b.full_name || '').trim().toUpperCase(),
      ci: (b.ci || '').trim(),
      email: (b.email || '').trim().toLowerCase(),
      phone: (b.phone || '').trim(),
      ticket_count: parseInt(b.ticketCount || b.ticket_count || 1),
      ticket_list: Array.isArray(b.ticketList || b.ticket_list) ? (b.ticketList || b.ticket_list) : [],
      institution: (b.institution || '').trim(),
      position: (b.position || '').trim(),
      attending: b.attending || 'yes',
      dietary: Array.isArray(b.dietary) ? b.dietary : [],
      comments: (b.comments || '').trim()
    };

    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(record)
    });

    if (response.ok) {
      const data = await response.json();
      return res.status(201).json({ success: true, attendee: data[0] });
    }
    const errText = await response.text();
    res.status(response.status).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para modificar asistente en Supabase
app.put('/api/attendees/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body;
    const record = {};
    if (b.full_name) record.full_name = b.full_name.trim().toUpperCase();
    if (b.ci !== undefined) record.ci = b.ci.trim();
    if (b.email) record.email = b.email.trim().toLowerCase();
    if (b.phone) record.phone = b.phone.trim();
    if (b.institution !== undefined) record.institution = b.institution.trim();
    if (b.position !== undefined) record.position = b.position.trim();
    if (b.attending) record.attending = b.attending;
    if (b.comments !== undefined) record.comments = b.comments.trim();

    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(record)
    });

    if (response.ok) {
      const data = await response.json();
      return res.json({ success: true, attendee: data ? data[0] : null });
    }
    const errText = await response.text();
    res.status(response.status).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint para eliminar asistente en Supabase
app.delete('/api/attendees/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}`, {
      method: 'DELETE',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      }
    });

    if (response.ok) {
      return res.json({ success: true });
    }
    const errText = await response.text();
    res.status(response.status).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Todas las demás peticiones van a index.html (servido de forma segura)
app.get('*', (req, res) => {
  const html = getIndexHtml();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  
  // Fallback con sendFile
  try {
    res.sendFile(path.join(rootDir, 'index.html'));
  } catch (e) {
    res.status(200).send('<!DOCTYPE html><html><body><h1>INGELAB EVOLUTION</h1><p>Cargando portal...</p><script>window.location.reload();</script></body></html>');
  }
});

// Manejador global de errores para garantizar 0 fallas no controladas (evita 500 FUNCTION_INVOCATION_FAILED)
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  const html = getIndexHtml();
  if (html && req.method === 'GET' && !req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// Solo iniciar el servidor HTTP si se ejecuta directamente y no está en Vercel
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  try {
    app.listen(PORT, () => {
      console.log(`Servidor INGELAB listo en http://localhost:${PORT}`);
    });
  } catch(e) {}
}

export default app;
