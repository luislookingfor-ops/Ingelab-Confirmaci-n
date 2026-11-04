import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://hfxgmeykdxnoapqdspzn.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_KEY || 'sb_publishable_cx0IDgIzs4N6hIbhcklc2A_SEh2yPrQ';

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Servir archivos estáticos del proyecto (logo, banner, etc.)
app.use(express.static(__dirname));
app.use('/assets', express.static(__dirname));

// Endpoint de verificación
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'INGELAB Confirmación de Asistencia',
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

// Todas las demás peticiones van a index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
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

// Exportación requerida para Vercel Serverless Functions / Express
export default app;
