import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PORT = process.env.PORT || 8080;
const IS_PRODUCTION = process.env.NODE_ENV === 'production';
const MAX_JSON_BYTES = 1_000_000;
const SERVER_BUILD = 'progress-endpoint-v1-2026-08-16';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'server', 'data');
const dbPath = path.join(dataDir, 'app.sqlite');
const uploadsDir = process.env.UPLOADS_DIR || path.join(root, 'uploads');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
const db = new DatabaseSync(dbPath);

db.exec(`CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user TEXT UNIQUE,
  pass TEXT,
  progreso INTEGER DEFAULT 0,
  calificacion INTEGER DEFAULT 0,
  rol TEXT DEFAULT 'usuario'
)`);

const schema = db.prepare("PRAGMA table_info(users)").all();
const fields = schema.map((col) => col.name);
if (!fields.includes('progreso')) db.exec('ALTER TABLE users ADD COLUMN progreso INTEGER DEFAULT 0');
if (!fields.includes('calificacion')) db.exec('ALTER TABLE users ADD COLUMN calificacion INTEGER DEFAULT 0');
if (!fields.includes('rol')) db.exec('ALTER TABLE users ADD COLUMN rol TEXT DEFAULT "usuario"');
if (!fields.includes('manual_override')) db.exec('ALTER TABLE users ADD COLUMN manual_override INTEGER DEFAULT 0');
db.exec('UPDATE users SET manual_override = 0 WHERE manual_override <> 0');

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

function recomputeUserProgress(userId) {
  const userRow = db.prepare('SELECT manual_override FROM users WHERE id = ?').get(userId);
  if (userRow && userRow.manual_override) {
    const current = db.prepare('SELECT progreso, calificacion FROM users WHERE id = ?').get(userId);
    return { progresoPct: current.progreso, calificacionPct: current.calificacion };
  }

  const gradableTypes = "'Separador', 'Archivo', 'Imagen', 'Documento', 'Presentación', 'Texto'";
  const totalRow = db.prepare(`
    SELECT COUNT(*) AS exerciseCount, COALESCE(SUM(CASE WHEN points > 0 THEN points ELSE 1 END), 0) AS totalPoints
    FROM exercises WHERE type NOT IN (${gradableTypes})
  `).get();
  const scoreRow = db.prepare(`
    SELECT COUNT(*) AS completedCount,
      COALESCE(SUM(CASE WHEN user_progress.correct THEN CASE WHEN exercises.points > 0 THEN exercises.points ELSE 1 END ELSE 0 END), 0) AS earnedPoints
    FROM user_progress
    INNER JOIN exercises ON exercises.id = user_progress.exercise_id
    WHERE user_progress.user_id = ? AND user_progress.completed = 1 AND exercises.type NOT IN (${gradableTypes})
  `).get(userId);

  const progresoPct = totalRow.exerciseCount > 0 ? Math.round((scoreRow.completedCount / totalRow.exerciseCount) * 100) : 0;
  const calificacionPct = totalRow.totalPoints > 0 ? Math.round((scoreRow.earnedPoints / totalRow.totalPoints) * 100) : 0;

  db.prepare('UPDATE users SET progreso = ?, calificacion = ? WHERE id = ?').run(progresoPct, calificacionPct, userId);
  return { progresoPct, calificacionPct };
}

const isPasswordHash = (value) => typeof value === 'string' && value.startsWith('scrypt$');
const hashPassword = (password) => {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
};
const verifyPassword = (password, stored) => {
  if (!stored) return false;
  if (!isPasswordHash(stored)) {
    const passwordBuffer = Buffer.from(password);
    const storedBuffer = Buffer.from(stored);
    return passwordBuffer.length === storedBuffer.length && crypto.timingSafeEqual(passwordBuffer, storedBuffer);
  }
  const [, salt, expected] = stored.split('$');
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
};
const assertValidCredentials = (user, pass) => {
  if (typeof user !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(user)) return 'El usuario debe tener entre 3 y 50 caracteres (letras, números, punto, guion o guion bajo).';
  if (typeof pass !== 'string' || pass.length < 10 || pass.length > 128) return 'La contraseña debe tener entre 10 y 128 caracteres.';
  return null;
};
const assertValidLogin = (user, pass) => {
  if (typeof user !== 'string' || !/^[a-zA-Z0-9._-]{3,50}$/.test(user)) return 'El usuario no tiene un formato válido.';
  if (typeof pass !== 'string' || pass.length < 1 || pass.length > 128) return 'La contraseña no tiene un formato válido.';
  return null;
};

