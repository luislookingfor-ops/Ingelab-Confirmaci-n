import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, 'ingelab_evento.db');

export const db = new DatabaseSync(dbPath);

// Inicializar y migrar tablas
export function initDB() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attendees (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ticket_code TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      ci TEXT DEFAULT '',
      institution TEXT DEFAULT '',
      position TEXT DEFAULT '',
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      ticket_count INTEGER DEFAULT 1,
      ticket_list TEXT DEFAULT '',
      attending TEXT DEFAULT 'yes',
      companion TEXT DEFAULT 'no',
      companion_name TEXT DEFAULT '',
      dietary TEXT DEFAULT '',
      comments TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS gallery_access_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ci TEXT NOT NULL,
      full_name TEXT DEFAULT '',
      attendee_id INTEGER DEFAULT NULL,
      accepted_terms INTEGER DEFAULT 1,
      authorized_media INTEGER DEFAULT 0,
      ip TEXT DEFAULT '',
      user_agent TEXT DEFAULT '',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);

  // Migraciones automáticas por si ya existía la tabla sin las nuevas columnas
  try { db.exec("ALTER TABLE attendees ADD COLUMN ci TEXT DEFAULT '';"); } catch(e) {}
  try { db.exec("ALTER TABLE attendees ADD COLUMN ticket_count INTEGER DEFAULT 1;"); } catch(e) {}
  try { db.exec("ALTER TABLE attendees ADD COLUMN ticket_list TEXT DEFAULT '';"); } catch(e) {}

  console.log('✅ Base de datos SQLite inicializada y sincronizada en:', dbPath);
}

// Generador de números de boletos únicos de 5 dígitos (ej: 05802, 12237, 31773)
export function generateTicketNumbers(count = 1) {
  const tickets = new Set();
  const maxAttempts = count * 50;
  let attempts = 0;

  while (tickets.size < count && attempts < maxAttempts) {
    attempts++;
    const rand = Math.floor(Math.random() * 90000 + 1000);
    tickets.add(String(rand).padStart(5, '0'));
  }

  // Ordenar de menor a mayor como en la captura
  return Array.from(tickets).sort((a, b) => parseInt(a) - parseInt(b));
}

// Insertar nuevo registro con soporte para C.I., cantidad de boletos y lista de boletos
export function createAttendee(data) {
  const count = parseInt(data.ticketCount) || 1;
  const ticketNumbers = (data.ticketList && Array.isArray(data.ticketList) && data.ticketList.length > 0)
    ? data.ticketList
    : generateTicketNumbers(count);

  const mainTicketCode = ticketNumbers[0] || `ING-${Math.floor(Math.random()*9000+1000)}`;

  const stmt = db.prepare(`
    INSERT INTO attendees (
      ticket_code, full_name, ci, institution, position, email, phone,
      ticket_count, ticket_list, attending, companion, companion_name, dietary, comments
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?
    )
  `);

  const ticketListStr = ticketNumbers.join(', ');

  stmt.run(
    mainTicketCode,
    (data.fullName || '').trim(),
    (data.ci || '').trim(),
    (data.institution || 'Ingelab').trim(),
    (data.position || 'Participante').trim(),
    (data.email || '').trim().toLowerCase(),
    (data.phone || '').trim(),
    count,
    ticketListStr,
    data.attending || 'yes',
    data.companion || (count > 1 ? 'yes' : 'no'),
    (data.companionName || '').trim(),
    Array.isArray(data.dietary) ? data.dietary.join(', ') : (data.dietary || 'Menú Estándar'),
    (data.comments || '').trim()
  );

  return getAttendeeByTicket(mainTicketCode);
}

export function getAttendeeByTicket(ticketCode) {
  const stmt = db.prepare('SELECT * FROM attendees WHERE ticket_code = ?');
  return stmt.get(ticketCode);
}

export function getAllAttendees() {
  const stmt = db.prepare('SELECT * FROM attendees ORDER BY id DESC');
  return stmt.all();
}

export function deleteAttendee(id) {
  const stmt = db.prepare('DELETE FROM attendees WHERE id = ?');
  return stmt.run(id);
}

export function getStats() {
  const total = db.prepare('SELECT COUNT(*) as count FROM attendees').get().count;
  const confirmed = db.prepare("SELECT COUNT(*) as count FROM attendees WHERE attending = 'yes'").get().count;
  const declined = db.prepare("SELECT COUNT(*) as count FROM attendees WHERE attending = 'no'").get().count;
  
  // Sumar la cantidad total de boletos
  const totalTicketsResult = db.prepare("SELECT SUM(ticket_count) as total FROM attendees WHERE attending = 'yes'").get();
  const totalTickets = totalTicketsResult.total || confirmed;

  return {
    totalRegistrations: total,
    confirmedAttendees: confirmed,
    declinedAttendees: declined,
    totalExpectedGuests: totalTickets,
    totalTickets: totalTickets
  };
}

// Registrar acceso y consentimiento de galería de fotos (Solo participantes registrados)
export function recordGalleryAccess({ ci, acceptedTerms, authorizedMedia, ip = '', userAgent = '' }) {
  const cleanCi = (ci || '').replace(/\D/g, '').trim();
  const ciPadded = cleanCi.length === 9 ? '0' + cleanCi : cleanCi;
  
  // Buscar si coincide con un asistente registrado en la base de datos
  const attendee = db.prepare(`
    SELECT * FROM attendees 
    WHERE REPLACE(REPLACE(ci, '-', ''), ' ', '') = ? 
       OR REPLACE(REPLACE(ci, '-', ''), ' ', '') = ?
       OR ci = ? 
       OR ci = ?
    ORDER BY id DESC LIMIT 1
  `).get(cleanCi, ciPadded, cleanCi, ciPadded);

  // REQUISITO ESTRICTO: Únicamente participantes registrados en la BD pueden continuar
  if (!attendee) {
    return {
      success: false,
      matched: false,
      error: 'La cédula ingresada no se encuentra registrada en la base de datos oficial del evento. El acceso al catálogo de fotos está reservado únicamente para participantes registrados.'
    };
  }

  const fullName = attendee.full_name;
  const attendeeId = attendee.id;
  const nowIso = new Date().toISOString();

  // Guardar en tabla de auditoría
  const stmt = db.prepare(`
    INSERT INTO gallery_access_logs (
      ci, full_name, attendee_id, accepted_terms, authorized_media, ip, user_agent, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  stmt.run(
    cleanCi, 
    fullName, 
    attendeeId, 
    acceptedTerms ? 1 : 0, 
    authorizedMedia ? 1 : 0, 
    ip, 
    userAgent, 
    nowIso
  );

  // Actualizar sus comments con el tag de acceso para visualización en Admin
  const cleanComments = (attendee.comments || '').replace(/\[FOTOS_ACCESO:[^\]]+\]\s*/g, '').trim();
  const updatedComments = `[FOTOS_ACCESO: ${nowIso} | FOTOS_AUTORIZO: ${authorizedMedia ? 'SI' : 'NO'}] ${cleanComments}`.trim();
  db.prepare('UPDATE attendees SET comments = ? WHERE id = ?').run(updatedComments, attendee.id);

  return {
    success: true,
    matched: true,
    attendee: { id: attendee.id, full_name: attendee.full_name, ci: attendee.ci },
    ci: cleanCi,
    authorized_media: Boolean(authorizedMedia),
    created_at: nowIso
  };
}

// Consultar auditoría de accesos a la galería
export function getGalleryAccessLogs() {
  const stmt = db.prepare('SELECT * FROM gallery_access_logs ORDER BY id DESC');
  return stmt.all();
}
