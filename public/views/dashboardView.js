import { showToast, showConfirm, showPrompt, SEPARATOR_TYPE, generateWordSearchGrid } from '../main.js';

const GRADABLE_TYPES = [
  'Quizz conTexto',
  'Quizz con Video',
  'Memorama',
  'Pares',
  'Causalidad',
  'Ahorcado',
  'Completa la frase',
  'Sopa de letras'
];

const OTHER_TYPES = [
  'Texto',
  'Imagen',
  'Documento',
  'Presentación'
];

const EXERCISE_TYPES = [...GRADABLE_TYPES, ...OTHER_TYPES];

const FILE_TYPE_ACCEPT = {
  Imagen: 'image/*',
  Documento: '.pdf,.doc,.docx,.xls,.xlsx',
  Presentación: '.ppt,.pptx'
};

const getDefaultData = (type) => {
  switch (type) {
    case 'Quizz con Video':
      return { videoUrl: '', question: '', options: ['', '', ''], correctIndex: 0, maxAttempts: 1 };
    case 'Quizz conTexto':
      return { question: '', options: ['', '', ''], correctIndex: 0, maxAttempts: 1 };
    case 'Completa la frase':
      return { sentence: '', correctAnswer: '', maxAttempts: 1 };
    case 'Ahorcado':
      return { palabraSecreta: '', pista: '', maxIntentos: 6 };
    case 'Sopa de letras':
      return { palabrasOcultas: ['', '', ''], grid: '', maxAttempts: 1, timeLimitMinutes: 5 };
    case 'Pares':
      return { items: [{ concepto: '', definicion: '' }, { concepto: '', definicion: '' }], maxAttempts: 1 };
    case 'Causalidad':
      return { pregunta: '', pasos: ['', ''], maxAttempts: 1 };
    case 'Memorama':
      return { cartas: ['', '', ''] };
    case 'Imagen':
    case 'Documento':
    case 'Presentación':
      return { fileUrl: '', fileName: '', mimeType: '' };
    case 'Texto':
      return { content: '' };
    default:
      return {};
  }
};

const makeExercise = (type, index = 1) => ({
  id: `${type}-${index}-${Date.now()}`,
  type,
  title: `${type} ${index}`,
  prompt: '',
  points: OTHER_TYPES.includes(type) ? 0 : 1,
  isNew: true,
  data: getDefaultData(type)
});

let exerciseBank = [];
let allUsers = [];
let selectedTypeForForm = null;
let orderModeActive = false;

async function fetchExercisesFromServer() {
  try {
    const res = await fetch('/api/exercises');
    if (!res.ok) return [];
    const data = await res.json();
    return data.exercises || [];
  } catch {
    return [];
  }
}

async function persistExercise(ex) {
  try {
    const res = await fetch('/api/exercise', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(ex)
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'No se pudo guardar el ejercicio en el servidor.', 'error');
      return false;
    }
    showToast('Ejercicio guardado', 'success');
    return true;
  } catch {
    showToast('No se pudo conectar con el servidor para guardar el ejercicio.', 'error');
    return false;
  }
}