const sessions = new Map();
const parseCookies = (header = '') => Object.fromEntries(header.split(';').map((part) => {
  const index = part.indexOf('=');
  return index < 0 ? [] : [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1))];
}).filter((entry) => entry.length));
const getSessionUser = (req) => {
  const token = parseCookies(req.headers.cookie || '').session;
  const session = token && sessions.get(token);
  if (!session || session.expiresAt < Date.now()) {
    if (token) sessions.delete(token);
    return null;
  }
  return db.prepare('SELECT id, user, progreso, calificacion, rol FROM users WHERE id = ?').get(session.userId) || null;
};
const setSession = (res, userId) => {
  const token = crypto.randomBytes(32).toString('base64url');
  sessions.set(token, { userId, expiresAt: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const secure = IS_PRODUCTION ? '; Secure' : '';
  res.setHeader('Set-Cookie', `session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure}`);
};
const clearSession = (req, res) => {
  const token = parseCookies(req.headers.cookie || '').session;
  if (token) sessions.delete(token);
  res.setHeader('Set-Cookie', `session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${IS_PRODUCTION ? '; Secure' : ''}`);
};
const readJson = (req, res, handler) => {
  let size = 0;
  let body = '';
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size > MAX_JSON_BYTES) {
      req.destroy();
      return;
    }
    body += chunk;
  });
  req.on('end', () => {
    if (size > MAX_JSON_BYTES) return sendJson(res, 413, { message: 'La solicitud excede el tamaño permitido.' });
    try { handler(JSON.parse(body || '{}')); } catch { sendJson(res, 400, { message: 'Datos inválidos.' }); }
  });
};

const adminCount = db.prepare("SELECT COUNT(*) AS count FROM users WHERE rol = 'admin'").get().count;
if (!adminCount) {
  const adminUser = process.env.ADMIN_USER;
  const adminPassword = process.env.ADMIN_PASSWORD;
  const validationError = assertValidCredentials(adminUser, adminPassword);
  if (validationError) {
    if (IS_PRODUCTION) throw new Error(`Se requiere ADMIN_USER y ADMIN_PASSWORD seguros para iniciar producción. ${validationError}`);
  } else {
    db.prepare('INSERT INTO users (user, pass, progreso, calificacion, rol) VALUES (?, ?, ?, ?, ?)')
      .run(adminUser, hashPassword(adminPassword), 0, 0, 'admin');
  }
}
recomputeAllUsers();

function recomputeAllUsers() {
  db.prepare('SELECT id FROM users').all().forEach(({ id }) => recomputeUserProgress(id));
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
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

const sendJson = (res, status, obj) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
};

