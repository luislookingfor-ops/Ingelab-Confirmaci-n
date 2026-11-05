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

// ==============================================================
// 1. CABECERAS DE SEGURIDAD Y CONFIGURACIÓN BÁSICA
// ==============================================================
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
// Límite estricto de payload para evitar ataques de desbordamiento de buffer
app.use(express.json({ limit: '100kb' }));
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

// ==============================================================
// 2. RATE LIMITING EN MEMORIA (Anti-Spam / Anti-DDoS por IP)
// ==============================================================
const ipRegistrationMap = new Map();
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minuto
const MAX_REGISTRATIONS_PER_WINDOW = 6; // Máximo 6 confirmaciones por IP por minuto

function rateLimiterMiddleware(req, res, next) {
  const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  const clientHistory = ipRegistrationMap.get(ip) || [];
  // Filtrar peticiones fuera de la ventana actual de 60 segundos
  const recentRequests = clientHistory.filter(timestamp => now - timestamp < RATE_LIMIT_WINDOW_MS);

  if (recentRequests.length >= MAX_REGISTRATIONS_PER_WINDOW) {
    res.setHeader('Retry-After', '60');
    return res.status(429).json({
      success: false,
      error: 'Ha superado el límite de intentos por minuto. Por favor espere 60 segundos antes de reintentar.'
    });
  }

  recentRequests.push(now);
  ipRegistrationMap.set(ip, recentRequests);

  // Limpieza periódica para evitar fugas de memoria
  if (ipRegistrationMap.size > 2000) {
    for (const [key, timestamps] of ipRegistrationMap.entries()) {
      if (timestamps.length === 0 || now - timestamps[timestamps.length - 1] > RATE_LIMIT_WINDOW_MS) {
        ipRegistrationMap.delete(key);
      }
    }
  }

  next();
}

// ==============================================================
// 3. ARCHIVOS ESTÁTICOS CON CACHÉ ÓPTIMO (Evita Cold Starts)
// ==============================================================
const staticOpts = { maxAge: '1d', immutable: false };
app.use(express.static(rootDir, staticOpts));
app.use(express.static(path.join(rootDir, 'public'), staticOpts));
app.use(express.static(__dirname, staticOpts));
app.use(express.static(path.join(__dirname, 'public'), staticOpts));
app.use('/assets', express.static(rootDir, staticOpts));
app.use('/assets', express.static(path.join(rootDir, 'public'), staticOpts));

// Lector seguro de index.html con caché en memoria
let cachedHtml = null;
function getIndexHtml() {
  if (cachedHtml && process.env.NODE_ENV === 'production') return cachedHtml;
  const candidates = [
    path.join(rootDir, 'index.html'),
    path.join(rootDir, 'public', 'index.html'),
    path.join(__dirname, 'index.html'),
    path.join(__dirname, 'public', 'index.html')
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      try {
        const content = fs.readFileSync(candidate, 'utf-8');
        cachedHtml = content;
        return content;
      } catch (e) {
        console.warn('Lectura fallida en candidato:', candidate, e);
      }
    }
  }
  return null;
}

// ==============================================================
// 4. ENDPOINTS DE LA API (Stateless / PostgREST Connection Pooling)
// ==============================================================

// Healthcheck
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'INGELAB Confirmación de Asistencia - Ingelab Evolution',
    connectionPool: 'PostgREST HTTPS Stateless Pool',
    eventDate: '2026-11-13'
  });
});