async function deleteExerciseOnServer(id) {
  try {
    const res = await fetch(`/api/exercise?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'No se pudo eliminar el ejercicio en el servidor.', 'error');
      return false;
    }
    showToast('Ejercicio eliminado', 'success');
    return true;
  } catch {
    showToast('No se pudo conectar con el servidor para eliminar el ejercicio.', 'error');
    return false;
  }
}

async function uploadFile(file) {
  const dataUrl = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
  const dataBase64 = dataUrl.split(',')[1];

  try {
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fileName: file.name, mimeType: file.type, dataBase64 })
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      showToast(data.message || 'No se pudo subir el archivo.', 'error');
      return null;
    }
    return await res.json();
  } catch {
    showToast('No se pudo conectar con el servidor para subir el archivo.', 'error');
    return null;
  }
}

function renderStringListEditor(idx, listKey, list, placeholder) {
  const rows = (list || []).map((val, i) => `
    <div class="list-row">
      <input type="text" value="${val}" placeholder="${placeholder} ${i + 1}" data-index="${idx}" data-listkey="${listKey}" data-listindex="${i}" class="list-item-input" />
      <button type="button" class="btn danger small remove-list-btn" data-index="${idx}" data-listkey="${listKey}" data-listindex="${i}">✕</button>
    </div>
  `).join('');

  return `
    <div class="list-editor" data-listkey="${listKey}">
      ${rows || '<p class="empty-state">Sin elementos</p>'}
    </div>
    <button type="button" class="btn ghost small add-list-btn" data-index="${idx}" data-listkey="${listKey}">+ Agregar</button>
  `;
}

function renderPointsField(item, idx) {
  return `
    <div class="points-field">
      <label>Vale:</label>
      <input type="number" min="0" step="1" value="${item.points ?? 1}" data-index="${idx}" data-field="points" />
      <span style="font-size:0.72rem;color:var(--primary-dark);font-weight:700;">pts</span>
    </div>
  `;
}

function renderAttemptsField(item, idx) {
  return `
    <div class="field-group">
      <label>Intentos permitidos:</label>
      <input type="number" min="1" max="20" value="${item.data?.maxAttempts ?? 1}" data-index="${idx}" data-field="maxAttempts" />
    </div>
  `;
}

function renderTypeFields(item, idx) {
  if (item.type === 'Quizz con Video' || item.type === 'Quizz conTexto') {
    const options = item.data?.options || [];
    const correctIndex = item.data?.correctIndex ?? 0;
    const optionsHtml = options.map((opt, optIdx) => `
      <div class="option-row">
        <label class="correct-marker">
          <input type="radio" name="correct-${idx}" value="${optIdx}" ${optIdx === correctIndex ? 'checked' : ''} />
          Correcta
        </label>
        <input type="text" value="${opt}" placeholder="Inciso ${optIdx + 1}" data-index="${idx}" data-optindex="${optIdx}" class="exercise-opt-input" />
        <button type="button" class="btn danger small remove-opt-btn" data-index="${idx}" data-optindex="${optIdx}">✕</button>
      </div>
    `).join('');

    return `
      <div class="type-specific-fields">
        ${item.type === 'Quizz con Video' ? `
          <div class="field-group">
            <label>URL de YouTube:</label>
            <input type="text" value="${item.data?.videoUrl || ''}" placeholder="https://www.youtube.com/watch?v=..." data-index="${idx}" data-field="videoUrl" />
          </div>
        ` : ''}
        <div class="field-group">
          <label>Pregunta:</label>
          <input type="text" value="${item.data?.question || ''}" placeholder="Escribe la pregunta..." data-index="${idx}" data-field="question" />
        </div>
        <div class="field-group">
          <div class="options-header">
            <label>Incisos (${options.length}):</label>
            <button type="button" class="btn primary small add-opt-btn" data-index="${idx}">+ Agregar inciso</button>
          </div>
          <p class="list-hint">Marca "Correcta" junto al inciso que el alumno debe elegir.</p>
          <div class="options-list">
            ${optionsHtml || '<p class="empty-state">Sin incisos</p>'}
          </div>
        </div>
        ${renderAttemptsField(item, idx)}
      </div>
    `;
  }

  if (item.type === 'Completa la frase') {
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Frase con hueco (usa ___ para el espacio):</label>
          <input type="text" value="${item.data?.sentence || ''}" placeholder="Ej: El agua es ___" data-index="${idx}" data-field="sentence" />
        </div>
        <div class="field-group">
          <label>Respuesta correcta:</label>
          <input type="text" value="${item.data?.correctAnswer || ''}" placeholder="Ej: transparente" data-index="${idx}" data-field="correctAnswer" />
        </div>
        ${renderAttemptsField(item, idx)}
      </div>
    `;
  }

  if (item.type === 'Ahorcado') {
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Palabra secreta:</label>
          <input type="text" value="${item.data?.palabraSecreta || ''}" placeholder="Ej: ORATORIA" data-index="${idx}" data-field="palabraSecreta" />
        </div>
        <div class="field-group">
          <label>Pista:</label>
          <input type="text" value="${item.data?.pista || ''}" placeholder="Pista para el alumno" data-index="${idx}" data-field="pista" />
        </div>
        <div class="field-group">
          <label>Intentos permitidos:</label>
          <input type="number" min="1" max="12" value="${item.data?.maxIntentos ?? 6}" data-index="${idx}" data-field="maxIntentos" />
        </div>
      </div>
    `;
  }

  if (item.type === 'Sopa de letras') {
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Palabras ocultas:</label>
          <p class="list-hint">La sopa de letras se genera automáticamente al guardar.</p>
          ${renderStringListEditor(idx, 'palabrasOcultas', item.data?.palabrasOcultas, 'Palabra')}
        </div>
        ${renderAttemptsField(item, idx)}
        <div class="field-group">
          <label>Tiempo límite (minutos):</label>
          <input type="number" min="1" max="60" value="${item.data?.timeLimitMinutes ?? 5}" data-index="${idx}" data-field="timeLimitMinutes" />
        </div>
      </div>
    `;
  }

  if (item.type === 'Pares') {
    const items = item.data?.items || [];
    const rows = items.map((pair, i) => `
      <div class="pair-row">
        <input type="text" value="${pair.concepto || ''}" placeholder="Concepto" data-index="${idx}" data-listkey="items" data-listindex="${i}" data-subfield="concepto" class="list-item-input" />
        <input type="text" value="${pair.definicion || ''}" placeholder="Definición correspondiente" data-index="${idx}" data-listkey="items" data-listindex="${i}" data-subfield="definicion" class="list-item-input" />
        <button type="button" class="btn danger small remove-pair-btn" data-index="${idx}" data-listindex="${i}">✕</button>
      </div>
    `).join('');

    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Pares concepto → definición correcta:</label>
          <div class="list-editor">
            ${rows || '<p class="empty-state">Sin pares</p>'}
          </div>
          <button type="button" class="btn ghost small add-pair-btn" data-index="${idx}">+ Agregar par</button>
        </div>
        ${renderAttemptsField(item, idx)}
      </div>
    `;
  }

  if (item.type === 'Causalidad') {
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Pregunta / instrucción:</label>
          <input type="text" value="${item.data?.pregunta || ''}" placeholder="Ej: Ordena la secuencia" data-index="${idx}" data-field="pregunta" />
        </div>
        <div class="field-group">
          <label>Pasos en el orden correcto:</label>
          <p class="list-hint">El orden en que aparecen aquí es el orden correcto que deberá reconstruir el alumno.</p>
          ${renderStringListEditor(idx, 'pasos', item.data?.pasos, 'Paso')}
        </div>
        ${renderAttemptsField(item, idx)}
      </div>
    `;
  }

  if (item.type === 'Memorama') {
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Conceptos a emparejar:</label>
          <p class="list-hint">Cada concepto se duplicará automáticamente para formar las parejas del memorama.</p>
          ${renderStringListEditor(idx, 'cartas', item.data?.cartas, 'Concepto')}
        </div>
      </div>
    `;
  }

  if (item.type === 'Imagen' || item.type === 'Documento' || item.type === 'Presentación') {
    const fileName = item.data?.fileName || '';
    const labelByType = {
      Imagen: 'Imagen (JPG, PNG, GIF, WEBP):',
      Documento: 'Documento (PDF, Word o Excel):',
      Presentación: 'Presentación (PowerPoint):'
    };
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>${labelByType[item.type]}</label>
          <input type="file" accept="${FILE_TYPE_ACCEPT[item.type]}" data-index="${idx}" class="file-upload-input" />
          <p class="list-hint" data-role="file-status">${fileName ? `Archivo actual: ${fileName}` : 'Sin archivo seleccionado todavía.'}</p>
        </div>
      </div>
    `;
  }

  if (item.type === 'Texto') {
    return `
      <div class="type-specific-fields">
        <div class="field-group">
          <label>Contenido:</label>
          <textarea class="prompt-textarea" data-index="${idx}" data-field="content" placeholder="Escribe el texto que verá el alumno...">${item.data?.content || ''}</textarea>
        </div>
      </div>
    `;
  }

  return '';
}

function renderExerciseForm(type) {
  const panel = document.getElementById('panelContent');

  const filteredIndexes = exerciseBank
    .map((item, idx) => item.type === type ? idx : null)
    .filter(idx => idx !== null);

  const list = filteredIndexes.map((idx) => {
    const item = exerciseBank[idx];
    const isUnpublished = item.isNew === true;
    return `
      <div class="exercise-card ${isUnpublished ? 'exercise-card-unpublished' : ''}" data-index="${idx}">
        <div class="exercise-header">
          <strong>${item.type}</strong>
          ${isUnpublished ? '<span class="unpublished-badge">Sin publicar</span>' : ''}
          ${renderPointsField(item, idx)}
        </div>
        <div class="field-group">
          <label>Título:</label>
          <input type="text" value="${item.title}" data-index="${idx}" data-field="title" />
        </div>
        <div class="field-group">
          <label>Instrucciones:</label>
          <textarea class="prompt-textarea" data-index="${idx}" data-field="prompt" placeholder="Escribe las instrucciones aquí...">${item.prompt}</textarea>
        </div>

        ${renderTypeFields(item, idx)}

        <div class="exercise-actions">
          <button type="button" class="btn primary save-exercise" data-index="${idx}">${isUnpublished ? 'Publicar' : 'Guardar'}</button>
          <button type="button" class="btn danger delete-exercise" data-index="${idx}">Eliminar</button>
        </div>
      </div>
    `;
  }).join('');

  panel.innerHTML = `
    <div class="panel-toolbar">
      <button id="backToGridBtn" class="btn ghost" type="button">← Volver a tipos de ejercicio</button>
      <button id="addExerciseBtn" class="btn primary" type="button">+ Crear ${type}</button>
    </div>
    <h3 class="panel-section-title">Gestión de: ${type}</h3>
    <div class="exercise-list">${list || '<p class="empty-state">No hay ejercicios creados de este tipo. Haz clic en "+ Crear" para agregar uno.</p>'}</div>
  `;

  document.getElementById('backToGridBtn').addEventListener('click', () => {
    selectedTypeForForm = null;
    renderCoursePanel();
  });

  document.getElementById('addExerciseBtn').addEventListener('click', () => {
    const count = exerciseBank.filter(e => e.type === type).length + 1;
    const newExercise = makeExercise(type, count);
    exerciseBank.push(newExercise);
    renderExerciseForm(type);
    showToast('Ejercicio creado localmente. Dale clic en "Publicar" para que los alumnos lo vean.', 'info');
  });

  function syncOptionsFromDOM(card, idx) {
  const inputs = card.querySelectorAll('.exercise-opt-input');
  if (inputs.length) exerciseBank[idx].data.options = Array.from(inputs).map((input) => input.value);
}

function syncStringListFromDOM(card, idx, listKey) {
  const inputs = card.querySelectorAll(`input[data-listkey="${listKey}"]`);
  if (inputs.length) exerciseBank[idx].data[listKey] = Array.from(inputs).map((input) => input.value);
}

function syncPairsFromDOM(card, idx) {
  const conceptoInputs = card.querySelectorAll('[data-subfield="concepto"]');
  const definicionInputs = card.querySelectorAll('[data-subfield="definicion"]');
  if (conceptoInputs.length) {
    exerciseBank[idx].data.items = Array.from(conceptoInputs).map((input, i) => ({
      concepto: input.value,
      definicion: definicionInputs[i]?.value || ''
    }));
  }
}

function syncCommonFieldsFromDOM(card, idx) {
  const titleInput = card.querySelector('[data-field="title"]');
  const promptInput = card.querySelector('[data-field="prompt"]');
  const pointsInput = card.querySelector('[data-field="points"]');
  if (titleInput) exerciseBank[idx].title = titleInput.value;
  if (promptInput) exerciseBank[idx].prompt = promptInput.value;
  if (pointsInput) {
    const points = Number(pointsInput.value);
    if (!Number.isNaN(points)) exerciseBank[idx].points = points;
  }
}

document.querySelectorAll('.add-opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const card = btn.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      syncOptionsFromDOM(card, idx);
      if (!exerciseBank[idx].data.options) exerciseBank[idx].data.options = [];
      exerciseBank[idx].data.options.push('');
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.remove-opt-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const optIdx = Number(btn.dataset.optindex);
      const card = btn.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      syncOptionsFromDOM(card, idx);
      exerciseBank[idx].data.options.splice(optIdx, 1);
      if (exerciseBank[idx].data.correctIndex >= exerciseBank[idx].data.options.length) {
        exerciseBank[idx].data.correctIndex = 0;
      }
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.file-upload-input').forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      if (!file) return;
      const statusEl = input.closest('.field-group')?.querySelector('[data-role="file-status"]');
      if (statusEl) statusEl.textContent = 'Subiendo...';

      const idx = Number(input.dataset.index);
      const result = await uploadFile(file);
      if (!result) {
        if (statusEl) statusEl.textContent = 'No se pudo subir el archivo.';
        return;
      }

      const card = input.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      exerciseBank[idx].data.fileUrl = result.url;
      exerciseBank[idx].data.fileName = result.fileName;
      exerciseBank[idx].data.mimeType = result.mimeType;
      showToast('Archivo subido. No olvides publicarlo/guardarlo para confirmarlo.', 'success');
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.add-list-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const key = btn.dataset.listkey;
      const card = btn.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      syncStringListFromDOM(card, idx, key);
      if (!exerciseBank[idx].data[key]) exerciseBank[idx].data[key] = [];
      exerciseBank[idx].data[key].push('');
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.remove-list-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const key = btn.dataset.listkey;
      const listIdx = Number(btn.dataset.listindex);
      const card = btn.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      syncStringListFromDOM(card, idx, key);
      exerciseBank[idx].data[key].splice(listIdx, 1);
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.add-pair-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const card = btn.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      syncPairsFromDOM(card, idx);
      if (!exerciseBank[idx].data.items) exerciseBank[idx].data.items = [];
      exerciseBank[idx].data.items.push({ concepto: '', definicion: '' });
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.remove-pair-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = Number(btn.dataset.index);
      const listIdx = Number(btn.dataset.listindex);
      const card = btn.closest('.exercise-card');
      syncCommonFieldsFromDOM(card, idx);
      syncPairsFromDOM(card, idx);
      exerciseBank[idx].data.items.splice(listIdx, 1);
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.save-exercise').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.index);
      const card = btn.closest('.exercise-card');

      exerciseBank[idx].title = card.querySelector('[data-field="title"]').value || exerciseBank[idx].title;
      exerciseBank[idx].prompt = card.querySelector('[data-field="prompt"]').value || exerciseBank[idx].prompt;
      exerciseBank[idx].points = Number(card.querySelector('[data-field="points"]').value);
      if (Number.isNaN(exerciseBank[idx].points) || exerciseBank[idx].points < 0) exerciseBank[idx].points = 1;

      const attemptsInput = card.querySelector('[data-field="maxAttempts"]');
      if (attemptsInput) {
        const attempts = Number(attemptsInput.value);
        exerciseBank[idx].data.maxAttempts = (!Number.isNaN(attempts) && attempts > 0) ? attempts : 1;
      }

      if (type === 'Quizz con Video' || type === 'Quizz conTexto') {
        if (type === 'Quizz con Video') {
          exerciseBank[idx].data.videoUrl = card.querySelector('[data-field="videoUrl"]')?.value || '';
        }
        exerciseBank[idx].data.question = card.querySelector('[data-field="question"]')?.value || '';
        const optInputs = card.querySelectorAll('.exercise-opt-input');
        exerciseBank[idx].data.options = Array.from(optInputs).map((input) => input.value);
        const correctRadio = card.querySelector(`input[name="correct-${idx}"]:checked`);
        exerciseBank[idx].data.correctIndex = correctRadio ? Number(correctRadio.value) : 0;
      } else if (type === 'Completa la frase') {
        exerciseBank[idx].data.sentence = card.querySelector('[data-field="sentence"]')?.value || '';
        exerciseBank[idx].data.correctAnswer = card.querySelector('[data-field="correctAnswer"]')?.value || '';
      } else if (type === 'Ahorcado') {
        exerciseBank[idx].data.palabraSecreta = (card.querySelector('[data-field="palabraSecreta"]')?.value || '').toUpperCase().trim();
        exerciseBank[idx].data.pista = card.querySelector('[data-field="pista"]')?.value || '';
        exerciseBank[idx].data.maxIntentos = Number(card.querySelector('[data-field="maxIntentos"]')?.value) || 6;
      } else if (type === 'Sopa de letras') {
        const wordInputs = card.querySelectorAll('input[data-listkey="palabrasOcultas"]');
        exerciseBank[idx].data.palabrasOcultas = Array.from(wordInputs)
          .map((input) => input.value.toUpperCase().trim())
          .filter(Boolean);
        exerciseBank[idx].data.grid = generateWordSearchGrid(exerciseBank[idx].data.palabrasOcultas);
        const timeLimitInput = card.querySelector('[data-field="timeLimitMinutes"]');
        const timeLimit = Number(timeLimitInput?.value);
        exerciseBank[idx].data.timeLimitMinutes = (!Number.isNaN(timeLimit) && timeLimit > 0) ? timeLimit : 5;
      } else if (type === 'Pares') {
        const conceptoInputs = card.querySelectorAll('[data-subfield="concepto"]');
        const definicionInputs = card.querySelectorAll('[data-subfield="definicion"]');
        exerciseBank[idx].data.items = Array.from(conceptoInputs).map((input, i) => ({
          concepto: input.value,
          definicion: definicionInputs[i]?.value || ''
        }));
      } else if (type === 'Causalidad') {
        exerciseBank[idx].data.pregunta = card.querySelector('[data-field="pregunta"]')?.value || '';
        const pasoInputs = card.querySelectorAll('input[data-listkey="pasos"]');
        exerciseBank[idx].data.pasos = Array.from(pasoInputs).map((input) => input.value).filter(Boolean);
      } else if (type === 'Memorama') {
        const cartaInputs = card.querySelectorAll('input[data-listkey="cartas"]');
        exerciseBank[idx].data.cartas = Array.from(cartaInputs).map((input) => input.value).filter(Boolean);
      } else if (type === 'Texto') {
        exerciseBank[idx].data.content = card.querySelector('[data-field="content"]')?.value || '';
      }

      const saved = await persistExercise(exerciseBank[idx]);
      if (saved) exerciseBank[idx].isNew = false;
      window.dispatchEvent(new CustomEvent('exerciseUpdated', { detail: exerciseBank }));
      renderExerciseForm(type);
    });
  });

  document.querySelectorAll('.delete-exercise').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.dataset.index);
      const confirmed = await showConfirm(`¿Eliminar el ejercicio "${exerciseBank[idx].title}"? Esta acción no se puede deshacer.`, {
        confirmText: 'Eliminar',
        cancelText: 'Cancelar'
      });
      if (!confirmed) return;

      const exId = exerciseBank[idx].id;
      exerciseBank.splice(idx, 1);
      renderExerciseForm(type);
      await deleteExerciseOnServer(exId);
      window.dispatchEvent(new CustomEvent('exerciseUpdated', { detail: exerciseBank }));
    });
  });
}

