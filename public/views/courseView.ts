import { dashboardView } from './dashboardView';
import { showToast, showSupportModal, SEPARATOR_TYPE, generateWordSearchGrid, escapeHtml } from '../shared/ui';
import { openUserManual } from '../shared/manual';

function getYouTubeEmbedUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    const id = host === 'youtu.be' ? parsed.pathname.slice(1) :
      ['youtube.com', 'www.youtube.com', 'm.youtube.com'].includes(host)
        ? (parsed.pathname === '/watch' ? parsed.searchParams.get('v') : parsed.pathname.match(/^\/(?:embed|shorts)\/([^/]+)/)?.[1])
        : null;
    return id && /^[a-zA-Z0-9_-]{11}$/.test(id) ? `https://www.youtube-nocookie.com/embed/${id}` : '';
  } catch { return ''; }
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function formatTime(totalSeconds) {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const FILE_CARD_TYPES = ['Archivo', 'Imagen', 'Documento', 'Presentación'];
const isFileCardType = (type) => FILE_CARD_TYPES.includes(type);

const progress = {};
const inProgress = {};
let currentExercises = [];
let progressSyncWarned = false;

function syncAnswerToServer(exerciseId, correct, answerData, completed = true) {
  fetch('/api/progress/exercise', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ exerciseId, correct, answerData: answerData || {}, completed })
  })
    .then(async (res) => {
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        console.error('No se pudo guardar la respuesta en el servidor:', data.message || res.status);
        if (!progressSyncWarned) {
          progressSyncWarned = true;
          showToast('Tu progreso no se pudo guardar en el servidor. Revisa tu sesión.', 'error');
        }
        return;
      }
      const data = await res.json().catch(() => ({}));
      if (completed) updateProgressUI(data.progreso, data.calificacion);
    })
    .catch((err) => {
      console.error('Error de red al sincronizar la respuesta:', err);
      if (!progressSyncWarned) {
        progressSyncWarned = true;
        showToast('No se pudo conectar con el servidor para guardar tu progreso.', 'error');
      }
    });
}

function syncInProgress(exerciseId, answerData) {
  syncAnswerToServer(exerciseId, false, answerData, false);
}

function updateProgressUI(progresoPct, calificacionPct) {
  const fill = document.querySelector('.course-progress-bar-fill') as HTMLProgressElement | null;
  const label = document.querySelector('.course-progress-label');
  const gradeValue = document.querySelector('.course-grade-value');
  if (fill) fill.value = progresoPct;
  if (label) label.textContent = `${progresoPct}%`;
  if (gradeValue) gradeValue.textContent = `${calificacionPct}/100`;
}

function markProgress(container, exId, correct, answerData) {
  progress[exId] = { done: true, correct, answerData: answerData || {} };
  delete inProgress[exId];
  const statusEl = container.querySelector(`[data-exercise-id="${exId}"] .top-bar-status`);
  if (statusEl) {
    statusEl.textContent = correct ? 'Completado' : 'Revisar';
    statusEl.classList.remove('status-progress');
    statusEl.classList.add(correct ? 'status-correct' : 'status-incorrect');
  }
  syncAnswerToServer(exId, correct, answerData, true);
  renderSidebar(currentExercises);
}

function renderSidebar(exercises) {
  const list = document.getElementById('sidebarList');
  if (!list) return;

  if (!exercises || exercises.length === 0) {
    list.innerHTML = '<p class="empty-state">Sin contenido todavía.</p>';
    return;
  }

  list.innerHTML = exercises.map((ex) => {
    if (ex.type === SEPARATOR_TYPE) {
      return `<div class="sidebar-separator"><span class="sidebar-separator-line"></span>${escapeHtml(ex.title || 'Sección')}<span class="sidebar-separator-line"></span></div>`;
    }
    if (isFileCardType(ex.type) || ex.type === 'Texto') {
      return `
        <button type="button" class="sidebar-item sidebar-item-file" data-target="${escapeHtml(ex.id)}">
          <span class="sidebar-item-icon sidebar-item-icon-file"></span>
          <span class="sidebar-item-title">${escapeHtml(ex.title)}</span>
        </button>
      `;
    }
    const state = progress[ex.id];
    const stateClass = state ? (state.correct ? 'sidebar-item-correct' : 'sidebar-item-incorrect') : 'sidebar-item-pending';
    return `
      <button type="button" class="sidebar-item ${stateClass}" data-target="${escapeHtml(ex.id)}">
        <span class="sidebar-item-icon"></span>
        <span class="sidebar-item-title">${escapeHtml(ex.title)}</span>
      </button>
    `;
  }).join('');

  list.querySelectorAll('.sidebar-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const card = document.querySelector(`[data-exercise-id="${btn.dataset.target}"]`);
      card?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  });
}

function renderSeparator(ex) {
  return `<div class="course-separator" data-exercise-id="${escapeHtml(ex.id)}"><h2>${escapeHtml(ex.title || 'Sección')}</h2></div>`;
}

function fileIconFor(mimeType, fileName) {
  const name = (fileName || '').toLowerCase();
  if ((mimeType || '').startsWith('image/')) return 'IMG';
  if (mimeType === 'application/pdf' || name.endsWith('.pdf')) return 'PDF';
  if (name.endsWith('.doc') || name.endsWith('.docx')) return 'DOC';
  if (name.endsWith('.xls') || name.endsWith('.xlsx')) return 'XLS';
  if (name.endsWith('.ppt') || name.endsWith('.pptx')) return 'PPT';
  return 'ARCHIVO';
}

function renderTextCard(ex) {
  return `
    <div class="exercise-card-view file-resource-card" data-exercise-id="${escapeHtml(ex.id)}">
      <div class="gform-accent"></div>
      <div class="exercise-card-body">
        <div class="card-top-bar">
          <div class="top-bar-left">
            <span class="top-bar-type">Material del curso</span>
          </div>
        </div>
        <h3 class="exercise-main-title">${escapeHtml(ex.title)}</h3>
        <div class="text-resource-content">${(ex.data?.content || '').split('\n').map((line) => `<p>${escapeHtml(line) || '&nbsp;'}</p>`).join('')}</div>
      </div>
    </div>
  `;
}