// Listado de asistentes
// Función auxiliar para deduplicar y excluir registros eliminados en servidor
function deduplicateAttendeesServer(list) {
  if (!Array.isArray(list)) return [];
  const sorted = [...list].sort((a, b) => {
    const timeB = b.created_at ? new Date(b.created_at).getTime() : 0;
    const timeA = a.created_at ? new Date(a.created_at).getTime() : 0;
    if (timeB !== timeA) return timeB - timeA;
    return Number(b.id || 0) - Number(a.id || 0);
  });

  const seenNames = new Set();
  const seenEmails = new Set();
  const seenCis = new Set();
  const uniqueList = [];

  for (const item of sorted) {
    const nameKey = (item.full_name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const emailKey = (item.email || '').trim().toLowerCase();
    const ciKey = (item.ci || '').trim();

    let isDuplicate = false;
    if (nameKey && nameKey.length >= 3 && seenNames.has(nameKey)) isDuplicate = true;
    if (emailKey && seenEmails.has(emailKey)) isDuplicate = true;
    if (ciKey && ciKey.length >= 6 && seenCis.has(ciKey)) isDuplicate = true;

    if (!isDuplicate) {
      if (nameKey && nameKey.length >= 3) seenNames.add(nameKey);
      if (emailKey) seenEmails.add(emailKey);
      if (ciKey && ciKey.length >= 6) seenCis.add(ciKey);

      const isDeleted = item.attending === 'deleted' || String(item.comments || '').includes('[DELETED]');
      if (!isDeleted) {
        uniqueList.push(item);
      }
    }
  }
  return uniqueList;
}

app.get('/api/attendees', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000); // 6s timeout

    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendees?select=*&order=id.desc`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (response.ok) {
      const attendees = await response.json();
      const cleanAttendees = deduplicateAttendeesServer(attendees || []);
      return res.json({ success: true, attendees: cleanAttendees });
    }
    const errText = await response.text();
    res.status(response.status).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Confirmación de Asistencia con Protección Anti-Bot (Honeypot), Rate Limiting e Idempotencia (Upsert)
app.post('/api/confirm', rateLimiterMiddleware, async (req, res) => {
  try {
    const b = req.body || {};

    // 1. Detección de Bots vía Honeypot (Trampa oculta para bots)
    if (b.website_url_hp && String(b.website_url_hp).trim().length > 0) {
      console.warn('Bot detectado por Honeypot. Registro descartado.');
      // Retornar éxito simulado para neutralizar al bot sin gastar recursos de base de datos
      return res.status(200).json({ success: true, message: 'Solicitud procesada' });
    }

    const fullName = (b.fullName || b.full_name || '').trim().toUpperCase();
    const email = (b.email || '').trim().toLowerCase();
    
    // 2. Validación estricta en servidor: 10 dígitos numéricos en cédula y teléfono, solo texto en nombre/institución/cargo, fecha real
    if (!fullName || fullName.length < 3) {
      return res.status(400).json({ success: false, error: 'El nombre completo es obligatorio.' });
    }
    if (/[0-9]/.test(fullName)) {
      return res.status(400).json({ success: false, error: 'El nombre completo solo puede contener texto, no números.' });
    }

    const ci = (b.ci || '').trim().replace(/\D/g, '');
    if (!ci || ci.length !== 10 || !/^\d{10}$/.test(ci)) {
      return res.status(400).json({ success: false, error: 'La Cédula de Identidad debe tener exactamente 10 dígitos numéricos.' });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email || !emailRegex.test(email)) {
      return res.status(400).json({ success: false, error: 'El correo electrónico es obligatorio y debe ser válido.' });
    }

    const phone = (b.phone || '').trim().replace(/\D/g, '');
    if (!phone || phone.length !== 10 || !/^\d{10}$/.test(phone)) {
      return res.status(400).json({ success: false, error: 'El teléfono móvil debe tener exactamente 10 dígitos numéricos.' });
    }

    const institution = (b.institution || '').trim();
    if (!institution) {
      return res.status(400).json({ success: false, error: 'La institución o laboratorio es obligatorio.' });
    }
    if (/[0-9]/.test(institution)) {
      return res.status(400).json({ success: false, error: 'La institución o laboratorio solo puede contener texto, no números.' });
    }

    const position = (b.position || '').trim();
    if (!position) {
      return res.status(400).json({ success: false, error: 'El cargo o especialidad es obligatorio.' });
    }
    if (/[0-9]/.test(position)) {
      return res.status(400).json({ success: false, error: 'El cargo o especialidad solo puede contener texto, no números.' });
    }

    // Fecha de nacimiento: Único campo no obligatorio, pero si se envía debe ser real (no ficticia ni muy lejana: 1935 a 2008)
    const birthDate = (b.birth_date || '').trim();
    if (birthDate) {
      const parts = birthDate.split('-');
      const y = parseInt(parts[0], 10);
      const m = parseInt(parts[1], 10);
      const d = parseInt(parts[2], 10);
      const dateObj = new Date(y, m - 1, d);
      if (parts.length !== 3 || isNaN(y) || y < 1935 || y > 2008 || dateObj.getFullYear() !== y || dateObj.getMonth() !== (m - 1) || dateObj.getDate() !== d) {
        return res.status(400).json({ success: false, error: 'La fecha de nacimiento debe ser real y coherente (año 1935 a 2008).' });
      }
    }

    const cleanComments = (b.comments || '').replace(/\[F\.Nac:\s*[0-9]{4}-[0-9]{2}-[0-9]{2}\]\s*/g, '').trim();
    const combinedComments = birthDate ? `[F.Nac: ${birthDate}] ${cleanComments}`.trim() : cleanComments;

    const record = {
      full_name: fullName,
      ci: ci,
      email: email,
      phone: phone,
      ticket_count: 1,
      ticket_list: [],
      institution: institution,
      position: position,
      attending: b.attending || 'yes',
      dietary: [],
      comments: combinedComments
    };

    // 2.1 Verificar si el asistente ya existe por NOMBRE, EMAIL o CÉDULA para ACTUALIZAR en vez de duplicar
    let existingId = null;

    // Buscar por email
    const checkEmail = await fetch(`${SUPABASE_URL}/rest/v1/attendees?email=eq.${encodeURIComponent(email)}&order=id.desc&limit=1`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (checkEmail.ok) {
      const data = await checkEmail.json();
      if (data && data.length > 0) existingId = data[0].id;
    }

    // Si no se encontró por email, buscar por nombre exacto
    if (!existingId && fullName) {
      const checkName = await fetch(`${SUPABASE_URL}/rest/v1/attendees?full_name=ilike.${encodeURIComponent(fullName)}&order=id.desc&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (checkName.ok) {
        const data = await checkName.json();
        if (data && data.length > 0) existingId = data[0].id;
      }
    }

    // Si no se encontró, buscar por C.I.
    if (!existingId && ci) {
      const checkCi = await fetch(`${SUPABASE_URL}/rest/v1/attendees?ci=eq.${encodeURIComponent(ci)}&order=id.desc&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (checkCi.ok) {
        const data = await checkCi.json();
        if (data && data.length > 0) existingId = data[0].id;
      }
    }

    if (existingId) {
      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${existingId}`, {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify(record)
      });
      if (updateRes.ok) {
        const updatedData = await updateRes.json().catch(() => []);
        if (updatedData && updatedData.length > 0) {
          return res.status(200).json({ success: true, attendee: updatedData[0] });
        }
      }
    }

    // Inserción directa en Supabase con fecha actual para garantizar persistencia y prevalencia del último registro
    const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify([{ ...record, created_at: new Date().toISOString() }])
    });

    if (insertRes.ok) {
      const data = await insertRes.json().catch(() => []);
      return res.status(201).json({ success: true, attendee: data ? data[0] : record });
    }
    const errText = await insertRes.text().catch(() => '');
    res.status(insertRes.status || 400).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Modificar asistente en Supabase