function renderCoursePanel() {
  if (orderModeActive) {
    renderOrderPanel();
    return;
  }

  if (selectedTypeForForm) {
    renderExerciseForm(selectedTypeForForm);
    return;
  }

  const panel = document.getElementById('panelContent');

  const gradableGridHtml = GRADABLE_TYPES.map((type) => `
    <button type="button" class="exercise-tile-btn" data-type="${type}">
      <span class="tile-title">${type}</span>
    </button>
  `).join('');

  const otherGridHtml = OTHER_TYPES.map((type) => `
    <button type="button" class="exercise-tile-btn exercise-tile-btn-other" data-type="${type}">
      <span class="tile-title">${type}</span>
    </button>
  `).join('');

  panel.innerHTML = `
    <div class="exercise-grid-container">
      <div class="panel-toolbar">
        <button id="orderExercisesBtn" class="btn ghost" type="button">↕ Ordenar ejercicios</button>
      </div>
      <h3 class="panel-section-title">Selecciona un tipo de ejercicio</h3>
      <div class="exercise-type-grid">
        ${gradableGridHtml}
      </div>
      <h3 class="panel-section-title panel-section-title-other">Otros</h3>
      <p class="list-hint">Material de apoyo que no se califica: texto, imágenes, documentos y presentaciones.</p>
      <div class="exercise-type-grid">
        ${otherGridHtml}
      </div>
    </div>
  `;

  document.getElementById('orderExercisesBtn').addEventListener('click', () => {
    orderModeActive = true;
    renderCoursePanel();
  });

  document.querySelectorAll('.exercise-tile-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      selectedTypeForForm = btn.dataset.type;
      renderCoursePanel();
    });
  });
}

