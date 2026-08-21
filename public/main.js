import { authView } from './views/authView.js';
import { courseView } from './views/courseView.js';

function ensureToastContainer() {
  let container = document.getElementById('toastContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toastContainer';
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(message, type = 'info', duration = 4200) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `
    <span class="toast-icon">${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span>
    <span class="toast-message">${message}</span>
    <button type="button" class="toast-close" aria-label="Cerrar">✕</button>
  `;
  container.appendChild(toast);

  const remove = () => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 200);
  };

  toast.querySelector('.toast-close').addEventListener('click', remove);
  if (duration > 0) setTimeout(remove, duration);

  requestAnimationFrame(() => toast.classList.add('toast-visible'));
  return toast;
}

export function showConfirm(message, { confirmText = 'Confirmar', cancelText = 'Cancelar', danger = true } = {}) {
  return new Promise((resolve) => {
    document.querySelectorAll('.confirm-overlay').forEach((old) => old.remove());

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal">
        <p class="confirm-message">${message}</p>
        <div class="confirm-actions">
          <button type="button" class="btn ghost confirm-cancel">${cancelText}</button>
          <button type="button" class="btn ${danger ? 'danger' : 'primary'} confirm-ok">${confirmText}</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('confirm-visible'));

    const cleanup = (result) => {
      overlay.classList.remove('confirm-visible');
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    };

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(false));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => cleanup(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(false); });
    document.addEventListener('keydown', function escHandler(e) {
      if (e.key === 'Escape') { cleanup(false); document.removeEventListener('keydown', escHandler); }
    });
  });
}

export function showPrompt(message, defaultValue = '') {
  return new Promise((resolve) => {
    document.querySelectorAll('.confirm-overlay').forEach((old) => old.remove());

    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-modal">
        <p class="confirm-message">${message}</p>
        <input type="text" class="prompt-input" value="${defaultValue}" />
        <div class="confirm-actions">
          <button type="button" class="btn ghost confirm-cancel">Cancelar</button>
          <button type="button" class="btn primary confirm-ok">Aceptar</button>
        </div>
      </div>
    `;
    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('confirm-visible'));

    const input = overlay.querySelector('.prompt-input');
    input.focus();
    input.select();

    const cleanup = (result) => {
      overlay.classList.remove('confirm-visible');
      setTimeout(() => overlay.remove(), 150);
      resolve(result);
    };

    overlay.querySelector('.confirm-cancel').addEventListener('click', () => cleanup(null));
    overlay.querySelector('.confirm-ok').addEventListener('click', () => cleanup(input.value.trim() || null));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') cleanup(input.value.trim() || null);
      if (e.key === 'Escape') cleanup(null);
    });
    overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(null); });
  });
}

export const SEPARATOR_TYPE = 'Separador';
export const SUPPORT_EMAIL = 'aramirezcanelo@gmail.com';

export function showSupportModal() {
  document.querySelectorAll('.confirm-overlay').forEach((old) => old.remove());

  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-modal support-modal">
      <p class="confirm-message">Soporte</p>
      <p class="field-hint">Escribe tu duda o problema y se abrirá tu programa de correo con el mensaje listo para enviar a ${SUPPORT_EMAIL}.</p>
      <div class="field-group">
        <label>Asunto:</label>
        <input type="text" class="support-subject" placeholder="Ej. No puedo entrar a mi cuenta" />
      </div>
      <div class="field-group">
        <label>Mensaje:</label>
        <textarea class="prompt-textarea support-body" placeholder="Cuéntanos qué pasó..."></textarea>
      </div>
      <div class="confirm-actions">
        <button type="button" class="btn ghost confirm-cancel">Cancelar</button>
        <button type="button" class="btn primary confirm-ok">Enviar por correo</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('confirm-visible'));

  const subjectInput = overlay.querySelector('.support-subject');
  const bodyInput = overlay.querySelector('.support-body');
  subjectInput.focus();

  const cleanup = () => {
    overlay.classList.remove('confirm-visible');
    setTimeout(() => overlay.remove(), 150);
  };

  overlay.querySelector('.confirm-cancel').addEventListener('click', cleanup);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) cleanup(); });

  overlay.querySelector('.confirm-ok').addEventListener('click', () => {
    const subject = subjectInput.value.trim() || 'Soporte Gran Chaique';
    const body = bodyInput.value.trim();
    const mailto = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
    cleanup();
  });
}

function hashStringToSeed(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) || 1;
}

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return function next() {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

export function generateWordSearchGrid(words, size = 12) {
  const clean = (words || []).map((w) => w.toUpperCase().replace(/[^A-ZÑ]/g, '')).filter(Boolean);
  const rand = seededRandom(hashStringToSeed(clean.join('|') + '|' + size));
  const grid = Array.from({ length: size }, () => Array(size).fill(null));
  const directions = [[0, 1], [1, 0], [1, 1]];

  clean.forEach((word) => {
    if (word.length > size) return;
    let placed = false;
    for (let attempt = 0; attempt < 60 && !placed; attempt++) {
      const [dr, dc] = directions[Math.floor(rand() * directions.length)];
      const maxRow = dr ? size - word.length : size - 1;
      const maxCol = dc ? size - word.length : size - 1;
      const row = Math.floor(rand() * (maxRow + 1));
      const col = Math.floor(rand() * (maxCol + 1));

      let fits = true;
      for (let i = 0; i < word.length; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        if (grid[r][c] !== null && grid[r][c] !== word[i]) { fits = false; break; }
      }
      if (!fits) continue;

      for (let i = 0; i < word.length; i++) {
        const r = row + dr * i;
        const c = col + dc * i;
        grid[r][c] = word[i];
      }
      placed = true;
    }
  });

  const alphabet = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (!grid[r][c]) grid[r][c] = alphabet[Math.floor(rand() * alphabet.length)];
    }
  }

  return grid.map((row) => row.join('')).join('');
}

async function startApp() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.ok) return courseView(await response.json());
  } catch {
    showToast('No se pudo verificar la sesión.', 'error');
  }
  authView();
}

startApp();
