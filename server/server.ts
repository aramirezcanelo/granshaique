import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import type { IncomingMessage, ServerResponse } from 'node:http';

type Session = { userId: number; expiresAt: number };
type UserRow = { id: number; codigoUsuario: string; user: string; pass: string; progreso: number; calificacion: number; rol: 'admin' | 'usuario'; manual_override?: number };
type PublicUserRow = Omit<UserRow, 'pass' | 'manual_override'>;
type JsonObject = Record<string, unknown>;
type JsonHandler = (body: JsonObject) => void;

const PORT = process.env.PORT || 8080;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_JSON_BYTES = 1_000_000;
const SERVER_BUILD = 'csp-inline-style-fix-2026-09-29';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Compiled output lives in dist/server; keep static assets and persistent data rooted at the project.
const root = path.resolve(__dirname, '..', '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'server', 'data');
const dbPath = path.join(dataDir, 'app.sqlite');
const uploadsDir = process.env.UPLOADS_DIR || path.join(root, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
)`);
db.prepare("INSERT OR IGNORE INTO app_settings (key, value) VALUES ('public_registration_open', '0')").run();
const isPublicRegistrationOpen = (): boolean => db.prepare("SELECT value FROM app_settings WHERE key = 'public_registration_open'").get()?.value === '1';

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  codigo_usuario TEXT,
  user TEXT UNIQUE,
  pass TEXT,
  progreso INTEGER DEFAULT 0,
  calificacion INTEGER DEFAULT 0,
  rol TEXT DEFAULT 'usuario'
)`);

const schema = db.prepare("PRAGMA table_info(users)").all();
const fields = schema.map((col) => col.name);
if (!fields.includes('codigo_usuario')) db.exec('ALTER TABLE users ADD COLUMN codigo_usuario TEXT');
if (!fields.includes('progreso')) db.exec('ALTER TABLE users ADD COLUMN progreso INTEGER DEFAULT 0');
if (!fields.includes('calificacion')) db.exec('ALTER TABLE users ADD COLUMN calificacion INTEGER DEFAULT 0');
if (!fields.includes('rol')) db.exec('ALTER TABLE users ADD COLUMN rol TEXT DEFAULT "usuario"');
if (!fields.includes('manual_override')) db.exec('ALTER TABLE users ADD COLUMN manual_override INTEGER DEFAULT 0');
db.exec('UPDATE users SET manual_override = 0 WHERE manual_override <> 0');
db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_users_codigo_usuario ON users(codigo_usuario) WHERE codigo_usuario IS NOT NULL AND codigo_usuario <> ''");
db.exec(`CREATE TABLE IF NOT EXISTS daily_user_sequences (
  date_key TEXT PRIMARY KEY,
  last_number INTEGER NOT NULL
)`);