function renderOrderPanel() {
  const panel = document.getElementById('panelContent');

  const rows = exerciseBank.map((ex, i) => {
    const isSeparator = ex.type === SEPARATOR_TYPE;
    return `
    <div class="order-row ${isSeparator ? 'is-separator' : ''}" data-index="${i}">
      <span class="drag-handle" title="Mantén presionado y arrastra para reordenar">
        <span></span><span></span><span></span><span></span><span></span><span></span>
      </span>
      <span class="order-type-badge">${isSeparator ? '— Separador —' : ex.type}</span>
      <span class="order-title">${ex.title}</span>
      <div class="arrow-btn-group">
        <button type="button" class="arrow-btn order-up" data-index="${i}" ${i === 0 ? 'disabled' : ''}>▲</button>
        <button type="button" class="arrow-btn order-down" data-index="${i}" ${i === exerciseBank.length - 1 ? 'disabled' : ''}>▼</button>
      </div>
      <button type="button" class="btn danger small order-delete" data-index="${i}" title="Eliminar">✕</button>
    </div>
  `;
  }).join('');

  panel.innerHTML = `
    <div class="panel-toolbar">
      <button id="backToGridBtn" class="btn ghost" type="button">← Volver a tipos de ejercicio</button>
      <button id="addSeparatorBtn" class="btn primary" type="button">+ Agregar separador</button>
    </div>
    <h3 class="panel-section-title">Orden de los ejercicios</h3>
    <p class="list-hint">Arrastra ⋮⋮ para reordenar, o usa las flechas. Los separadores dividen el curso en secciones. Así lo verá el alumno; los cambios se guardan al instante.</p>
    <div class="order-list" id="orderList">
      ${rows || '<p class="empty-state">No hay ejercicios creados todavía.</p>'}
    </div>
  `;

  document.getElementById('backToGridBtn').addEventListener('click', () => {
    orderModeActive = false;
    renderCoursePanel();
  });

  document.getElementById('addSeparatorBtn').addEventListener('click', async () => {
    const name = await showPrompt('Nombre del separador (por ejemplo: "Módulo 2: Comunicación no verbal")');
    if (!name) return;

    const newSeparator = {
      id: `separator-${Date.now()}`,
      type: SEPARATOR_TYPE,
      title: name,
      prompt: '',
      points: 0,
      data: {}
    };
    exerciseBank.push(newSeparator);
    renderOrderPanel();
    await persistExercise(newSeparator);
    window.dispatchEvent(new CustomEvent('exerciseUpdated', { detail: exerciseBank }));
  });

  const persistOrder = async () => {
    const order = exerciseBank.map((ex) => ex.id);
    try {
      const res = await fetch('/api/exercises/reorder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order })
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        showToast(data.message || 'No se pudo guardar el orden.', 'error');
        return;
      }
      showToast('Orden actualizado', 'success');
    } catch {
      showToast('No se pudo conectar con el servidor para guardar el orden.', 'error');
    }
    window.dispatchEvent(new CustomEvent('exerciseUpdated', { detail: exerciseBank }));
  };

  const list = document.getElementById('orderList');
  if (!list) return;
  let dragSrcIndex = null;

  const clearDragMarkers = () => {
    list.querySelectorAll('.order-row').forEach((r) => r.classList.remove('drag-over-top', 'drag-over-bottom'));
  };

  list.querySelectorAll('.order-row').forEach((row) => {
    const handle = row.querySelector('.drag-handle');

    handle.addEventListener('mousedown', () => { row.draggable = true; });
    row.addEventListener('mouseup', () => { row.draggable = false; });

    row.addEventListener('dragstart', (e) => {
      dragSrcIndex = Number(row.dataset.index);
      row.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', String(dragSrcIndex));
    });

    row.addEventListener('dragend', () => {
      row.draggable = false;
      row.classList.remove('dragging');
      clearDragMarkers();
    });

    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragSrcIndex === null) return;
      const rect = row.getBoundingClientRect();
      const isAfter = (e.clientY - rect.top) > rect.height / 2;
      row.classList.toggle('drag-over-bottom', isAfter);
      row.classList.toggle('drag-over-top', !isAfter);
    });

    row.addEventListener('dragleave', () => {
      row.classList.remove('drag-over-top', 'drag-over-bottom');
    });

    row.addEventListener('drop', async (e) => {
      e.preventDefault();
      const targetIndex = Number(row.dataset.index);
      clearDragMarkers();
      if (dragSrcIndex === null || dragSrcIndex === targetIndex) { dragSrcIndex = null; return; }

      const rect = row.getBoundingClientRect();
      const isAfter = (e.clientY - rect.top) > rect.height / 2;
      let insertIndex = isAfter ? targetIndex + 1 : targetIndex;

      const [moved] = exerciseBank.splice(dragSrcIndex, 1);
      if (dragSrcIndex < insertIndex) insertIndex -= 1;
      exerciseBank.splice(insertIndex, 0, moved);

      dragSrcIndex = null;
      renderOrderPanel();
      await persistOrder();
    });
  });

  panel.querySelectorAll('.order-up').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      if (i <= 0) return;
      [exerciseBank[i - 1], exerciseBank[i]] = [exerciseBank[i], exerciseBank[i - 1]];
      renderOrderPanel();
      await persistOrder();
    });
  });

  panel.querySelectorAll('.order-down').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      if (i >= exerciseBank.length - 1) return;
      [exerciseBank[i + 1], exerciseBank[i]] = [exerciseBank[i], exerciseBank[i + 1]];
      renderOrderPanel();
      await persistOrder();
    });
  });

  panel.querySelectorAll('.order-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const i = Number(btn.dataset.index);
      const item = exerciseBank[i];
      const isSeparator = item.type === SEPARATOR_TYPE;
      const confirmed = await showConfirm(
        isSeparator
          ? `¿Eliminar el separador "${item.title}"?`
          : `¿Eliminar el ejercicio "${item.title}"? Esta acción no se puede deshacer.`,
        { confirmText: 'Eliminar', cancelText: 'Cancelar' }
      );
      if (!confirmed) return;

      const exId = item.id;
      exerciseBank.splice(i, 1);
      renderOrderPanel();
      await deleteExerciseOnServer(exId);
      window.dispatchEvent(new CustomEvent('exerciseUpdated', { detail: exerciseBank }));
    });
  });
}