const server = http.createServer((req, res) => {
  const declaredLength = Number(req.headers['content-length'] || 0);
  const requestLimit = req.url === '/api/upload' ? 21 * 1024 * 1024 : MAX_JSON_BYTES;
  if (declaredLength > requestLimit) {
    sendJson(res, 413, { message: 'La solicitud excede el tamaño permitido.' });
    return;
  }
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('Content-Security-Policy', "default-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'; style-src 'self'; script-src 'self'; img-src 'self' data:; media-src 'self'; frame-src https://www.youtube.com https://www.youtube-nocookie.com; connect-src 'self'");
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { Allow: 'GET, POST, PUT, DELETE, OPTIONS' });
    res.end();
    return;
  }
  if (['POST', 'PUT', 'DELETE'].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}` && req.headers.origin !== `https://${req.headers.host}`) {
    sendJson(res, 403, { message: 'Origen no autorizado.' });
    return;
  }
  const requestPath = req.url.split('?')[0];
  const url = requestPath === '/' ? '/index.html' : requestPath;

  if (req.method === 'GET' && req.url === '/healthz') {
    sendJson(res, 200, { status: 'ok', build: SERVER_BUILD });
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

    const users = db.prepare('SELECT id, user, progreso, calificacion, rol, manual_override FROM users ORDER BY id').all();
    sendJson(res, 200, { users });
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
        const { id, user, pass, progreso, calificacion, rol } = JSON.parse(body || '{}');
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

        const password = pass ? hashPassword(pass) : db.prepare('SELECT pass FROM users WHERE id = ?').get(id).pass;
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

  if (req.method === 'DELETE' && req.url.startsWith('/api/user')) {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const id = Number(new URL(req.url, `http://${req.headers.host}`).searchParams.get('id'));
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

    const rows = db.prepare('SELECT id, type, title, prompt, points, data FROM exercises ORDER BY position, rowid').all();
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
        console.log('[upload] Error:', err.message);
        sendJson(res, 400, { message: 'No se pudo subir el archivo.' });
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

        const existing = db.prepare('SELECT position FROM exercises WHERE id = ?').get(id);
        let position;
        if (existing) {
          position = existing.position;
        } else {
          const maxRow = db.prepare('SELECT COALESCE(MAX(position), -1) as maxPos FROM exercises').get();
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

  if (req.method === 'DELETE' && req.url.startsWith('/api/exercise')) {
    const session = getSessionUser(req);
    if (!session || session.rol !== 'admin') {
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const id = new URL(req.url, `http://${req.headers.host}`).searchParams.get('id');
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
      sendJson(res, 403, { message: 'No autorizado' });
      return;
    }

    const userRow = db.prepare('SELECT id, user, progreso, calificacion, rol FROM users WHERE id = ?').get(session.id);
    if (!userRow) {
      sendJson(res, 404, { message: 'Usuario no encontrado.' });
      return;
    }

    sendJson(res, 200, {
      id: userRow.id,
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

    const rows = db.prepare('SELECT exercise_id, correct, answer_data, completed FROM user_progress WHERE user_id = ?').all(session.id);
    const userRow = db.prepare('SELECT progreso, calificacion FROM users WHERE id = ?').get(session.id);

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
      console.log('[progress] Rechazado: no hay sesión válida.');
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
        console.log(`[progress] usuario id=${session.id} ejercicio=${exerciseId} correcto=${!!correct} completado=${!!isCompleted} -> progreso=${progresoPct}, calificacion=${calificacionPct}`);
        sendJson(res, 200, { message: 'Progreso actualizado', progreso: progresoPct, calificacion: calificacionPct });
      } catch (err) {
        console.log('[progress] Error al procesar body:', err.message);
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
    return;
  }

  if (req.method === 'POST' && (req.url === '/api/register' || req.url === '/api/login')) {
    readJson(req, res, ({ user, pass, rol }) => {
      const validationError = req.url === '/api/login' ? assertValidLogin(user, pass) : assertValidCredentials(user, pass);
      if (validationError) return sendJson(res, 400, { message: validationError });

      if (req.url === '/api/register') {
        const requester = getSessionUser(req);
        const requestedRole = rol === 'admin' ? 'admin' : 'usuario';
        if (requestedRole === 'admin' && (!requester || requester.rol !== 'admin')) return sendJson(res, 403, { message: 'No autorizado.' });
        const exists = db.prepare('SELECT 1 FROM users WHERE user = ?').get(user);
        if (exists) return sendJson(res, 409, { message: 'Ese usuario ya existe.' });
        db.prepare('INSERT INTO users (user, pass, progreso, calificacion, rol) VALUES (?, ?, ?, ?, ?)')
          .run(user, hashPassword(pass), 0, 0, requestedRole);
        return sendJson(res, 201, { message: 'Registro exitoso.' });
      }

      const row = db.prepare('SELECT id, user, pass, progreso, calificacion, rol FROM users WHERE user = ?').get(user);
      if (!row || !verifyPassword(pass, row.pass)) return sendJson(res, 401, { message: 'Usuario o contraseña incorrectos.' });
      if (!isPasswordHash(row.pass)) db.prepare('UPDATE users SET pass = ? WHERE id = ?').run(hashPassword(pass), row.id);
      setSession(res, row.id);
      sendJson(res, 200, { id: row.id, user: row.user, role: row.rol, progreso: row.progreso, calificacion: row.calificacion });
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/api/logout') {
    clearSession(req, res);
    sendJson(res, 200, { message: 'Sesión cerrada.' });
    return;
  }

  if (false && req.method === 'POST' && (req.url === '/api/register' || req.url === '/api/login')) {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      try {
        const { user, pass } = JSON.parse(body || '{}');
        if (!user || !pass) {
          sendJson(res, 400, { message: 'Faltan datos.' });
          return;
        }

        if (req.url === '/api/register') {
          const exists = db.prepare('SELECT 1 FROM users WHERE user = ?').get(user);
          if (exists) {
            sendJson(res, 409, { message: 'Ese usuario ya existe.' });
            return;
          }
          db.prepare('INSERT INTO users (user, pass, progreso, calificacion, rol) VALUES (?, ?, ?, ?, ?)')
            .run(user, pass, 0, 0, 'usuario');
          sendJson(res, 201, { message: 'Registrada con éxito' });
          return;
        }

        const row = db.prepare('SELECT id, user, pass, progreso, calificacion, rol FROM users WHERE user = ? AND pass = ?').get(user, pass);
        if (!row) {
          sendJson(res, 401, { message: 'Usuario o contraseña incorrectos.' });
          return;
        }

        sendJson(res, 200, {
          id: row.id,
          user: row.user,
          role: row.rol,
          progreso: row.progreso,
          calificacion: row.calificacion
        });
      } catch {
        sendJson(res, 400, { message: 'Datos inválidos.' });
      }
    });
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

  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }

    res.writeHead(200, {
      'Content-Type': types[path.extname(filePath)] || 'application/octet-stream',
      'Cache-Control': path.extname(filePath) === '.html' ? 'no-store' : 'public, max-age=86400'
    });
    res.end(data);
  });
});

server.listen(PORT, () => {
  console.log(`Servidor corriendo en el puerto ${PORT} — build: ${SERVER_BUILD}`);
});