function nextPublicUserId(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: process.env.APP_TIME_ZONE || 'America/Mexico_City',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date());
  const dateParts = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  const year = dateParts.year;
  const month = dateParts.month;
  const day = dateParts.day;
  const dateKey = `${year}${month}${day}`;

  db.exec('BEGIN IMMEDIATE');
  try {
    const current = db.prepare('SELECT last_number FROM daily_user_sequences WHERE date_key = ?').get(dateKey);
    const next = Number(current?.last_number || 0) + 1;
    db.prepare(`
      INSERT INTO daily_user_sequences (date_key, last_number) VALUES (?, ?)
      ON CONFLICT(date_key) DO UPDATE SET last_number = excluded.last_number
    `).run(dateKey, next);
    db.exec('COMMIT');
    return `${year.slice(-2)}${month}${day}${String(next).padStart(2, '0')}`;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

db.prepare("SELECT id FROM users WHERE codigo_usuario IS NULL OR codigo_usuario = ''").all()
  .forEach(({ id }) => {
    db.prepare('UPDATE users SET codigo_usuario = ? WHERE id = ?').run(nextPublicUserId(), id);
  });

const legacyPublicIds = db.prepare("SELECT id, codigo_usuario FROM users WHERE codigo_usuario LIKE '%/%'").all() as Array<{ id: number; codigo_usuario: string }>;
for (const row of legacyPublicIds) {
  const match = /^(\d{4})\/(\d{2})\/(\d{2})\/(\d+)$/.exec(row.codigo_usuario);
  if (!match) continue;
  const compactSequence = String(Number(match[4])).padStart(2, '0');
  const compactId = `${match[1].slice(-2)}${match[2]}${match[3]}${compactSequence}`;
  const collision = db.prepare('SELECT id FROM users WHERE codigo_usuario = ? AND id <> ?').get(compactId, row.id);
  db.prepare('UPDATE users SET codigo_usuario = ? WHERE id = ?').run(collision ? nextPublicUserId() : compactId, row.id);
}

db.exec(`CREATE TABLE IF NOT EXISTS exercises (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  title TEXT,
  prompt TEXT,
  points INTEGER DEFAULT 1,
  data TEXT,
  position INTEGER DEFAULT 0
)`);

const exerciseSchema = db.prepare("PRAGMA table_info(exercises)").all();
const exerciseFields = exerciseSchema.map((col) => col.name);
if (!exerciseFields.includes('position')) db.exec('ALTER TABLE exercises ADD COLUMN position INTEGER DEFAULT 0');

db.exec(`CREATE TABLE IF NOT EXISTS user_progress (
  user_id INTEGER NOT NULL,
  exercise_id TEXT NOT NULL,
  correct INTEGER DEFAULT 0,
  answer_data TEXT DEFAULT '{}',
  completed INTEGER DEFAULT 1,
  PRIMARY KEY (user_id, exercise_id)
)`);

const userProgressSchema = db.prepare("PRAGMA table_info(user_progress)").all();
const userProgressFields = userProgressSchema.map((col) => col.name);
if (!userProgressFields.includes('answer_data')) db.exec("ALTER TABLE user_progress ADD COLUMN answer_data TEXT DEFAULT '{}'");
if (!userProgressFields.includes('completed')) db.exec('ALTER TABLE user_progress ADD COLUMN completed INTEGER DEFAULT 1');

function recomputeUserProgress(userId: number): { progresoPct: number; calificacionPct: number } {
  const userRow = db.prepare('SELECT manual_override FROM users WHERE id = ?').get(userId);
  if (userRow && userRow.manual_override) {
    const current = db.prepare('SELECT progreso, calificacion FROM users WHERE id = ?').get(userId) as { progreso: number; calificacion: number } | undefined;
    if (!current) return { progresoPct: 0, calificacionPct: 0 };
    return { progresoPct: current.progreso, calificacionPct: current.calificacion };
  }

  const gradableTypes = "'Separador', 'Archivo', 'Imagen', 'Documento', 'Presentación', 'Texto'";
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS exerciseCount, COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 1 END), 0) AS totalPoints
    FROM exercises WHERE type NOT IN (${gradableTypes})
  `).get() as { exerciseCount: number; totalPoints: number };
  const scoreRow = db.prepare(`
    SELECT COUNT(*) AS completedCount,
      COALESCE(SUM(CASE WHEN user_progress.correct THEN CASE WHEN exercises.points > 0 THEN exercises.points ELSE 1 END ELSE 0 END), 0) AS earnedPoints
    FROM user_progress
    INNER JOIN exercises ON exercises.id = user_progress.exercise_id
    WHERE user_progress.user_id = ? AND user_progress.completed = 1 AND exercises.type NOT IN (${gradableTypes})
  `).get(userId) as { completedCount: number; earnedPoints: number };

  const progresoPct = totalRow.exerciseCount > 0 ? Math.round((scoreRow.completedCount / totalRow.exerciseCount) * 100) : 0;
  const calificacionPct = totalRow.totalPoints > 0 ? Math.round((scoreRow.earnedPoints / totalRow.totalPoints) * 100) : 0;

  db.prepare('UPDATE users SET progreso = ?, calificacion = ? WHERE id = ?').run(progresoPct, calificacionPct, userId);
  return { progresoPct, calificacionPct };
}

const isPasswordHash = (value: unknown): value is string => typeof value === 'string' && value.startsWith('scrypt$');
const hashPassword = (password: string): string => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};
const verifyPassword = (password: string, stored: string | null | undefined): boolean => {
  if (!stored) return false;
  if (!isPasswordHash(stored)) {
    const passwordBuffer = Buffer.from(password);
    const storedBuffer = Buffer.from(stored);
    return passwordBuffer.length === storedBuffer.length && crypto.timingSafeEqual(passwordBuffer, storedBuffer);
  }
  const [, salt, expected] = stored.split('$');
  if (!salt || !expected) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
};
const assertValidCredentials = (user: unknown, pass: unknown): string | null => {
  if (typeof user !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(user)) return 'El usuario debe tener entre 3 y 50 caracteres (letras, números, punto, guion o guion bajo).';
  if (typeof pass !== 'string' || pass.length < 10 || pass.length > 128) return 'La contraseña debe tener entre 10 y 128 caracteres.';
  return null;
};
const assertValidLogin = (user: unknown, pass: unknown): string | null => {
  if (typeof user !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(user)) return 'El usuario no tiene un formato válido.';
  if (typeof pass !== 'string' || pass.length < 1 || pass.length > 128) return 'La contraseña no tiene un formato válido.';
  return null;
};

const sessions = new Map<string, Session>();
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const registrationAttempts = new Map<string, { count: number; resetAt: number }>();
type LoginChallenge = { answer: number; expiresAt: number };
const loginChallenges = new Map<string, LoginChallenge>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;
const REGISTRATION_MAX_ATTEMPTS = 10;
const LOGIN_CHALLENGE_TTL_MS = 5 * 60 * 1000;
function isLoginRateLimited(ip: string): boolean {
  const now = Date.now();
  for (const [key, attempt] of loginAttempts) {
    if (attempt.resetAt <= now) loginAttempts.delete(key);
  }
  const current = loginAttempts.get(ip);
  return !!current && current.resetAt > now && current.count >= LOGIN_MAX_ATTEMPTS;
}
function recordFailedLogin(ip: string): void {
  const now = Date.now();
  const current = loginAttempts.get(ip);
  if (!current || current.resetAt <= now) {
    loginAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  current.count += 1;
}
function getClientIp(req: IncomingMessage): string {
  // Render terminates the public connection at its edge and forwards the client IP.
  // Ignore forwarded headers in local/other deployments unless explicitly on Render.
  if (process.env.RENDER === 'true') {
    const forwarded = req.headers['x-forwarded-for'];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0]?.trim();
    if (first && net.isIP(first)) return first;
  }
  return req.socket.remoteAddress || 'unknown';
}
function isRegistrationRateLimited(ip: string): boolean {
  const now = Date.now();
  for (const [key, attempt] of registrationAttempts) {
    if (attempt.resetAt <= now) registrationAttempts.delete(key);
  }
  const current = registrationAttempts.get(ip);
  return !!current && current.resetAt > now && current.count >= REGISTRATION_MAX_ATTEMPTS;
}
function recordRegistrationAttempt(ip: string): void {
  const now = Date.now();
  const current = registrationAttempts.get(ip);
  if (!current || current.resetAt <= now) registrationAttempts.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
  else current.count += 1;
}
const parseCookies = (header = ''): Record<string, string> => Object.fromEntries(header.split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
}).filter((entry) => entry.length));
function createLoginChallenge(): { id: string; prompt: string; expiresAt: number } {
  const now = Date.now();
  for (const [id, challenge] of loginChallenges) {
    if (challenge.expiresAt <= now) loginChallenges.delete(id);
  }
  const left = crypto.randomInt(2, 10);
  const right = crypto.randomInt(1, 10);
  const id = crypto.randomBytes(24).toString('hex');
  const expiresAt = now + LOGIN_CHALLENGE_TTL_MS;
  loginChallenges.set(id, { answer: left + right, expiresAt });
  return { id, prompt: `¿Cuánto es ${left} + ${right}?`, expiresAt };
}
function consumeLoginChallenge(id: unknown, answer: unknown): boolean {
  if (typeof id !== 'string' || !/^[a-f0-9]{48}$/.test(id)) return false;
  const challenge = loginChallenges.get(id);
  loginChallenges.delete(id);
  if (!challenge || challenge.expiresAt <= Date.now()) return false;
  if (typeof answer !== 'string' && typeof answer !== 'number') return false;
  const normalizedAnswer = String(answer).trim();
  return /^\d{1,2}$/.test(normalizedAnswer) && Number(normalizedAnswer) === challenge.answer;
}
const getSessionUser = (req: IncomingMessage): PublicUserRow | null => {
  const token = parseCookies(req.headers.cookie || '').session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return db.prepare('SELECT id, codigo_usuario AS codigoUsuario, user, progreso, calificacion, rol FROM users WHERE id = ?').get(session.userId) as PublicUserRow | undefined || null;
};
const setSession = (res: ServerResponse, userId: number): void => {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`);
};
const clearSession = (req: IncomingMessage, res: ServerResponse): void => {
  const token = parseCookies(req.headers.cookie || '').session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`);
};
const readJson = (req: IncomingMessage, res: ServerResponse, handler: JsonHandler): void => {
  let size = 0;
  let body = '';
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (size > MAX_JSON_BYTES) return sendJson(res, 413, { message: 'La solicitud excede el tamaño permitido.' });
    try {
      const payload: unknown = JSON.parse(body || '{}');
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return sendJson(res, 400, { message: 'Datos inválidos.' });
      handler(payload as JsonObject);
    } catch { sendJson(res, 400, { message: 'Datos inválidos.' }); }
  });
};

const adminCount = (db.prepare("SELECT COUNT(*) AS count FROM users WHERE rol = 'admin'").get() as { count: number }).count;
if (!adminCount) {
  const adminUser = process.env.ADMIN_USER || (!IS_PRODUCTION ? 'Ako' : undefined);
  const adminPassword = process.env.ADMIN_PASSWORD;
  const validationError = assertValidCredentials(adminUser, adminPassword);
  if (validationError) {
    if (IS_PRODUCTION) throw new Error(`Se requiere ADMIN_USER y ADMIN_PASSWORD seguros para iniciar producción. ${validationError}`);
  } else if (typeof adminUser === 'string' && typeof adminPassword === 'string') {
    db.prepare('INSERT INTO users (codigo_usuario, user, pass, progreso, calificacion, rol) VALUES (?, ?, ?, ?, ?, ?)')
      .run(nextPublicUserId(), adminUser, hashPassword(adminPassword), 0, 0, 'admin');
  }
}
recomputeAllUsers();

function recomputeAllUsers() {
  (db.prepare('SELECT id FROM users').all() as Array<{ id: number }>).forEach(({ id }) => recomputeUserProgress(id));
}

const types: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.ts': 'application/typescript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml'
};

const sendJson = (res: ServerResponse, status: number, obj: unknown): void => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  try {
    handleRequest(req, res);
  } catch (error) {
    console.error('[server] Error no controlado:', error instanceof Error ? error.message : 'Error desconocido');
    sendErrorPage(res, 500);
  }
});

function sendErrorPage(res: ServerResponse, status: 404 | 500): void {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const errorFile = path.join(root, 'public', 'static', `${status}.html`);
  fs.readFile(errorFile, (error, content) => {
    if (error) {
      res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('<!doctype html><html lang="es"><meta charset="utf-8"><title>Error · Gran Chaique</title><h1>La solicitud no pudo completarse.</h1><a href="/">Ir al inicio</a></html>');
      return;
    }
    res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(content);
  });
}

function handleRequest(req: IncomingMessage, res: ServerResponse): void {
  const requestUrl = req.url || '/';
  const declaredLength = Number(req.headers['content-length'] || 0);
  const requestLimit = requestUrl === '/api/upload' ? 21 * 1024 * 1024 : MAX_JSON_BYTES;
  if (declaredLength > requestLimit) {
    sendJson(res, 413, { message: 'La solicitud excede el tamaño permitido.' });
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'; object-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'");
  if (IS_PRODUCTION) res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, POST, PUT, DELETE, OPTIONS' });
    res.end();
    return;
  }
  const isMutation = ['POST', 'PUT', 'DELETE'].includes(req.method || '');
  const expectedOrigin = req.headers.host ? `${IS_PRODUCTION ? 'https' : 'http'}://${req.headers.host}` : undefined;
  if (isMutation && ((IS_PRODUCTION && req.headers.origin !== expectedOrigin) || (req.headers.origin && expectedOrigin && req.headers.origin !== expectedOrigin))) {
    sendJson(res, 403, { message: 'Origen no autorizado.' });
    return;
  }
  const requestPath = requestUrl.split('?')[0];
  const url = requestPath === '/' || requestPath === '/index.html' ? '/index.html' : requestPath;

  if (req.method === 'GET' && (requestUrl === '/health' || requestUrl === '/healthz')) {
    try {
      db.prepare('SELECT 1').get();
      sendJson(res, 200, { status: 'ok', database: 'ok', build: SERVER_BUILD });
    } catch {
      sendJson(res, 503, { status: 'error', database: 'unavailable' });
    }
    return;
  }

  if (req.method === 'GET' && requestUrl === '/api/login-challenge') {
    const challenge = createLoginChallenge();
    const secure = IS_PRODUCTION ? '; Secure' : '';
    res.setHeader('Set-Cookie', `login_challenge=${challenge.id}; Path=/api; HttpOnly; SameSite=Strict; Max-Age=300${secure}`);
    res.setHeader('Cache-Control', 'no-store, private');
    sendJson(res, 200, { prompt: challenge.prompt, expiresAt: challenge.expiresAt });
    return;
  }

  if (req.method === 'GET' && requestUrl.split('?')[0] === '/500') {
    sendErrorPage(res, 500);
    return;
  }

  if (req.method === 'GET' && req.url === '/api/__version') {
    sendJson(res, 200, {
      build: SERVER_BUILD,
      hasProgressEndpoint: true,
      hasExerciseEndpoints: true,
      hasReorderEndpoint: true
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/users') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const users = db.prepare('SELECT id, codigo_usuario AS codigoUsuario, user, progreso, calificacion, rol, manual_override FROM users ORDER BY id').all();
    sendJson(res, 200, { users });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/registration-status') {
    sendJson(res, 200, { open: isPublicRegistrationOpen() });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/admin/registration') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado.' });
      return;
    }
    readJson(req, res, ({ open }) => {
      if (typeof open !== 'boolean') return sendJson(res, 400, { message: 'El estado de inscripciones no es válido.' });
      db.prepare("UPDATE app_settings SET value = ? WHERE key = 'public_registration_open'").run(open ? '1' : '0');
      sendJson(res, 200, { open, message: open ? 'Inscripciones abiertas.' : 'Inscripciones cerradas.' });
    });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/user') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { id, user, pass, rol } = JSON.parse(body || '{}');
        if (!id || !user || !rol || (pass && typeof pass !== 'string')) {
          sendJson(res, 400, { message: 'Faltan datos para actualizar.' });
          return;
        }

        const userError = typeof user === 'string' && /^[a-zA-Z0-9._-]{3,50}$/.test(user) ? null : 'El usuario no tiene un formato válido.';
        const passwordError = pass ? assertValidCredentials(user, pass) : null;
        if (userError || passwordError) {
          sendJson(res, 400, { message: userError || passwordError });
          return;
        }
        if (!['usuario', 'admin'].includes(rol)) {
          sendJson(res, 400, { message: 'Rol inválido.' });
          return;
        }

        const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
        if (!exists) {
          sendJson(res, 404, { message: 'Usuario no encontrado.' });
          return;
        }

        const currentUser = db.prepare('SELECT pass FROM users WHERE id = ?').get(id) as { pass: string } | undefined;
        if (!pass && !currentUser) return sendJson(res, 404, { message: 'Usuario no encontrado.' });
        const password = pass ? hashPassword(pass) : currentUser?.pass;
        if (!password) return sendJson(res, 404, { message: 'Usuario no encontrado.' });
        db.prepare('UPDATE users SET user = ?, pass = ?, rol = ?, manual_override = 0 WHERE id = ?')
          .run(user, password, rol, Number(id));
        recomputeUserProgress(Number(id));

        sendJson(res, 200, { message: 'Usuario actualizado' });
      } catch {
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/user/recalculate') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { id } = JSON.parse(body || '{}');
        if (!id) {
          sendJson(res, 400, { message: 'Falta el id del usuario.' });
          return;
        }

        const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
        if (!exists) {
          sendJson(res, 404, { message: 'Usuario no encontrado.' });
          return;
        }

        db.prepare('UPDATE users SET manual_override = 0 WHERE id = ?').run(id);
        const { progresoPct, calificacionPct } = recomputeUserProgress(id);
        sendJson(res, 200, { message: 'Recalculado', progreso: progresoPct, calificacion: calificacionPct });
      } catch {
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && requestUrl.startsWith('/api/user')) {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const id = Number(new URL(requestUrl, `http://${req.headers.host || 'localhost'}`).searchParams.get('id'));
    if (!id) {
      sendJson(res, 400, { message: 'Id inválido.' });
      return;
    }

    const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(id);
    if (!exists) {
      sendJson(res, 404, { message: 'Usuario no encontrado.' });
      return;
    }

    db.prepare('DELETE FROM users WHERE id = ?').run(id);
    sendJson(res, 200, { message: 'Usuario eliminado' });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/exercises') {
    const session = getSessionUser(req);
    if (!session) {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const rows = db.prepare('SELECT id, type, title, prompt, points, data FROM exercises ORDER BY position, rowid').all() as Array<{ id: string; type: string; title: string; prompt: string; points: number; data: string }>;
    const exercises = rows.map((row) => {
      let data = {};
      try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
      return { id: row.id, type: row.type, title: row.title, prompt: row.prompt, points: row.points, data };
    });
    sendJson(res, 200, { exercises });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/upload') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { fileName, mimeType, dataBase64 } = JSON.parse(body || '{}');
        if (!fileName || !dataBase64) {
          sendJson(res, 400, { message: 'Falta el archivo.' });
          return;
        }

        const buffer = Buffer.from(dataBase64, 'base64');
        const maxBytes = 15 * 1024 * 1024;
        if (buffer.length > maxBytes) {
          sendJson(res, 413, { message: 'El archivo supera los 15MB permitidos.' });
          return;
        }

        const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
        const finalName = `${Date.now()}-${safeName}`;
        fs.writeFileSync(path.join(uploadsDir, finalName), buffer);

        sendJson(res, 200, { url: `/uploads/${finalName}`, fileName, mimeType: mimeType || '' });
      } catch (err) {
        console.error('[upload] Error:', err instanceof Error ? err.message : 'Error desconocido');
        sendJson(res, 400, { message: 'No se pudo subir el archivo.' });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && req.url === '/api/exercises') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    readJson(req, res, ({ ids }) => {
      if (!Array.isArray(ids) || ids.length < 1 || ids.length > 200 || ids.some((id) => typeof id !== 'string' || id.length > 200)) {
        sendJson(res, 400, { message: 'Selecciona entre 1 y 200 ejercicios válidos.' });
        return;
      }

      const uniqueIds = [...new Set(ids)];
      try {
        db.exec('BEGIN IMMEDIATE');
        const deleteExercise = db.prepare('DELETE FROM exercises WHERE id = ?');
        const deleteProgress = db.prepare('DELETE FROM user_progress WHERE exercise_id = ?');
        let deletedCount = 0;
        uniqueIds.forEach((id) => {
          deletedCount += Number(deleteExercise.run(id).changes);
          deleteProgress.run(id);
        });
        db.exec('COMMIT');
        recomputeAllUsers();
        sendJson(res, 200, { message: 'Ejercicios eliminados.', deletedCount });
      } catch {
        db.exec('ROLLBACK');
        sendJson(res, 500, { message: 'No se pudieron eliminar los ejercicios.' });
      }
    });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/exercises/reorder') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { order } = JSON.parse(body || '{}');
        if (!Array.isArray(order)) {
          sendJson(res, 400, { message: 'Formato de orden inválido.' });
          return;
        }
        const stmt = db.prepare('UPDATE exercises SET position = ? WHERE id = ?');
        order.forEach((id, index) => stmt.run(index, id));
        sendJson(res, 200, { message: 'Orden actualizado' });
      } catch {
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/exercise') {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { id, type, title, prompt, points, data } = JSON.parse(body || '{}');
        if (!id || !type) {
          sendJson(res, 400, { message: 'Faltan datos del ejercicio.' });
          return;
        }

        const existing = db.prepare('SELECT position FROM exercises WHERE id = ?').get(id) as { position: number } | undefined;
        let position;
        if (existing) {
          position = existing.position;
        } else {
          const maxRow = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM exercises').get() as { maxPos: number };
          position = maxRow.maxPos + 1;
        }

        db.prepare(`
          INSERT INTO exercises (id, type, title, prompt, points, data, position)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(id) DO UPDATE SET
            type = excluded.type,
            title = excluded.title,
            prompt = excluded.prompt,
            points = excluded.points,
            data = excluded.data
        `).run(id, type, title || '', prompt || '', Number(points) || 1, JSON.stringify(data || {}), position);

        recomputeAllUsers();
        sendJson(res, 200, { message: 'Ejercicio guardado' });
      } catch {
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
    return;
  }

  if (req.method === 'DELETE' && requestUrl.startsWith('/api/exercise')) {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const id = new URL(requestUrl, `http://${req.headers.host || 'localhost'}`).searchParams.get('id');
    if (!id) {
      sendJson(res, 400, { message: 'Id inválido.' });
      return;
    }

    db.prepare('DELETE FROM exercises WHERE id = ?').run(id);
    db.prepare('DELETE FROM user_progress WHERE exercise_id = ?').run(id);
    recomputeAllUsers();
    sendJson(res, 200, { message: 'Ejercicio eliminado' });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/me') {
    const session = getSessionUser(req);
    if (!session) {
      // No session is a normal state on the login page, not a failed resource.
      sendJson(res, 200, { authenticated: false });
      return;
    }

    const userRow = db.prepare('SELECT id, codigo_usuario AS codigoUsuario, user, progreso, calificacion, rol FROM users WHERE id = ?').get(session.id);
    if (!userRow) {
      sendJson(res, 404, { message: 'Usuario no encontrado.' });
      return;
    }

    sendJson(res, 200, {
      authenticated: true,
      id: userRow.id,
      codigoUsuario: userRow.codigoUsuario,
      user: userRow.user,
      role: userRow.rol,
      progreso: userRow.progreso,
      calificacion: userRow.calificacion
    });
    return;
  }

  if (req.method === 'GET' && req.url === '/api/my-progress') {
    const session = getSessionUser(req);
    if (!session) {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const rows = db.prepare('SELECT exercise_id, correct, answer_data, completed FROM user_progress WHERE user_id = ?').all(session.id) as Array<{ exercise_id: string; correct: number; answer_data: string; completed: number }>;
    const userRow = db.prepare('SELECT progreso, calificacion FROM users WHERE id = ?').get(session.id) as { progreso: number; calificacion: number } | undefined;

    sendJson(res, 200, {
      items: rows.map((r) => {
        let answerData = {};
        try { answerData = JSON.parse(r.answer_data || '{}'); } catch { answerData = {}; }
        return { exerciseId: r.exercise_id, correct: !!r.correct, answerData, completed: !!r.completed };
      }),
      progreso: userRow ? userRow.progreso : 0,
      calificacion: userRow ? userRow.calificacion : 0
    });
    return;
  }

  if (req.method === 'PUT' && req.url === '/api/progress/exercise') {
    const session = getSessionUser(req);
    if (!session) {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { exerciseId, correct, answerData, completed } = JSON.parse(body || '{}');
        if (!exerciseId) {
          sendJson(res, 400, { message: 'Falta el id del ejercicio.' });
          return;
        }
        const isCompleted = completed === false ? 0 : 1;

        db.prepare(`
          INSERT INTO user_progress (user_id, exercise_id, correct, answer_data, completed)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(user_id, exercise_id) DO UPDATE SET correct = excluded.correct, answer_data = excluded.answer_data, completed = excluded.completed
        `).run(session.id, exerciseId, correct ? 1 : 0, JSON.stringify(answerData || {}), isCompleted);

        const { progresoPct, calificacionPct } = recomputeUserProgress(session.id);
        sendJson(res, 200, { message: 'Progreso actualizado', progreso: progresoPct, calificacion: calificacionPct });
      } catch (err) {
        console.error('[progress] Error al procesar body:', err instanceof Error ? err.message : 'Error desconocido');
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/register' || req.url === '/api/login')) {
    readJson(req, res, ({ user, pass, rol, challengeAnswer, website }) => {
      if (typeof user !== 'string' || typeof pass !== 'string') return sendJson(res, 400, { message: 'Faltan datos para acceder.' });
      const ip = getClientIp(req);
      const requester = req.url === '/api/register' ? getSessionUser(req) : null;
      if (req.url === '/api/login') {
        const cookies = parseCookies(req.headers.cookie || '');
        const cookieChallengeId = cookies.login_challenge;
        res.setHeader('Set-Cookie', `login_challenge=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`);
        if (typeof website === 'string' && website.trim()) {
          recordFailedLogin(ip);
          return sendJson(res, 400, { message: 'No se pudo validar el acceso. Actualiza el reto e inténtalo de nuevo.' });
        }
        if (!consumeLoginChallenge(cookieChallengeId, challengeAnswer)) {
          recordFailedLogin(ip);
          return sendJson(res, 400, { message: 'Resuelve el reto antes de acceder. Te mostramos uno nuevo.' });
        }
      }
      if (req.url === '/api/register' && (!requester || requester.rol !== 'admin')) {
        if (isRegistrationRateLimited(ip)) return sendJson(res, 429, { message: 'Se alcanzó el límite de registros desde esta conexión. Inténtalo más tarde.' });
        recordRegistrationAttempt(ip);
        const cookies = parseCookies(req.headers.cookie || '');
        const cookieChallengeId = cookies.login_challenge;
        res.setHeader('Set-Cookie', `login_challenge=; Path=/api; HttpOnly; SameSite=Strict; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`);
        if (typeof website === 'string' && website.trim()) return sendJson(res, 400, { message: 'No se pudo validar el registro. Actualiza el reto e inténtalo de nuevo.' });
        if (!consumeLoginChallenge(cookieChallengeId, challengeAnswer)) return sendJson(res, 400, { message: 'Resuelve el reto antes de registrarte. Te mostramos uno nuevo.' });
      }
      if (req.url === '/api/login' && isLoginRateLimited(ip)) return sendJson(res, 429, { message: 'Demasiados intentos. Espera 15 minutos e inténtalo de nuevo.' });
      const validationError = req.url === '/api/login' ? assertValidLogin(user, pass) : assertValidCredentials(user, pass);
      if (validationError) return sendJson(res, 400, { message: validationError });

      if (req.url === '/api/register') {
        const requestedRole = rol === 'admin' ? 'admin' : 'usuario';
        if (requestedRole === 'admin' && (!requester || requester.rol !== 'admin')) return sendJson(res, 403, { message: 'No autorizado.' });
        if ((!requester || requester.rol !== 'admin') && !isPublicRegistrationOpen()) return sendJson(res, 403, { message: 'Las inscripciones están cerradas. Consulta con la administración.' });
        const exists = db.prepare('SELECT 1 FROM users WHERE user = ?').get(user);
        if (exists) return sendJson(res, 409, { message: 'Ese usuario ya existe.' });
        db.prepare('INSERT INTO users (codigo_usuario, user, pass, progreso, calificacion, rol) VALUES (?, ?, ?, ?, ?, ?)')
          .run(nextPublicUserId(), user, hashPassword(pass), 0, 0, requestedRole);
        return sendJson(res, 201, { message: 'Registro exitoso.' });
      }

      const row = db.prepare('SELECT id, codigo_usuario AS codigoUsuario, user, pass, progreso, calificacion, rol FROM users WHERE user = ?').get(user) as UserRow | undefined;
      if (!row || !verifyPassword(pass, row.pass)) {
        recordFailedLogin(ip);
        return sendJson(res, 401, { message: 'Usuario o contraseña incorrectos.' });
      }
      loginAttempts.delete(ip);
      if (!isPasswordHash(row.pass)) db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(pass), row.id);
      setSession(res, row.id);
      sendJson(res, 200, { id: row.id, codigoUsuario: row.codigoUsuario, user: row.user, role: row.rol, progreso: row.progreso, calificacion: row.calificacion });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    clearSession(req, res);
    sendJson(res, 200, { message: 'Sesión cerrada.' });
    return;
  }

  let requestedPath;
  try {
    requestedPath = decodeURIComponent(url);
  } catch {
    sendJson(res, 400, { message: 'Ruta inválida.' });
    return;
  }
  const filePath = path.resolve(root, `.${requestedPath}`);
  const publicDir = path.join(root, 'public', 'static');
  const uploadsDirPath = path.resolve(uploadsDir);
  const relativeTo = (directory: string): string => path.relative(directory, filePath);
  const isWithin = (directory: string): boolean => {
    const relative = relativeTo(directory);
    return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  };
  const isPublicFile = filePath === path.join(root, 'index.html')
    || filePath === path.join(root, 'dist', 'client.js')
    || filePath === path.join(root, 'docs', 'manual.html')
    || isWithin(publicDir)
    || isWithin(uploadsDirPath);

  if (req.method !== 'GET' || !isPublicFile) {
    const extension = path.extname(requestedPath);
    if (req.method === 'GET' && (!extension || extension === '.html')) sendErrorPage(res, 404);
    else {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end('Not found');
    }
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      const extension = path.extname(filePath);
      if (!extension || extension === '.html') sendErrorPage(res, 404);
      else {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
        res.end('Not found');
      }
      return;
    }

    res.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=86400'
    });
    res.end(data);
  });
}

server.listen(PORT, () => {
  console.info(`Servidor corriendo en el puerto ${PORT} — build: ${SERVER_BUILD}`);
});

let shutdownStarted = false;
function shutdown(signal: NodeJS.Signals): void {
  if (shutdownStarted) return;
  shutdownStarted = true;
  console.info(`Cerrando servidor por ${signal}.`);
  const timeout = setTimeout(() => {
    console.error('Se agotó el tiempo para cerrar el servidor de forma ordenada.');
    process.exit(1);
  }, 10_000);
  timeout.unref();
  server.close((error) => {
    clearTimeout(timeout);
    if (error) {
      console.error('No se pudo cerrar el servidor limpiamente.');
      process.exitCode = 1;
    }
    db.close();
  });
}

process.once('SIGTERM', shutdown);
process.once('SIGINT', shutdown);