function renderUserRows(users) {
  const tbody = document.getElementById('userTableBody');
  if (!tbody) return;

  if (users.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" class="empty-state">No se encontraron usuarios.</td></tr>`;
    return;
  }

  tbody.innerHTML = users.map((user) => `
    <tr data-id="${user.id}">
      <td><input type="text" value="${user.user}" data-field="user"></td>
      <td>
        <div class="password-wrap">
          <input type="password" value="" placeholder="Dejar vacío para conservar" data-field="pass" class="pass-input" autocomplete="new-password">
        </div>
      </td>
      <td><input type="number" value="${user.progreso}" data-field="progreso" readonly title="Se calcula automáticamente según lo que responde el alumno"></td>
      <td><div class="grade-wrap"><input type="number" value="${user.calificacion}" data-field="calificacion" readonly title="Se calcula automáticamente según lo que responde el alumno"><span class="grade-suffix">/100</span></div></td>
      <td>
        <select data-field="rol" class="select-custom">
          <option value="admin" ${user.rol === 'admin' ? 'selected' : ''}>admin</option>
          <option value="usuario" ${user.rol === 'usuario' ? 'selected' : ''}>usuario</option>
        </select>
      </td>
      <td><input type="number" value="${user.id}" data-field="id" readonly></td>
      <td>
        <div class="action-buttons">
          <button type="button" class="btn primary save-user">Guardar</button>
          <button type="button" class="btn danger delete-user">Eliminar</button>
        </div>
      </td>
    </tr>
  `).join('');

  tbody.querySelectorAll('.save-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const payload = {
        id: Number(row.querySelector('[data-field="id"]').value || 0),
        user: row.querySelector('[data-field="user"]').value,
        pass: row.querySelector('[data-field="pass"]').value,
        rol: row.querySelector('[data-field="rol"]').value,
      };

      const res = await fetch('/api/user', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || 'Error al guardar el usuario.', 'error');
        return;
      }
      showToast('Usuario actualizado', 'success');
      loadUsers();
    });
  });

  tbody.querySelectorAll('.delete-user').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const row = btn.closest('tr');
      const id = Number(row.querySelector('[data-field="id"]').value);
      const confirmed = await showConfirm(`¿Eliminar al usuario número ${id}? Esta acción no se puede deshacer.`, {
        confirmText: 'Eliminar',
        cancelText: 'Cancelar'
      });
      if (!confirmed) return;

      const res = await fetch(`/api/user?id=${id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        showToast(data.message || 'Error al eliminar el usuario.', 'error');
        return;
      }
      showToast('Usuario eliminado', 'success');
      loadUsers();
    });
  });
}

async function refreshUserProgressColumns() {
  try {
    const res = await fetch('/api/users');
    if (!res.ok) return;
    const data = await res.json();
    const users = data.users || [];
    users.forEach((u) => {
      const row = document.querySelector(`#userTableBody tr[data-id="${u.id}"]`);
      if (!row) return;
      const progresoInput = row.querySelector('[data-field="progreso"]');
      const calificacionInput = row.querySelector('[data-field="calificacion"]');
      if (progresoInput && document.activeElement !== progresoInput) progresoInput.value = u.progreso;
      if (calificacionInput && document.activeElement !== calificacionInput) calificacionInput.value = u.calificacion;
    });
    allUsers = users;
  } catch {
  }
}

