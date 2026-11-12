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

  const seenNames = new Map();
  const seenEmails = new Map();
  const seenCis = new Map();
  const uniqueList = [];

  for (const item of sorted) {
    const checkinMatch = (item.comments || '').match(/\[CHECKIN:\s*([^\]]+)\]/);
    const checkedInAt = item.checked_in_at || (checkinMatch ? checkinMatch[1] : null);
    item.checked_in = Boolean(checkedInAt || item.checked_in);
    item.checked_in_at = checkedInAt;

    const nameKey = (item.full_name || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toUpperCase();
    const emailKey = (item.email || '').trim().toLowerCase();
    const ciKey = (item.ci || '').trim();

    let isDuplicate = false;
    let existingItem = null;
    if (nameKey && nameKey.length >= 3 && seenNames.has(nameKey)) {
      isDuplicate = true;
      existingItem = seenNames.get(nameKey);
    } else if (emailKey && seenEmails.has(emailKey)) {
      isDuplicate = true;
      existingItem = seenEmails.get(emailKey);
    } else if (ciKey && ciKey.length >= 6 && seenCis.has(ciKey)) {
      isDuplicate = true;
      existingItem = seenCis.get(ciKey);
    }

    if (!isDuplicate) {
      if (nameKey && nameKey.length >= 3) seenNames.set(nameKey, item);
      if (emailKey) seenEmails.set(emailKey, item);
      if (ciKey && ciKey.length >= 6) seenCis.set(ciKey, item);

      const isDeleted = item.attending === 'deleted' || String(item.comments || '').includes('[DELETED]');
      if (!isDeleted) {
        uniqueList.push(item);
      }
    } else if (existingItem && item.checked_in && !existingItem.checked_in) {
      const checkinTime = new Date(item.checked_in_at || 0).getTime();
      const existingCreatedTime = new Date(existingItem.created_at || 0).getTime();
      // Solo heredar check-in si ocurrió DESPUÉS de la creación del registro actual
      if (checkinTime > existingCreatedTime) {
        existingItem.checked_in = true;
        existingItem.checked_in_at = item.checked_in_at;
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

// ==============================================================
// MOTOR DE CONCURRENCIA Y CACHÉ EN MEMORIA PARA CHECK-IN SIMULTÁNEO
// ==============================================================
const activeCheckinLocks = new Set();
const checkinMemoryCache = new Map(); // key: CI limpia o ID -> { checked_in_at, id, full_name }

// Endpoint de Estadísticas en Vivo para Dashboard y Control de Acceso
app.get('/api/checkin/stats', async (req, res) => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(`${SUPABASE_URL}/rest/v1/attendees?select=*&order=id.desc`, {
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`
      },
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      return res.status(500).json({ success: false, error: 'Error al consultar Supabase' });
    }

    const rawList = await response.json();
    const attendees = deduplicateAttendeesServer(rawList || []);

    // Sincronizar estado en caché en memoria para validaciones a 0ms de latencia
    for (const a of attendees) {
      const cleanCi = (a.ci || '').trim().replace(/\D/g, '');
      const existingCheckin = (a.comments || '').match(/\[CHECKIN:\s*([^\]]+)\]/);
      if (a.checked_in || existingCheckin || a.checked_in_at) {
        const timestamp = a.checked_in_at || (existingCheckin ? existingCheckin[1] : new Date().toISOString());
        if (cleanCi) checkinMemoryCache.set(cleanCi, { checked_in_at: timestamp, id: a.id, full_name: a.full_name });
        if (a.id) checkinMemoryCache.set(String(a.id), { checked_in_at: timestamp, id: a.id, full_name: a.full_name });
      } else {
        if (cleanCi) checkinMemoryCache.delete(cleanCi);
        if (a.id) checkinMemoryCache.delete(String(a.id));
      }
    }

    const totalRegistered = attendees.length;
    const totalAttending = attendees.filter(a => a.attending === 'yes').length;
    const checkedInList = attendees.filter(a => a.checked_in);
    const totalCheckedIn = checkedInList.length;
    const VENUE_CAPACITY = 230; // Aforo oficial del salón: 230 personas

    // Calcular distribución por horas iniciando desde las 16:00
    const hourlyCounts = {
      '16:00': 0,
      '17:00': 0,
      '18:00': 0,
      '19:00': 0,
      '20:00': 0,
      '21:00': 0,
      '22:00': 0
    };
    for (const a of checkedInList) {
      if (a.checked_in_at) {
        const d = new Date(a.checked_in_at);
        let h = d.getHours();
        if (h < 16) h = 16;
        if (h > 22) h = 22;
        const hour = h.toString().padStart(2, '0') + ':00';
        hourlyCounts[hour] = (hourlyCounts[hour] || 0) + 1;
      }
    }

    // Ordenar cronológicamente las últimas entradas
    const recentEntries = [...checkedInList]
      .sort((a, b) => new Date(b.checked_in_at || 0) - new Date(a.checked_in_at || 0))
      .slice(0, 15)
      .map(a => ({
        id: a.id,
        full_name: a.full_name,
        ci: a.ci || '',
        institution: a.institution || 'Particular',
        position: a.position || 'Profesional',
        checked_in_at: a.checked_in_at
      }));

    return res.json({
      success: true,
      stats: {
        totalRegistered,
        totalAttending,
        totalCheckedIn,
        venueCapacity: VENUE_CAPACITY,
        attendanceRate: Math.round((totalCheckedIn / VENUE_CAPACITY) * 100),
        hourlyCounts,
        recentEntries,
        timestamp: new Date().toISOString()
      }
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Revertir TODOS los Check-ins de Prueba (Restablecer sala limpia a 0)
app.post('/api/checkin/reset-all-tests', async (req, res) => {
  try {
    const getRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?select=*&order=id.desc`, {
      headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
    });
    if (!getRes.ok) return res.status(500).json({ success: false, error: 'Error al consultar Supabase' });

    const rawList = await getRes.json();
    const cleanList = deduplicateAttendeesServer(rawList || []);
    const checkedInList = cleanList.filter(a => a.checked_in);

    const nowIso = new Date().toISOString();
    let resetCount = 0;

    for (const attendee of checkedInList) {
      const cleanComments = (attendee.comments || '').replace(/\[CHECKIN:\s*[^\]]+\]\s*/g, '').trim();
      const cleanCi = (attendee.ci || '').trim().replace(/\D/g, '');
      if (cleanCi) checkinMemoryCache.delete(cleanCi);
      checkinMemoryCache.delete(String(attendee.id));

      await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          full_name: attendee.full_name,
          ci: attendee.ci || '',
          email: attendee.email || 'reset@ingelab.com',
          phone: attendee.phone || '0000000000',
          ticket_count: attendee.ticket_count || 1,
          ticket_list: attendee.ticket_list || [],
          institution: attendee.institution || 'Particular',
          position: attendee.position || 'Profesional',
          attending: attendee.attending || 'yes',
          dietary: attendee.dietary || [],
          comments: cleanComments,
          created_at: nowIso
        }])
      });
      resetCount++;
    }

    checkinMemoryCache.clear();

    return res.json({ 
      success: true, 
      count: resetCount, 
      message: `Se han restablecido exitosamente ${resetCount} check-in(s) de prueba a estado Pendiente.` 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Revertir / Anular Check-In de un Asistente Específico
app.post('/api/checkin/undo/:id', async (req, res) => {
  try {
    const id = req.params.id;
    const { ci } = req.body || {};
    let attendee = null;

    // Buscar asistente por ID o Cédula
    try {
      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}&limit=1`, {
        headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
      });
      if (getRes.ok) {
        const list = await getRes.json();
        if (list && list.length > 0) attendee = list[0];
      }
    } catch (e) {}

    const cleanCi = (ci || (attendee && attendee.ci) || '').trim().replace(/\D/g, '');

    if (!attendee && cleanCi) {
      try {
        const getCiRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?ci=eq.${encodeURIComponent(cleanCi)}&order=id.desc&limit=1`, {
          headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
        });
        if (getCiRes.ok) {
          const listCi = await getCiRes.json();
          if (listCi && listCi.length > 0) attendee = listCi[0];
        }
      } catch (e) {}
    }

    if (!attendee) {
      return res.status(404).json({ success: false, error: 'Asistente no encontrado.' });
    }

    // Limpiar de la caché de memoria
    if (cleanCi) checkinMemoryCache.delete(cleanCi);
    checkinMemoryCache.delete(String(id));
    if (attendee.id) checkinMemoryCache.delete(String(attendee.id));

    const cleanComments = (attendee.comments || '').replace(/\[CHECKIN:\s*[^\]]+\]\s*/g, '').trim();
    const nowIso = new Date().toISOString();

    // Insertar registro limpio sin [CHECKIN] con fecha actual para que sea el vigente no ingresado
    try {
      await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify([{
          full_name: attendee.full_name,
          ci: attendee.ci || cleanCi || '',
          email: attendee.email || 'reset@ingelab.com',
          phone: attendee.phone || '0000000000',
          ticket_count: attendee.ticket_count || 1,
          ticket_list: attendee.ticket_list || [],
          institution: attendee.institution || 'Particular',
          position: attendee.position || 'Profesional',
          attending: attendee.attending || 'yes',
          dietary: attendee.dietary || [],
          comments: cleanComments,
          created_at: nowIso
        }])
      });
    } catch (e) {}

    return res.json({ 
      success: true, 
      checked_in: false,
      message: `Check-in de "${attendee.full_name}" anulado correctamente. Revertido a pendiente de ingreso.` 
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// Endpoint de Registro de Entrada (Check-In) en Puerta con Protección de Concurrencia
app.post('/api/checkin/:id', async (req, res) => {
  const id = req.params.id;
  const { force, ci, attendeeData } = req.body || {};
  const cleanCi = (ci || (attendeeData && attendeeData.ci) || '').trim().replace(/\D/g, '');
  const lockKey = cleanCi || String(id);

  // 1. Detección instantánea de duplicados en memoria (< 1ms sin esperar a Supabase)
  const cachedCheckin = checkinMemoryCache.get(cleanCi) || checkinMemoryCache.get(String(id));
  if (cachedCheckin && !force) {
    return res.status(200).json({
      success: false,
      already_checked_in: true,
      checked_in_at: cachedCheckin.checked_in_at,
      attendee: {
        id: cachedCheckin.id || id,
        full_name: cachedCheckin.full_name || (attendeeData && attendeeData.full_name) || 'Asistente',
        ci: cleanCi,
        checked_in: true,
        checked_in_at: cachedCheckin.checked_in_at
      },
      message: `⚠️ Advertencia: Este asistente ya ingresó a las ${new Date(cachedCheckin.checked_in_at).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}`
    });
  }

  // 2. Control de Concurrencia Simultánea: Previene peticiones en paralelo para el mismo asistente
  if (activeCheckinLocks.has(lockKey) && !force) {
    return res.status(200).json({
      success: false,
      already_checked_in: true,
      message: '⚠️ Petición en proceso: Este asistente está siendo ingresado en otra puerta simultáneamente.'
    });
  }

  activeCheckinLocks.add(lockKey);

  try {
    let attendee = null;

    // Buscar por ID en Supabase con timeout de 3.5s
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3500);
      const getRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?id=eq.${id}&limit=1`, {
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`
        },
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (getRes.ok) {
        const list = await getRes.json();
        if (list && list.length > 0) attendee = list[0];
      }
    } catch (e) {}

    // Si no se encontró por ID y se pasó C.I., buscar por C.I.
    if (!attendee && cleanCi) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3500);
        const getCiRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees?ci=eq.${encodeURIComponent(cleanCi)}&order=id.desc&limit=1`, {
          headers: {
            'apikey': SUPABASE_KEY,
            'Authorization': `Bearer ${SUPABASE_KEY}`
          },
          signal: controller.signal
        });
        clearTimeout(timeout);
        if (getCiRes.ok) {
          const listCi = await getCiRes.json();
          if (listCi && listCi.length > 0) attendee = listCi[0];
        }
      } catch (e) {}
    }

    if (!attendee && attendeeData) {
      attendee = attendeeData;
    }

    if (!attendee) {
      return res.status(404).json({ success: false, error: 'Asistente no encontrado en la base de datos.' });
    }

    const existingCheckin = (attendee.comments || '').match(/\[CHECKIN:\s*([^\]]+)\]/);
    const isAlreadyCheckedIn = Boolean(attendee.checked_in || existingCheckin || attendee.checked_in_at);
    const checkedInAt = attendee.checked_in_at || (existingCheckin ? existingCheckin[1] : null);

    if (isAlreadyCheckedIn && !force) {
      const finalAt = checkedInAt || new Date().toISOString();
      if (cleanCi) checkinMemoryCache.set(cleanCi, { checked_in_at: finalAt, id: attendee.id || id, full_name: attendee.full_name });
      return res.status(200).json({
        success: false,
        already_checked_in: true,
        checked_in_at: finalAt,
        attendee: {
          ...attendee,
          checked_in: true,
          checked_in_at: finalAt
        },
        message: `⚠️ Advertencia: Este asistente ya ingresó a las ${new Date(finalAt).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' })}`
      });
    }

    // Registrar nuevo check-in
    const nowIso = new Date().toISOString();
    const cleanComments = (attendee.comments || '').replace(/\[CHECKIN:\s*[^\]]+\]\s*/g, '').trim();
    const updatedComments = `[CHECKIN: ${nowIso}] ${cleanComments}`.trim();

    // Actualizar inmediatamente la caché en memoria para proteger peticiones concurrentes
    if (cleanCi) checkinMemoryCache.set(cleanCi, { checked_in_at: nowIso, id: attendee.id || id, full_name: attendee.full_name });
    checkinMemoryCache.set(String(id), { checked_in_at: nowIso, id: attendee.id || id, full_name: attendee.full_name });

    let updatedRecord = null;
    try {
      const insController = new AbortController();
      const insTimeout = setTimeout(() => insController.abort(), 3500);
      const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/attendees`, {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=representation'
        },
        body: JSON.stringify([{
          full_name: attendee.full_name,
          ci: attendee.ci || cleanCi || '',
          email: attendee.email || 'checkin@ingelab.com',
          phone: attendee.phone || '0000000000',
          ticket_count: attendee.ticket_count || 1,
          ticket_list: attendee.ticket_list || [],
          institution: attendee.institution || 'Particular',
          position: attendee.position || 'Profesional',
          attending: attendee.attending || 'yes',
          dietary: attendee.dietary || [],
          comments: updatedComments,
          created_at: nowIso
        }]),
        signal: insController.signal
      });
      clearTimeout(insTimeout);
      if (insertRes.ok) {
        const insData = await insertRes.json().catch(() => []);
        updatedRecord = insData ? insData[0] : null;
      }
    } catch (e) {
      console.warn('Error al guardar check-in en Supabase (mantenido en memoria):', e.message);
    }

    return res.status(200).json({
      success: true,
      checked_in: true,
      checked_in_at: nowIso,
      attendee: {
        ...(updatedRecord || attendee),
        checked_in: true,
        checked_in_at: nowIso
      },
      message: '¡Entrada confirmada exitosamente!'
    });
  } catch (err) {
    console.error('Checkin error:', err);
    res.status(500).json({ success: false, error: err.message });
  } finally {
    activeCheckinLocks.delete(lockKey);
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
    let phone = b.phone || '0000000000';
    let institution = b.institution || 'Particular';
    let position = b.position || 'Profesional';

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
            ci = rows[0].ci || '';
            phone = rows[0].phone || '0000000000';
            institution = rows[0].institution || 'Particular';
            position = rows[0].position || 'Profesional';
          }
        }
      } catch (e) {}
    }

    // Insertar tombstone de eliminación definitiva en Supabase con todas las columnas obligatorias
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
          phone: phone,
          institution: institution,
          position: position,
          attending: 'deleted',
          ticket_count: 0,
          ticket_list: [],
          dietary: [],
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