function renderFileCard(ex) {
  const requestedFileUrl = ex.data?.fileUrl || '';
  const fileUrl = /^\/uploads\/[a-zA-Z0-9._-]{1,200}$/.test(requestedFileUrl) ? requestedFileUrl : '';
  const fileName = ex.data?.fileName || 'Archivo';
  const mimeType = ex.data?.mimeType || '';
  const isImage = mimeType.startsWith('image/');
  const isPdf = mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf');
  const isOffice = /\.(docx?|xlsx?|pptx?)$/i.test(fileName);
  const icon = fileIconFor(mimeType, fileName);
  const absoluteUrl = fileUrl ? `${window.location.origin}${fileUrl}` : '';
  const officeViewerUrl = absoluteUrl ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(absoluteUrl)}` : '';

  let previewHtml = '';
  if (isImage) {
    previewHtml = `<img src="${escapeHtml(fileUrl)}" class="file-resource-preview" alt="${escapeHtml(fileName)}" />`;
  } else if (isPdf) {
    previewHtml = `
      <div class="file-resource-pdf-wrap">
        <div class="file-resource-pdf-label">Vista previa</div>
        <iframe src="${escapeHtml(fileUrl)}#toolbar=0&navpanes=0&statusbar=0&view=FitH" class="file-resource-pdf" title="${escapeHtml(fileName)}"></iframe>
      </div>
    `;
  }

  return `
    <div class="exercise-card-view file-resource-card" data-exercise-id="${escapeHtml(ex.id)}">
      <div class="gform-accent"></div>
      <div class="exercise-card-body">
        <div class="card-top-bar">
          <div class="top-bar-left">
            <span class="top-bar-type">Material del curso</span>
          </div>
        </div>
        <h3 class="exercise-main-title">${escapeHtml(ex.title)}</h3>
        ${ex.prompt ? `<p class="exercise-instruction">${escapeHtml(ex.prompt)}</p>` : ''}
        ${fileUrl ? `
          <div class="file-resource-box">
            <span class="file-resource-icon">${icon}</span>
            <div class="file-resource-info"><strong>${escapeHtml(fileName)}</strong></div>
            <div class="file-resource-actions">
              ${isOffice ? `<a href="${officeViewerUrl}" target="_blank" rel="noopener" class="btn ghost">Ver en línea</a>` : ''}
              <a href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener" class="btn-action-pink">${isImage || isPdf ? 'Ver / Descargar' : 'Descargar'}</a>
            </div>
          </div>
          ${previewHtml}
          ${isOffice ? '<p class="field-hint">Si "Ver en línea" no carga, es porque el visor de Office necesita que el sitio sea accesible desde internet (no funciona en localhost). Puedes descargarlo mientras tanto.</p>' : ''}
        ` : '<p class="empty-state">El admin todavía no subió un archivo aquí.</p>'}
      </div>
    </div>
  `;
}

function renderExerciseCard(ex) {
  const points = ex.points !== undefined ? ex.points : 1;
  let contentHtml = '';

  if (ex.type === 'Quizz con Video' || ex.type === 'Quizz conTexto') {
    const embedUrl = ex.type === 'Quizz con Video' ? getYouTubeEmbedUrl(ex.data?.videoUrl) : '';
    const options = ex.data?.options || [];
    contentHtml = `
      ${embedUrl ? `
        <div class="video-wrapper">
          <iframe src="${embedUrl}" allowfullscreen></iframe>
        </div>
      ` : ''}
      <p class="exercise-instruction"><strong>${escapeHtml(ex.data?.question || ex.prompt)}</strong><span class="gform-required">*</span></p>
      <div class="options-group" data-role="quiz-options">
        ${options.map((opt, i) => `
          <label class="pink-option-btn" data-optindex="${i}">
            <input type="radio" name="quiz-${escapeHtml(ex.id)}" value="${i}"> <span>${escapeHtml(opt || `Opción ${i + 1}`)}</span>
          </label>
        `).join('')}
      </div>
      <div class="gform-feedback-slot"></div>
      <button type="button" class="btn-action-pink" data-action="validate-quiz">Validar respuesta</button>
    `;
  } else if (ex.type === 'Completa la frase') {
    const sentence = escapeHtml(ex.data?.sentence || '').replace(/___+/, '<span class="blank-marker">_____</span>');
    contentHtml = `
      <p class="exercise-instruction"><strong>${sentence || escapeHtml(ex.prompt)}</strong><span class="gform-required">*</span></p>
      <input type="text" class="gform-text-input" placeholder="Escribe tu respuesta" data-role="fill-input" />
      <div class="gform-feedback-slot"></div>
      <br/>
      <button type="button" class="btn-action-pink" data-action="validate-fill">Validar respuesta</button>
    `;
  } else if (ex.type === 'Ahorcado') {
    const alphabet = 'ABCDEFGHIJKLMNÑOPQRSTUVWXYZ'.split('');
    const targetWord = (ex.data?.palabraSecreta || 'ORATORIA').toUpperCase();
    const maxIntentos = ex.data?.maxIntentos || 6;
    contentHtml = `
      <p class="exercise-subtitle">${escapeHtml(ex.prompt || '')}</p>
      <p class="exercise-instruction">Pista: ${escapeHtml(ex.data?.pista || 'Sin pista')}</p>
      <p class="exercise-instruction">Intentos restantes: <strong data-role="attempts-left">${maxIntentos}</strong></p>
      <div class="word-slashes" data-role="word-slashes" data-word="${escapeHtml(targetWord)}">
        ${targetWord.split('').map(() => `<div class="slash-slot"><div class="slash"></div></div>`).join('')}
      </div>
      <div class="letters-grid" data-role="letters-grid" data-max-attempts="${maxIntentos}">
        ${alphabet.map(l => `<button type="button" class="letter-btn" data-letter="${l}">${l}</button>`).join('')}
      </div>
      <div class="gform-feedback-slot"></div>
    `;
  } else if (ex.type === 'Sopa de letras') {
    const size = 12;
    const words = ex.data?.palabrasOcultas || [];
    const grid = generateWordSearchGrid(words, size);
    const gridLetters = grid.split('');
    const maxAttempts = ex.data?.maxAttempts ?? 1;
    const timeLimitMinutes = ex.data?.timeLimitMinutes ?? 5;
    contentHtml = `
      <p class="exercise-subtitle">${escapeHtml(ex.prompt || '')}</p>
      <p class="exercise-instruction">Palabras: <strong data-role="pending-words">${escapeHtml(words.join(', ') || 'N/A')}</strong></p>
      <p class="exercise-instruction">Encontradas: <span data-role="found-count">0</span>/${words.length} — Intentos fallidos permitidos: <strong data-role="attempts-left">${maxAttempts}</strong> — Tiempo: <strong data-role="time-left">${formatTime(timeLimitMinutes * 60)}</strong></p>
      <div class="timed-exercise-wrapper" data-role="timed-wrapper">
        <div class="sopa-grid" role="group" aria-label="Tablero de sopa de letras" data-role="sopa-grid" data-words="${escapeHtml(words.join(','))}" data-max-attempts="${maxAttempts}" data-time-limit="${timeLimitMinutes * 60}">
          ${gridLetters.slice(0, size * size).map((l, i) => `<button type="button" class="sopa-cell" data-cellindex="${i}" aria-label="Fila ${Math.floor(i / size) + 1}, columna ${i % size + 1}, letra ${l}" tabindex="${i === 0 ? '0' : '-1'}" disabled>${l}</button>`).join('')}
        </div>
        <div class="gform-feedback-slot"></div>
        <button type="button" class="btn-action-pink" data-action="check-word">Comprobar selección</button>
        <button type="button" class="btn ghost" data-action="clear-selection">Limpiar selección</button>
        <div class="start-gate-overlay" data-role="start-gate">
          <button type="button" class="btn-action-pink" data-action="start-exercise">▶ Comenzar</button>
        </div>
      </div>
    `;
  } else if (ex.type === 'Pares') {
    const items = ex.data?.items || [];
    const shuffledDefs = shuffle(items.map((it, i) => ({ text: it.definicion, i })));
    const maxAttempts = ex.data?.maxAttempts ?? 1;
    contentHtml = `
      <p class="exercise-instruction">${escapeHtml(ex.prompt || 'Relaciona cada concepto con su definición')}</p>
      <p class="exercise-instruction">Intentos fallidos permitidos: <strong data-role="attempts-left">${maxAttempts}</strong></p>
      <div class="pairs-container" data-max-attempts="${maxAttempts}">
        <div>
          <h4>CONCEPTOS</h4>
          ${items.map((item, i) => `<button type="button" class="pink-card-item" data-role="concepto" data-pairindex="${i}">${escapeHtml(item.concepto)}</button>`).join('')}
        </div>
        <div>
          <h4>DEFINICIONES</h4>
          ${shuffledDefs.map((d) => `<button type="button" class="pink-card-item" data-role="definicion" data-pairindex="${d.i}">${escapeHtml(d.text)}</button>`).join('')}
        </div>
      </div>
      <div class="gform-feedback-slot"></div>
    `;
  } else if (ex.type === 'Causalidad') {
    const pasos = ex.data?.pasos && ex.data.pasos.length ? ex.data.pasos : ['Paso 1', 'Paso 2'];
    const shuffled = shuffle(pasos.map((texto, i) => ({ texto, originalIndex: i })));
    const maxAttempts = ex.data?.maxAttempts ?? 1;
    contentHtml = `
      <p class="exercise-instruction">${escapeHtml(ex.data?.pregunta || ex.prompt)}</p>
      <p class="exercise-instruction">Intentos permitidos: <strong data-role="attempts-left">${maxAttempts}</strong></p>
      <div class="causality-list" data-role="causality-list" data-max-attempts="${maxAttempts}">
        ${shuffled.map((p) => `
          <div class="causality-row" data-original-index="${p.originalIndex}">
            <span>${escapeHtml(p.texto)}</span>
            <div class="arrow-btn-group">
              <button type="button" class="arrow-btn" data-action="move-up">▲</button>
              <button type="button" class="arrow-btn" data-action="move-down">▼</button>
            </div>
          </div>
        `).join('')}
      </div>
      <div class="gform-feedback-slot"></div>
      <button type="button" class="btn-action-pink" data-action="check-order">Verificar orden</button>
    `;
  } else if (ex.type === 'Memorama') {
    const conceptos = ex.data?.cartas && ex.data.cartas.length ? ex.data.cartas : ['Concepto 1', 'Concepto 2', 'Concepto 3'];
    const deck = shuffle(conceptos.flatMap((value, pairId) => ([
      { value, pairId, uid: `${pairId}-a` },
      { value, pairId, uid: `${pairId}-b` }
    ])));
    contentHtml = `
      <p class="exercise-subtitle">${escapeHtml(ex.prompt)}</p>
      <div class="memorama-grid" data-role="memorama-grid" data-total-pairs="${conceptos.length}">
        ${deck.map((card) => `
          <button type="button" class="memo-card" aria-label="Carta oculta" data-uid="${card.uid}" data-pairid="${card.pairId}" data-value="${escapeHtml(card.value)}" tabindex="${deck[0].uid === card.uid ? '0' : '-1'}">?</button>
        `).join('')}
      </div>
      <div class="gform-feedback-slot"></div>
    `;
  } else {
    contentHtml = `<p class="exercise-instruction">${escapeHtml(ex.prompt)}</p>`;
  }

  return `
    <div class="exercise-card-view" data-exercise-id="${escapeHtml(ex.id)}">
      <div class="gform-accent"></div>
      <div class="exercise-card-body">
        <div class="card-top-bar">
          <div class="top-bar-left">
            <span class="top-bar-type">${escapeHtml(ex.type)}</span>
            <span class="top-bar-status status-progress">Sin responder</span>
          </div>
          <span class="top-bar-pts">${points} pts</span>
        </div>
        <h3 class="exercise-main-title">${escapeHtml(ex.title)}</h3>
        ${contentHtml}
      </div>
    </div>
  `;
}

function showFeedback(card, correct, correctText) {
  const slot = card.querySelector('.gform-feedback-slot');
  if (!slot) return;
  slot.innerHTML = `
    <p class="gform-feedback ${correct ? 'correct' : 'incorrect'}">
      ${correct ? '✓ ¡Correcto!' : `✕ Incorrecto.${correctText ? ` Respuesta correcta: ${escapeHtml(correctText)}` : ''}`}
    </p>
  `;
}

function showRetryFeedback(card, attemptsLeft) {
  const slot = card.querySelector('.gform-feedback-slot');
  if (!slot) return;
  slot.innerHTML = `
    <p class="gform-feedback incorrect">✕ Incorrecto. Te ${attemptsLeft === 1 ? 'queda' : 'quedan'} ${attemptsLeft} ${attemptsLeft === 1 ? 'intento' : 'intentos'}.</p>
  `;
}

function applyQuizAnswered(card, ex, answerData, correct) {
  const correctIndex = ex.data?.correctIndex ?? 0;
  const selectedIndex = answerData?.selectedIndex;
  card.querySelectorAll('.pink-option-btn').forEach((label, i) => {
    const radio = label.querySelector('input[type="radio"]');
    if (radio) {
      radio.disabled = true;
      if (i === selectedIndex) radio.checked = true;
    }
    label.classList.add('is-disabled');
    if (i === correctIndex) label.classList.add('is-correct');
    else if (i === selectedIndex && !correct) label.classList.add('is-incorrect');
  });
  const btn = card.querySelector('[data-action="validate-quiz"]');
  if (btn) btn.disabled = true;
  showFeedback(card, correct, correct ? null : ex.data?.options?.[correctIndex]);
}

function applyFillAnswered(card, ex, answerData, correct) {
  const input = card.querySelector('[data-role="fill-input"]');
  if (input) {
    input.value = answerData?.answerText || '';
    input.disabled = true;
  }
  const btn = card.querySelector('[data-action="validate-fill"]');
  if (btn) btn.disabled = true;
  showFeedback(card, correct, correct ? null : ex.data?.correctAnswer);
}

function applyHangmanAnswered(card, ex, answerData, correct) {
  const wordEl = card.querySelector('[data-role="word-slashes"]');
  const word = wordEl.dataset.word;
  const grid = card.querySelector('[data-role="letters-grid"]');
  const guessed = new Set(answerData?.guessedLetters || []);

  grid.querySelectorAll('.letter-btn').forEach((btn) => {
    const letter = btn.dataset.letter;
    btn.disabled = true;
    if (guessed.has(letter)) {
      btn.classList.add(word.includes(letter) ? 'letter-hit' : 'letter-miss');
    }
  });

  wordEl.querySelectorAll('.slash-slot').forEach((slot, i) => {
    if (correct || guessed.has(word[i])) slot.innerHTML = `<strong>${escapeHtml(word[i])}</strong>`;
  });

  const attemptsLeftEl = card.querySelector('[data-role="attempts-left"]');
  if (attemptsLeftEl && answerData?.attemptsLeft !== undefined) attemptsLeftEl.textContent = answerData.attemptsLeft;
  showFeedback(card, correct, correct ? null : word);
}

function applyWordSearchAnswered(card, ex, answerData, correct) {
  const gridEl = card.querySelector('[data-role="sopa-grid"]');
  const words = (gridEl.dataset.words || '').split(',').filter(Boolean);
  const found = answerData?.foundWords || [];

  const foundCountEl = card.querySelector('[data-role="found-count"]');
  if (foundCountEl) foundCountEl.textContent = found.length;
  const attemptsLeftEl = card.querySelector('[data-role="attempts-left"]');
  if (attemptsLeftEl && answerData?.attemptsLeft !== undefined) attemptsLeftEl.textContent = Math.max(answerData.attemptsLeft, 0);
  const timeLeftEl = card.querySelector('[data-role="time-left"]');
  if (timeLeftEl) timeLeftEl.textContent = '—';

  gridEl.querySelectorAll('.sopa-cell').forEach((cell) => { cell.disabled = true; });
  const checkBtn = card.querySelector('[data-action="check-word"]');
  const clearBtn = card.querySelector('[data-action="clear-selection"]');
  if (checkBtn) checkBtn.disabled = true;
  if (clearBtn) clearBtn.disabled = true;
  card.querySelector('[data-role="start-gate"]')?.remove();

  showFeedback(card, correct, correct ? null : words.join(', '));
}

function applyPairsAnswered(card, ex, answerData, correct) {
  const matchedIndices = new Set(answerData?.matchedIndices || []);
  card.querySelectorAll('[data-role="concepto"]').forEach((el) => {
    const idx = Number(el.dataset.pairindex);
    if (matchedIndices.has(idx)) el.classList.add('matched');
    el.disabled = true;
  });
  card.querySelectorAll('[data-role="definicion"]').forEach((el) => {
    const idx = Number(el.dataset.pairindex);
    if (matchedIndices.has(idx)) el.classList.add('matched');
    el.disabled = true;
  });
  showFeedback(card, correct, null);
}

function applyCausalityAnswered(card, ex, answerData, correct) {
  const list = card.querySelector('[data-role="causality-list"]');
  const finalOrder = answerData?.finalOrder;
  if (finalOrder && list) {
    const rows = Array.from(list.children);
    const byOriginal = {};
    rows.forEach((row) => { byOriginal[row.dataset.originalIndex] = row; });
    finalOrder.forEach((origIdx) => {
      const row = byOriginal[origIdx];
      if (row) list.appendChild(row);
    });
  }
  list?.querySelectorAll('.arrow-btn').forEach((b) => { b.disabled = true; });
  const btn = card.querySelector('[data-action="check-order"]');
  if (btn) btn.disabled = true;
  showFeedback(card, correct, null);
}

function applyMemoramaAnswered(card) {
  card.querySelectorAll('.memo-card').forEach((c) => {
    c.classList.add('matched');
    c.textContent = c.dataset.value;
    c.disabled = true;
    c.setAttribute('aria-label', `Pareja encontrada: ${c.dataset.value}`);
  });
  showFeedback(card, true, null);
}

function applyAlreadyAnsweredState(card, ex, existing) {
  card.classList.add('exercise-locked-answered');
  const statusEl = card.querySelector('.top-bar-status');
  if (statusEl) {
    statusEl.textContent = existing.correct ? 'Completado' : 'Revisar';
    statusEl.classList.remove('status-progress');
    statusEl.classList.add(existing.correct ? 'status-correct' : 'status-incorrect');
  }

  const answerData = existing.answerData || {};
  if (ex.type === 'Quizz con Video' || ex.type === 'Quizz conTexto') applyQuizAnswered(card, ex, answerData, existing.correct);
  else if (ex.type === 'Completa la frase') applyFillAnswered(card, ex, answerData, existing.correct);
  else if (ex.type === 'Ahorcado') applyHangmanAnswered(card, ex, answerData, existing.correct);
  else if (ex.type === 'Sopa de letras') applyWordSearchAnswered(card, ex, answerData, existing.correct);
  else if (ex.type === 'Pares') applyPairsAnswered(card, ex, answerData, existing.correct);
  else if (ex.type === 'Causalidad') applyCausalityAnswered(card, ex, answerData, existing.correct);
  else if (ex.type === 'Memorama') applyMemoramaAnswered(card);
}

function wireQuiz(card, ex, onDone) {
  const btn = card.querySelector('[data-action="validate-quiz"]');
  const maxAttempts = ex.data?.maxAttempts ?? 1;
  let attemptsUsed = 0;

  btn.addEventListener('click', () => {
    const checked = card.querySelector(`input[name="quiz-${CSS.escape(ex.id)}"]:checked`);
    if (!checked) { showToast('Selecciona una opción antes de validar.', 'error'); return; }
    const selectedIndex = Number(checked.value);
    const correctIndex = ex.data?.correctIndex ?? 0;
    const isCorrect = selectedIndex === correctIndex;
    attemptsUsed += 1;

    if (isCorrect) {
      card.querySelectorAll('.pink-option-btn').forEach((label, i) => {
        label.classList.add('is-disabled');
        if (i === correctIndex) label.classList.add('is-correct');
      });
      card.querySelectorAll('input[type="radio"]').forEach((r) => { r.disabled = true; });
      btn.disabled = true;
      showFeedback(card, true, null);
      onDone(true, { selectedIndex });
      return;
    }

    if (attemptsUsed < maxAttempts) {
      showRetryFeedback(card, maxAttempts - attemptsUsed);
      card.querySelectorAll('input[type="radio"]').forEach((r) => { r.checked = false; });
      return;
    }

    card.querySelectorAll('.pink-option-btn').forEach((label, i) => {
      label.classList.add('is-disabled');
      if (i === correctIndex) label.classList.add('is-correct');
      else if (i === selectedIndex) label.classList.add('is-incorrect');
    });
    card.querySelectorAll('input[type="radio"]').forEach((r) => { r.disabled = true; });
    btn.disabled = true;
    showFeedback(card, false, ex.data?.options?.[correctIndex]);
    onDone(false, { selectedIndex });
  });
}

function wireFill(card, ex, onDone) {
  const btn = card.querySelector('[data-action="validate-fill"]');
  const input = card.querySelector('[data-role="fill-input"]');
  const maxAttempts = ex.data?.maxAttempts ?? 1;
  let attemptsUsed = 0;

  btn.addEventListener('click', () => {
    const answerText = input.value || '';
    const answer = answerText.trim().toLowerCase();
    const correct = (ex.data?.correctAnswer || '').trim().toLowerCase();
    const isCorrect = answer.length > 0 && answer === correct;
    attemptsUsed += 1;

    if (isCorrect) {
      input.disabled = true;
      btn.disabled = true;
      showFeedback(card, true, null);
      onDone(true, { answerText });
      return;
    }

    if (attemptsUsed < maxAttempts) {
      showRetryFeedback(card, maxAttempts - attemptsUsed);
      return;
    }

    input.disabled = true;
    btn.disabled = true;
    showFeedback(card, false, ex.data?.correctAnswer);
    onDone(false, { answerText });
  });
}

function wireHangman(card, ex, onDone) {
  const wordEl = card.querySelector('[data-role="word-slashes"]');
  const word = wordEl.dataset.word;
  const attemptsLeftEl = card.querySelector('[data-role="attempts-left"]');
  const grid = card.querySelector('[data-role="letters-grid"]');
  let attemptsLeft = Number(grid.dataset.maxAttempts) || 6;
  const revealed = new Set();
  const guessedLetters = [];
  let finished = false;

  grid.querySelectorAll('.letter-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (finished) return;
      const letter = btn.dataset.letter;
      btn.disabled = true;
      guessedLetters.push(letter);

      if (word.includes(letter)) {
        revealed.add(letter);
        btn.classList.add('letter-hit');
        wordEl.querySelectorAll('.slash-slot').forEach((slot, i) => {
          if (word[i] === letter) slot.innerHTML = `<strong>${escapeHtml(letter)}</strong>`;
        });
      } else {
        attemptsLeft -= 1;
        attemptsLeftEl.textContent = attemptsLeft;
        btn.classList.add('letter-miss');
      }

      const won = word.split('').every((l) => revealed.has(l));
      if (won || attemptsLeft <= 0) {
        finished = true;
        grid.querySelectorAll('.letter-btn').forEach((b) => { b.disabled = true; });
        if (!won) {
          wordEl.querySelectorAll('.slash-slot').forEach((slot, i) => {
            slot.innerHTML = `<strong>${escapeHtml(word[i])}</strong>`;
          });
        }
        showFeedback(card, won, word);
        onDone(won, { guessedLetters, attemptsLeft });
      }
    });
  });
}

function wireWordSearch(card, ex, onDone) {
  const gridEl = card.querySelector('[data-role="sopa-grid"]');
  const words = (gridEl.dataset.words || '').split(',').filter(Boolean);
  const foundCountEl = card.querySelector('[data-role="found-count"]');
  const attemptsLeftEl = card.querySelector('[data-role="attempts-left"]');
  const timeLeftEl = card.querySelector('[data-role="time-left"]');
  const cells = Array.from(gridEl.querySelectorAll('.sopa-cell'));
  const checkBtn = card.querySelector('[data-action="check-word"]');
  const clearBtn = card.querySelector('[data-action="clear-selection"]');
  const startGate = card.querySelector('[data-role="start-gate"]');
  const startBtn = card.querySelector('[data-action="start-exercise"]');

  const saved = inProgress[ex.id];
  const timeLimitSeconds = Number(gridEl.dataset.timeLimit) || 300;
  const maxAttempts = Number(gridEl.dataset.maxAttempts) || 1;

  const pending = new Set(words);
  const found = [];
  let attemptsLeft = maxAttempts;
  let startedAt = null;

  if (saved) {
    (saved.foundWords || []).forEach((w) => { pending.delete(w); found.push(w); });
    attemptsLeft = saved.attemptsLeft ?? maxAttempts;
    startedAt = saved.startedAt || null;
  }

  let selected = [];
  let started = !!saved;
  let finished = false;
  let timerId = null;
  cells.forEach((cell) => { cell.disabled = !started; });

  if (foundCountEl) foundCountEl.textContent = found.length;
  if (attemptsLeftEl) attemptsLeftEl.textContent = Math.max(attemptsLeft, 0);

  const stopTimer = () => {
    if (timerId) clearInterval(timerId);
    timerId = null;
  };

  const persistProgress = () => {
    syncInProgress(ex.id, { foundWords: found, attemptsLeft, startedAt, timeLimitSeconds });
  };

  const finish = (won) => {
    if (finished) return;
    finished = true;
    stopTimer();
    cells.forEach((cell) => { cell.disabled = true; });
    checkBtn.disabled = true;
    clearBtn.disabled = true;
    showFeedback(card, won, won ? null : words.join(', '));
    onDone(won, { foundWords: found, attemptsLeft });
  };

  const startTimer = (secondsLeft) => {
    if (timeLeftEl) timeLeftEl.textContent = formatTime(Math.max(secondsLeft, 0));
    if (secondsLeft <= 0) { finish(false); return; }
    let remaining = secondsLeft;
    timerId = setInterval(() => {
      remaining -= 1;
      if (timeLeftEl) timeLeftEl.textContent = formatTime(Math.max(remaining, 0));
      if (remaining <= 0) finish(false);
    }, 1000);
  };

  const beginPlay = () => {
    startGate?.remove();
    if (pending.size === 0) { finish(true); return; }
    const elapsed = Math.floor((Date.now() - startedAt) / 1000);
    startTimer(timeLimitSeconds - elapsed);
  };

  if (started) {
    beginPlay();
  } else {
    startBtn.addEventListener('click', () => {
      if (started) return;
      started = true;
      cells.forEach((cell) => { cell.disabled = false; });
      startedAt = Date.now();
      persistProgress();
      beginPlay();
    });
  }

  cells.forEach((cell) => {
    cell.addEventListener('keydown', (event) => {
      const currentIndex = Number(cell.dataset.cellindex);
      const row = Math.floor(currentIndex / 12);
      const column = currentIndex % 12;
      const nextIndex = event.key === 'ArrowRight' && column < 11 ? currentIndex + 1
        : event.key === 'ArrowLeft' && column > 0 ? currentIndex - 1
          : event.key === 'ArrowDown' && row < 11 ? currentIndex + 12
            : event.key === 'ArrowUp' && row > 0 ? currentIndex - 12
              : -1;
      if (nextIndex < 0 || !cells[nextIndex] || cells[nextIndex].disabled) return;
      event.preventDefault();
      cell.tabIndex = -1;
      cells[nextIndex].tabIndex = 0;
      cells[nextIndex].focus();
    });
    cell.addEventListener('click', () => {
      if (!started || finished) return;
      const i = Number(cell.dataset.cellindex);
      const pos = selected.indexOf(i);
      if (pos >= 0) {
        selected.splice(pos, 1);
        cell.classList.remove('selected');
      } else {
        selected.push(i);
        cell.classList.add('selected');
      }
    });
  });

  clearBtn.addEventListener('click', () => {
    if (!started || finished) return;
    selected.forEach((i) => cells[i].classList.remove('selected'));
    selected = [];
  });

  checkBtn.addEventListener('click', () => {
    if (!started || finished || selected.length === 0) return;
    const letters = selected.map((i) => cells[i].textContent).join('');
    const reversed = letters.split('').reverse().join('');
    const match = [...pending].find((w) => w === letters || w === reversed);

    if (match) {
      selected.forEach((i) => {
        cells[i].classList.remove('selected');
        cells[i].classList.add('found');
      });
      pending.delete(match);
      found.push(match);
      if (foundCountEl) foundCountEl.textContent = words.length - pending.size;
      showFeedback(card, true, null);
    } else {
      attemptsLeft -= 1;
      if (attemptsLeftEl) attemptsLeftEl.textContent = Math.max(attemptsLeft, 0);
      showFeedback(card, false, null);
    }
    selected.forEach((i) => cells[i].classList.remove('selected'));
    selected = [];

    if (pending.size === 0) finish(true);
    else if (attemptsLeft <= 0) finish(false);
    else persistProgress();
  });
}

function wirePairs(card, ex, onDone) {
  const items = ex.data?.items || [];
  const container = card.querySelector('.pairs-container');
  const attemptsLeftEl = card.querySelector('[data-role="attempts-left"]');
  let attemptsLeft = Number(container?.dataset.maxAttempts) || 1;
  const matched = new Set();
  let selectedConcepto = null;
  let finished = false;

  const finish = (won) => {
    if (finished) return;
    finished = true;
    card.querySelectorAll('.pink-card-item').forEach((el) => { el.disabled = true; });
    showFeedback(card, won, null);
    onDone(won, { matchedIndices: [...matched] });
  };

  card.querySelectorAll('[data-role="concepto"]').forEach((el) => {
    el.addEventListener('click', () => {
      if (finished || el.disabled || el.classList.contains('matched')) return;
      card.querySelectorAll('[data-role="concepto"]').forEach((c) => c.classList.remove('selected'));
      el.classList.add('selected');
      selectedConcepto = el;
    });
  });

  card.querySelectorAll('[data-role="definicion"]').forEach((el) => {
    el.addEventListener('click', () => {
      if (finished || el.disabled || el.classList.contains('matched') || !selectedConcepto) return;
      const conceptoIndex = Number(selectedConcepto.dataset.pairindex);
      const defIndex = Number(el.dataset.pairindex);

      if (conceptoIndex === defIndex) {
        selectedConcepto.classList.remove('selected');
        selectedConcepto.classList.add('matched');
        el.classList.add('matched');
        selectedConcepto.disabled = true;
        el.disabled = true;
        matched.add(conceptoIndex);
        selectedConcepto = null;
        if (matched.size === items.length && items.length > 0) finish(true);
      } else {
        el.classList.add('is-incorrect');
        setTimeout(() => el.classList.remove('is-incorrect'), 400);
        selectedConcepto.classList.remove('selected');
        selectedConcepto = null;
        attemptsLeft -= 1;
        if (attemptsLeftEl) attemptsLeftEl.textContent = Math.max(attemptsLeft, 0);
        if (attemptsLeft <= 0) finish(false);
      }
    });
  });
}

function wireCausality(card, ex, onDone) {
  const list = card.querySelector('[data-role="causality-list"]');
  const btn = card.querySelector('[data-action="check-order"]');
  const attemptsLeftEl = card.querySelector('[data-role="attempts-left"]');
  let attemptsLeft = Number(list.dataset.maxAttempts) || 1;
  let finished = false;

  const wireArrows = () => {
    const rows = Array.from(list.children);
    rows.forEach((row, i) => {
      const up = row.querySelector('[data-action="move-up"]');
      const down = row.querySelector('[data-action="move-down"]');
      up.disabled = i === 0 || finished;
      down.disabled = i === rows.length - 1 || finished;
      up.onclick = () => { list.insertBefore(row, rows[i - 1]); wireArrows(); };
      down.onclick = () => { list.insertBefore(rows[i + 1], row); wireArrows(); };
    });
  };
  wireArrows();

  btn.addEventListener('click', () => {
    if (finished) return;
    const order = Array.from(list.children).map((row) => Number(row.dataset.originalIndex));
    const isCorrect = order.every((v, i) => v === i);

    if (isCorrect) {
      finished = true;
      btn.disabled = true;
      wireArrows();
      showFeedback(card, true, null);
      onDone(true, { finalOrder: order });
      return;
    }

    attemptsLeft -= 1;
    if (attemptsLeftEl) attemptsLeftEl.textContent = Math.max(attemptsLeft, 0);

    if (attemptsLeft <= 0) {
      finished = true;
      btn.disabled = true;
      wireArrows();
      showFeedback(card, false, null);
      onDone(false, { finalOrder: order });
      return;
    }

    showRetryFeedback(card, attemptsLeft);
  });
}

function wireMemorama(card, ex, onDone) {
  const gridEl = card.querySelector('[data-role="memorama-grid"]');
  const totalPairs = Number(gridEl.dataset.totalPairs) || 0;
  const cards = Array.from(gridEl.querySelectorAll('.memo-card'));
  let flipped = [];
  let matchedPairs = 0;
  let locked = false;

  cards.forEach((c, index) => {
    c.tabIndex = index === 0 ? 0 : -1;
    c.addEventListener('keydown', (event) => {
      const columns = Math.max(1, Math.round(gridEl.clientWidth / (c.getBoundingClientRect().width + 10)));
      const nextByKey = { ArrowRight: index + 1, ArrowLeft: index - 1, ArrowDown: index + columns, ArrowUp: index - columns };
      const nextIndex = nextByKey[event.key];
      if (nextIndex === undefined || nextIndex < 0 || nextIndex >= cards.length) return;
      event.preventDefault();
      c.tabIndex = -1;
      cards[nextIndex].tabIndex = 0;
      cards[nextIndex].focus();
    });
  });

  cards.forEach((c) => {
    c.addEventListener('click', () => {
      if (locked || c.disabled || c.classList.contains('flipped') || c.classList.contains('matched')) return;
      c.classList.add('flipped');
      c.textContent = c.dataset.value;
      c.setAttribute('aria-label', `Carta revelada: ${c.dataset.value}`);
      flipped.push(c);

      if (flipped.length === 2) {
        locked = true;
        const [a, b] = flipped;
        if (a.dataset.pairid === b.dataset.pairid) {
          a.classList.add('matched');
          b.classList.add('matched');
          a.disabled = true;
          b.disabled = true;
          a.setAttribute('aria-label', `Pareja encontrada: ${a.dataset.value}`);
          b.setAttribute('aria-label', `Pareja encontrada: ${b.dataset.value}`);
          matchedPairs += 1;
          flipped = [];
          locked = false;
          if (matchedPairs === totalPairs) onDone(true, {});
        } else {
          setTimeout(() => {
            a.classList.remove('flipped');
            b.classList.remove('flipped');
            a.textContent = '?';
            b.textContent = '?';
            a.setAttribute('aria-label', 'Carta oculta');
            b.setAttribute('aria-label', 'Carta oculta');
            flipped = [];
            locked = false;
          }, 700);
        }
      }
    });
  });
}

function wireExercise(container, ex) {
  if (isFileCardType(ex.type) || ex.type === SEPARATOR_TYPE || ex.type === 'Texto') return;

  const card = container.querySelector(`[data-exercise-id="${ex.id}"]`);
  if (!card) return;

  const existing = progress[ex.id];
  if (existing && existing.done) {
    applyAlreadyAnsweredState(card, ex, existing);
    return;
  }

  const onDone = (correct, answerData) => markProgress(container, ex.id, correct, answerData);

  if (ex.type === 'Quizz con Video' || ex.type === 'Quizz conTexto') wireQuiz(card, ex, onDone);
  else if (ex.type === 'Completa la frase') wireFill(card, ex, onDone);
  else if (ex.type === 'Ahorcado') wireHangman(card, ex, onDone);
  else if (ex.type === 'Sopa de letras') wireWordSearch(card, ex, onDone);
  else if (ex.type === 'Pares') wirePairs(card, ex, onDone);
  else if (ex.type === 'Causalidad') wireCausality(card, ex, onDone);
  else if (ex.type === 'Memorama') wireMemorama(card, ex, onDone);
}

export function courseView(session = {}) {
  document.body.innerHTML = `
    <div class="screen-shell">
      <nav class="topbar">
        <div class="topbar-user">
          <span class="topbar-pill">${escapeHtml(session.user || 'Usuario')}</span>
          <span class="topbar-role">${escapeHtml(session.role || 'usuario')}</span>
          <span class="topbar-id">ID: ${escapeHtml(session.codigoUsuario || 'N/A')}</span>
        </div>
        <div class="topbar-actions">
          <button id="openCourseMenu" class="btn ghost" type="button" aria-expanded="false" aria-controls="courseSidebar">Contenido</button>
          <button id="manualBtn" class="btn ghost" type="button">Manual</button>
          <button id="supportBtn" class="btn ghost" type="button">Soporte</button>
          ${session.role === 'admin' ? '<button id="dashboardBtn" class="btn primary" type="button">Dashboard</button>' : ''}
          <button id="logoutBtn" class="btn ghost" type="button">Cerrar sesión</button>
        </div>
      </nav>
      <div class="course-body">
        <div id="courseSidebarBackdrop" class="course-sidebar-backdrop" aria-hidden="true"></div>
        <nav id="courseSidebar" class="course-sidebar" aria-label="Contenido del curso">
          <div class="course-sidebar-mobile-heading">
            <h4 class="sidebar-heading">Contenido del curso</h4>
            <button id="closeCourseMenu" class="btn ghost" type="button">Cerrar</button>
          </div>
          <div id="sidebarList" class="sidebar-list">
            <p class="empty-state">Cargando...</p>
          </div>
        </nav>
        <main class="course-view">
          <div class="course-progress">
            <span>Progreso</span>
            <progress class="course-progress-bar-fill" max="100" value="0" aria-label="Progreso del curso"></progress>
            <span class="course-progress-label">0%</span>
          </div>
          <div class="course-grade-badge">Calificación actual: <strong class="course-grade-value">--</strong></div>
          <div id="courseContainer" class="course-empty"></div>
        </main>
      </div>
    </div>
  `;

  document.getElementById('manualBtn')?.addEventListener('click', openUserManual);
  const courseSidebar = document.getElementById('courseSidebar');
  const sidebarBackdrop = document.getElementById('courseSidebarBackdrop');
  const openCourseMenu = document.getElementById('openCourseMenu');
  const closeCourseMenu = document.getElementById('closeCourseMenu');
  const topbar = document.querySelector('.topbar');
  const courseMain = document.querySelector('.course-view');
  const setCourseMenuOpen = (open) => {
    courseSidebar?.classList.toggle('open', open);
    sidebarBackdrop?.classList.toggle('active', open);
    if (topbar instanceof HTMLElement) topbar.inert = open;
    if (courseMain instanceof HTMLElement) courseMain.inert = open;
    openCourseMenu?.setAttribute('aria-expanded', String(open));
    if (courseSidebar instanceof HTMLElement) {
      if (open) {
        courseSidebar.setAttribute('role', 'dialog');
        courseSidebar.setAttribute('aria-modal', 'true');
        closeCourseMenu?.focus();
      } else {
        courseSidebar.removeAttribute('role');
        courseSidebar.removeAttribute('aria-modal');
        openCourseMenu?.focus();
      }
    }
  };
  openCourseMenu?.addEventListener('click', () => setCourseMenuOpen(true));
  closeCourseMenu?.addEventListener('click', () => setCourseMenuOpen(false));
  sidebarBackdrop?.addEventListener('click', () => setCourseMenuOpen(false));
  courseSidebar?.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      setCourseMenuOpen(false);
      return;
    }
    if (event.key !== 'Tab' || !(courseSidebar instanceof HTMLElement)) return;
    const focusable = Array.from(courseSidebar.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled)'))
      .filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  document.getElementById('sidebarList')?.addEventListener('click', (event) => {
    if ((event.target as Element | null)?.closest('.sidebar-item')) setCourseMenuOpen(false);
  });

  const renderExercises = (exercises = []) => {
    const container = document.getElementById('courseContainer');
    if (!container) return;

    currentExercises = exercises;

    if (exercises.length === 0) {
      container.innerHTML = '<p class="empty-state">No hay ejercicios disponibles creados desde el Dashboard.</p>';
      renderSidebar(exercises);
      return;
    }

    container.className = '';
    container.innerHTML = exercises
      .map((ex) => {
        if (ex.type === SEPARATOR_TYPE) return renderSeparator(ex);
        if (isFileCardType(ex.type)) return renderFileCard(ex);
        if (ex.type === 'Texto') return renderTextCard(ex);
        return renderExerciseCard(ex);
      })
      .join('');
    exercises.forEach((ex) => wireExercise(container, ex));
    renderSidebar(exercises);
  };

  const loadExercisesFromServer = async () => {
    const container = document.getElementById('courseContainer');
    if (container) container.innerHTML = '<p class="empty-state">Cargando ejercicios...</p>';
    try {
      const res = await fetch('/api/exercises');
      if (!res.ok) {
        let reason = `Error ${res.status}`;
        try {
          const data = await res.json();
          if (data.message) reason = data.message;
        } catch {
          reason = `Error ${res.status}`;
        }

        if (container) {
          container.innerHTML = `
            <div class="load-error-state">
              <p>No se pudieron cargar los ejercicios (${reason}).</p>
              <button type="button" class="btn primary" id="retryLoadExercises">Reintentar</button>
            </div>
          `;
          document.getElementById('retryLoadExercises')?.addEventListener('click', loadInitialData);
        }
        showToast(`No se pudieron cargar los ejercicios: ${reason}`, 'error');
        return;
      }
      const data = await res.json();
      renderExercises(data.exercises || []);
    } catch (err) {
      if (container) {
        container.innerHTML = `
          <div class="load-error-state">
            <p>No se pudo conectar con el servidor.</p>
            <button type="button" class="btn primary" id="retryLoadExercises">Reintentar</button>
          </div>
        `;
        document.getElementById('retryLoadExercises')?.addEventListener('click', loadInitialData);
      }
      showToast('No se pudo conectar con el servidor para cargar los ejercicios.', 'error');
    }
  };

  const loadMyProgress = async () => {
    try {
      const res = await fetch('/api/my-progress');
      if (!res.ok) return null;
      const data = await res.json();
      (data.items || []).forEach((item) => {
        if (item.completed) {
          progress[item.exerciseId] = { done: true, correct: item.correct, answerData: item.answerData || {} };
        } else {
          inProgress[item.exerciseId] = item.answerData || {};
        }
      });
      return data;
    } catch {
      return null;
    }
  };

  const loadInitialData = async () => {
    for (const key in progress) delete progress[key];
    for (const key in inProgress) delete inProgress[key];
    const myProgress = await loadMyProgress();
    await loadExercisesFromServer();
    if (myProgress) updateProgressUI(myProgress.progreso || 0, myProgress.calificacion || 0);
  };

  const refreshLiveStatus = async () => {
    try {
      const [meRes, progressRes] = await Promise.all([
        fetch('/api/me'),
        fetch('/api/my-progress')
      ]);

      if (meRes.ok) {
        const me = await meRes.json();
        const pillEl = document.querySelector('.topbar-pill');
        const roleEl = document.querySelector('.topbar-role');
        const idEl = document.querySelector('.topbar-id');
        if (pillEl) pillEl.textContent = me.user;
        if (roleEl) roleEl.textContent = me.role;
        if (idEl) idEl.textContent = `ID: ${me.codigoUsuario || 'N/A'}`;

        const updatedSession = { user: me.user, role: me.role, id: me.id, codigoUsuario: me.codigoUsuario, progreso: me.progreso, calificacion: me.calificacion };

        const actions = document.querySelector('.topbar-actions');
        let dashboardBtn = document.getElementById('dashboardBtn');
        if (me.role === 'admin' && !dashboardBtn && actions) {
          dashboardBtn = document.createElement('button');
          dashboardBtn.id = 'dashboardBtn';
          dashboardBtn.className = 'btn primary';
          dashboardBtn.type = 'button';
          dashboardBtn.textContent = 'Dashboard';
          actions.insertBefore(dashboardBtn, actions.querySelector('#logoutBtn'));
          dashboardBtn.addEventListener('click', () => dashboardView(updatedSession));
        } else if (me.role !== 'admin' && dashboardBtn) {
          dashboardBtn.remove();
        }
      }

      if (progressRes.ok) {
        const data = await progressRes.json();
        updateProgressUI(data.progreso || 0, data.calificacion || 0);
      }
    } catch {
    }
  };

  window.addEventListener('exerciseUpdated', (e) => {
    renderExercises(e.detail);
    refreshLiveStatus();
  });

  document.getElementById('supportBtn').addEventListener('click', () => showSupportModal());

  document.getElementById('logoutBtn').addEventListener('click', async () => {
    const button = document.getElementById('logoutBtn');
    button.disabled = true;
    try {
      const response = await fetch('/api/logout', { method: 'POST', credentials: 'same-origin', cache: 'no-store' });
      if (!response.ok) console.warn(`No se pudo cerrar la sesión en el servidor (HTTP ${response.status}). Se limpiará la sesión local.`);
    } catch (error) {
      console.warn('No se pudo contactar al servidor para cerrar la sesión. Se limpiará la sesión local.', error);
    } finally {
      document.cookie = 'session=; Path=/; Max-Age=0; SameSite=Strict';
      location.replace('/');
    }
  });

  if (session.role === 'admin') {
    document.getElementById('dashboardBtn').addEventListener('click', () => dashboardView(session));
  }

  loadInitialData();
  setInterval(refreshLiveStatus, 12000);
}