function loadUsers() {
  const panel = document.getElementById('panelContent');
  fetch('/api/users')
    .then((res) => res.json())
    .then(({ users = [] }) => {
      allUsers = users;
      panel.innerHTML = `
        <div class="user-controls">
          <input type="number" id="searchUserId" placeholder="Buscar por número..." class="search-input" />
          <button id="showAddUserBtn" type="button" class="btn primary">+ Usuario</button>
        </div>

        <div id="addUserForm" class="add-user-card hidden">
          <h4>Nuevo usuario</h4>
          <div class="add-user-grid">
            <input type="text" id="newUsername" placeholder="Usuario" />
            <input type="password" id="newPass" placeholder="Contraseña" />
            <select id="newRole" class="select-custom">
              <option value="usuario">usuario</option>
              <option value="admin">admin</option>
            </select>
            <button id="createUserBtn" type="button" class="btn primary">Crear</button>
          </div>
        </div>

        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Contraseña</th>
                <th>Progreso <span class="th-auto">(automático)</span></th>
                <th>Calificación (/100) <span class="th-auto">(automático)</span></th>
                <th>Rol</th>
                <th>Número</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody id="userTableBody"></tbody>
          </table>
        </div>
      `;

      renderUserRows(allUsers);

      document.getElementById('searchUserId').addEventListener('input', (e) => {
        const query = e.target.value.trim();
        if (!query) {
          renderUserRows(allUsers);
        } else {
          const filtered = allUsers.filter((u) => String(u.id).includes(query));
          renderUserRows(filtered);
        }
      });

      const addUserForm = document.getElementById('addUserForm');
      document.getElementById('showAddUserBtn').addEventListener('click', () => {
        addUserForm.classList.toggle('hidden');
      });

      document.getElementById('createUserBtn').addEventListener('click', async () => {
        const user = document.getElementById('newUsername').value.trim();
        const pass = document.getElementById('newPass').value.trim();
        const rol = document.getElementById('newRole').value;

        if (!user || !pass) {
          showToast('Ingresa usuario y contraseña.', 'error');
          return;
        }

        const res = await fetch('/api/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ user, pass, rol })
        });

        const data = await res.json();
        if (!res.ok) {
          showToast(data.message || 'Error al crear el usuario.', 'error');
          return;
        }
        showToast('Usuario creado', 'success');
        loadUsers();
      });
    })
    .catch(() => {
      panel.innerHTML = '<p class="empty-state">No autorizado.</p>';
    });
}