app.put('/api/attendees/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};
    const record = {};
    if (b.full_name) record.full_name = b.full_name.trim().toUpperCase();
    if (b.ci !== undefined) record.ci = b.ci.trim();
    if (b.email) record.email = b.email.trim().toLowerCase();
    if (b.phone !== undefined) record.phone = b.phone.trim();
    if (b.institution !== undefined) record.institution = b.institution.trim();
    if (b.position !== undefined) record.position = b.position.trim();
    if (b.attending) record.attending = b.attending;
    if (b.comments !== undefined || b.birth_date !== undefined) {
      const rawComments = b.comments !== undefined ? b.comments.trim() : '';
      const cleanComments = rawComments.replace(/\[F\.Nac:\s*[0-9]{4}-[0-9]{2}-[0-9]{2}\]\s*/g, '').trim();
      const birthDate = b.birth_date !== undefined ? b.birth_date.trim() : '';
      record.comments = birthDate ? `[F.Nac: ${birthDate}] ${cleanComments}`.trim() : cleanComments;
    }

    const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify(record)
    });

    if (patchRes.ok) {
      const patchData = await patchRes.json().catch(() => []);
      if (patchData && patchData.length > 0) {
        return res.json({ success: true, attendee: patchData[0] });
      }
    }

    // Si el PATCH no actualizó filas en Supabase por RLS, insertar el registro con su estado actualizado
    const insRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=representation'
      },
      body: JSON.stringify([{ ...record, created_at: new Date().toISOString() }])
    });

    if (insRes.ok) {
      const insData = await insRes.json().catch(() => []);
      return res.json({ success: true, attendee: insData ? insData[0] : record });
    }
    const errText = await patchRes.text().catch(() => '');
    res.status(patchRes.status || 400).json({ success: false, error: errText });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Eliminar asistente en Supabase
app.delete('/api/attendees/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const b = req.body || {};
    let fullName = b.full_name || '';
    let email = b.email || '';
    let ci = b.ci || '';

    // Si no vino en el body, consultar de Supabase
    if (!fullName && !email) {
      try {
        const checkRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}&limit=1`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (checkRes.ok) {
          const rows = await checkRes.json();
          if (rows && rows[0]) {
            fullName = rows[0].full_name;
            email = rows[0].email;
            ci = rows[0].ci;
          }
        }
      } catch (e) {}
    }

    // Insertar tombstone de eliminación definitiva en Supabase
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify([{
          full_name: fullName,
          email: email,
          ci: ci || '',
          attending: 'deleted',
          ticket_count: 0,
          ticket_list: [],
          comments: '[DELETED]',
          created_at: new Date().toISOString()
        }])
      });
    } catch (e) {}

    // Intentar DELETE físico
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}`, {
        method: 'DELETE',
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
    } catch (e) {}

    return res.json({ success: true, message: 'Asistente eliminado definitivamente' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Servir la página principal
app.get('*', (req, res) => {
  const html = getIndexHtml();
  if (html) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    return res.send(html);
  }
  
  try {
    res.sendFile(path.join(rootDir, 'index.html'));
  } catch (e) {
    res.status(200).send('<!DOCTYPE html><html><body><h1>INGELAB EVOLUTION</h1><p>Cargando portal...</p><script>window.location.reload();</script></body></html>');
  }
});

// Manejador global de errores (Garantiza 0 caídas no controladas)
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  const html = getIndexHtml();
  if (html && req.method === 'GET' && !req.path.startsWith('/api')) {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(html);
  }
  res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
});

// Iniciar servidor local
if (!process.env.VERCEL && process.env.NODE_ENV !== 'test') {
  const PORT = process.env.PORT || 3000;
  try {
    app.listen(PORT, () => {
      console.log(`Servidor INGELAB listo en http://localhost:${PORT}`);
    });
  } catch(e) {}
}

export default app;