export function dashboardView(session = {}) {
  let drawer = document.getElementById('dashboardDrawer');

  if (drawer) {
    drawer.classList.toggle('open');
    document.body.classList.toggle('drawer-open', drawer.classList.contains('open'));
    return;
  }

  drawer = document.createElement('aside');
  drawer.id = 'dashboardDrawer';
  drawer.className = 'dashboard-drawer open';
  document.body.classList.add('drawer-open');

  let panelMode = 'courses';

  drawer.innerHTML = `
    <div class="drawer-resizer" id="drawerResizer"></div>
    <div class="drawer-content">
      <div class="dashboard-header">
        <div>
          <p class="dashboard-kicker">Panel</p>
          <h2>Dashboard</h2>
        </div>
        <button id="closeDashboardBtn" type="button" class="btn ghost">✕</button>
      </div>
      <div class="panel-toolbar">
        <button id="refreshDashboardBtn" type="button" class="btn ghost" title="Actualizar">↻</button>
        <button id="togglePanelBtn" type="button" class="btn primary">
          <span>Gestión de cursos</span>
          <span class="icon-swap">⇆</span>
        </button>
      </div>
      <div id="panelContentContainer" class="panel-flip-container">
        <div id="panelContent"></div>
      </div>
    </div>
  `;

  document.body.appendChild(drawer);

  const resizer = drawer.querySelector('#drawerResizer');
  let isResizing = false;

  resizer.addEventListener('mousedown', (e) => {
    isResizing = true;
    document.body.classList.add('resizing');
    e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (!isResizing) return;
    const newWidth = window.innerWidth - e.clientX;
    if (newWidth >= 340 && newWidth <= window.innerWidth * 0.85) {
      document.documentElement.style.setProperty('--drawer-width', `${newWidth}px`);
    }
  });

  window.addEventListener('mouseup', () => {
    if (isResizing) {
      isResizing = false;
      document.body.classList.remove('resizing');
    }
  });

  const renderPanel = async () => {
    if (panelMode === 'users') {
      document.getElementById('togglePanelBtn').querySelector('span').textContent = 'Gestión de cursos';
      loadUsers();
    } else {
      document.getElementById('togglePanelBtn').querySelector('span').textContent = 'Gestión de usuarios';
      exerciseBank = await fetchExercisesFromServer();
      renderCoursePanel();
    }
  };

  const container = document.getElementById('panelContentContainer');

  document.getElementById('togglePanelBtn').addEventListener('click', () => {
    const toggleButton = document.getElementById('togglePanelBtn');
    if (toggleButton.disabled) return;
    toggleButton.disabled = true;
    container.classList.add('flipping');
    setTimeout(() => {
      panelMode = panelMode === 'users' ? 'courses' : 'users';
      selectedTypeForForm = null;
      orderModeActive = false;
      renderPanel();
      container.classList.remove('flipping');
      container.classList.add('panel-arriving');
      setTimeout(() => {
        container.classList.remove('panel-arriving');
        toggleButton.disabled = false;
      }, 460);
    }, 180);
  });

  document.getElementById('refreshDashboardBtn').addEventListener('click', renderPanel);
  document.getElementById('closeDashboardBtn').addEventListener('click', () => {
    drawer.classList.remove('open');
    document.body.classList.remove('drawer-open');
  });

  renderPanel();

  setInterval(() => {
    if (panelMode === 'users' && drawer.classList.contains('open') && document.getElementById('userTableBody')) {
      refreshUserProgressColumns();
    }
  }, 10000);
}
