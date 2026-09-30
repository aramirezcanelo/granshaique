import { openUserManual } from '../shared/manual';

export function authView() {
  document.body.innerHTML = `
    <div class="app-shell">
      <section class="hero-panel">
        <h1>Tu espacio para empezar.</h1>
      </section>

      <section class="auth-panel">
        <div class="auth-card">
          <p class="eyebrow">Bienvenido</p>
          <h2>Accede</h2>
          <form id="authForm" class="auth-form" action="/api/login" method="post" autocomplete="on">
            <label class="field">
              <span>Usuario</span>
              <input id="authUser" name="username" type="text" placeholder="Tu usuario" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            </label>
            <label class="field">
              <span>Contraseña</span>
              <div class="password-field-wrap">
                <input id="authPassword" name="password" type="password" placeholder="••••••••" autocomplete="current-password" required />
                <button type="button" class="toggle-pass-icon" id="togglePassBtn" aria-label="Mostrar contraseña" title="Mostrar contraseña">
                  <svg class="eye-icon eye-open" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                    <circle cx="12" cy="12" r="3"></circle>
                  </svg>
                  <svg class="eye-icon eye-closed" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M17.94 17.94A10.94 10.94 0 0 1 12 20c-7 0-11-8-11-8a18.6 18.6 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path>
                    <line x1="1" y1="1" x2="23" y2="23"></line>
                  </svg>
                </button>
              </div>
            </label>
            <div class="login-honeypot" aria-hidden="true" inert>
              <label for="websiteField">Deja este campo vacío</label>
              <input id="websiteField" name="website" type="text" tabindex="-1" autocomplete="off" />
            </div>
            <fieldset class="login-challenge">
              <legend>Verificación automática</legend>
              <p id="challengePrompt" class="challenge-prompt" role="status" aria-live="polite">Preparando protección…</p>
              <div class="challenge-answer-row">
                <button class="btn ghost challenge-refresh" type="button" id="refreshChallengeBtn" aria-label="Reintentar verificación" hidden>Reintentar</button>
              </div>
              <span class="challenge-help" id="challengeHelp">Se verifica en este dispositivo; no enviamos datos a un servicio de CAPTCHA.</span>
            </fieldset>
            <div id="authMessage" class="auth-message"></div>
            <button class="btn primary" type="submit">Accede</button>
            <button class="btn ghost" type="button" id="registerBtn" disabled>Consultando inscripciones…</button>
            <p id="registrationStatusMessage" class="registration-status-message" role="status"></p>
          </form>
          <button class="btn ghost manual-link" type="button" id="manualBtn">Manual de uso</button>
        </div>
      </section>
    </div>
  `;

  const form = document.getElementById('authForm');
  const registerBtn = document.getElementById('registerBtn');
  const messageBox = document.getElementById('authMessage');
  const togglePassBtn = document.getElementById('togglePassBtn');
  const userInput = document.getElementById('authUser');
  const passInput = document.getElementById('authPassword');
  const manualBtn = document.getElementById('manualBtn');
  const challengePrompt = document.getElementById('challengePrompt');
  const refreshChallengeBtn = document.getElementById('refreshChallengeBtn');
  const websiteField = document.getElementById('websiteField');
  const registrationStatusMessage = document.getElementById('registrationStatusMessage');
  let challengeLoaded = false;
  let challengeSalt = '';
  let challengeDifficulty = 0;
  let submitting = false;

  const loadRegistrationStatus = async () => {
    registerBtn.disabled = true;
    try {
      const response = await fetch('/api/registration-status', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || typeof data.open !== 'boolean') throw new Error('No se pudo consultar');
      registerBtn.hidden = !data.open;
      registerBtn.textContent = data.open ? '¡Regístrate!' : 'Inscripciones cerradas';
      registrationStatusMessage.textContent = data.open ? '' : 'Las inscripciones están cerradas. Consulta con la administración.';
      registerBtn.disabled = !data.open;
    } catch {
      registerBtn.hidden = true;
      registrationStatusMessage.textContent = 'No se pudo consultar si las inscripciones están abiertas.';
    }
  };

  if (location.protocol !== 'file:') {
    void loadRegistrationStatus();
    window.addEventListener('registrationStatusChanged', () => void loadRegistrationStatus());
    window.setInterval(() => {
      if (!document.hidden) void loadRegistrationStatus();
    }, 5000);
  }
  else {
    registerBtn.hidden = true;
    registrationStatusMessage.textContent = 'Las inscripciones se gestionan desde el servidor.';
  }

  const loadChallenge = async () => {
    challengeLoaded = false;
    challengeSalt = '';
    challengeDifficulty = 0;
    challengePrompt.textContent = 'Preparando protección…';
    refreshChallengeBtn.hidden = true;
    refreshChallengeBtn.disabled = true;
    if (location.protocol === 'file:') {
      challengePrompt.textContent = 'El reto de seguridad está disponible al iniciar el servidor.';
      refreshChallengeBtn.disabled = false;
      return;
    }
    try {
      const response = await fetch('/api/login-challenge', { credentials: 'same-origin', cache: 'no-store' });
      const data = await response.json();
      if (!response.ok || typeof data.prompt !== 'string' || !/^[a-f0-9]{48}$/.test(data.salt) || !Number.isInteger(data.difficulty) || data.difficulty < 12 || data.difficulty > 22) throw new Error('Challenge unavailable');
      challengeSalt = data.salt;
      challengeDifficulty = data.difficulty;
      challengePrompt.textContent = data.prompt;
      challengeLoaded = true;
    } catch {
      challengePrompt.textContent = 'No se pudo preparar la protección. Puedes reintentar la verificación.';
      refreshChallengeBtn.hidden = false;
    } finally {
      refreshChallengeBtn.disabled = false;
    }
  };

  refreshChallengeBtn.addEventListener('click', loadChallenge);
  void loadChallenge();

  manualBtn.addEventListener('click', openUserManual);

  togglePassBtn.addEventListener('click', () => {
    const showing = passInput.type === 'text';
    passInput.type = showing ? 'password' : 'text';
    togglePassBtn.classList.toggle('is-visible', !showing);
    togglePassBtn.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
    togglePassBtn.setAttribute('title', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
  });

  const showMessage = (text, ok = true) => {
    messageBox.textContent = text;
    messageBox.classList.toggle('is-success', ok);
    messageBox.classList.toggle('is-error', !ok);
  };

  const submit = async (mode) => {
    if (location.protocol === 'file:') {
      showMessage('Abre el servidor en http://localhost:8080 para iniciar sesión. El index abierto con doble clic es solo una vista previa.', false);
      return;
    }

    const user = userInput.value.trim();
    const pass = passInput.value;
    if (!user || !pass) {
      showMessage('Completa usuario y contraseña.', false);
      return;
    }
    if (!challengeLoaded) {
      showMessage('Espera a que cargue la verificación de seguridad.', false);
      return;
    }
    if (submitting) return;

    submitting = true;
    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    registerBtn.disabled = true;
    let proofCompleted = false;
    try {
      challengePrompt.textContent = 'Comprobando la solicitud en este dispositivo…';
      const challengeProof = await solveChallengeProof(challengeSalt, challengeDifficulty, (attempts) => {
        challengePrompt.textContent = `Verificación local en curso… ${attempts.toLocaleString()} comprobaciones`;
      });
      proofCompleted = true;
      const res = await fetch(`/api/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ user, pass, challengeProof, website: websiteField.value })
      });

      const data = await res.json();
      if (!res.ok) {
        showMessage(data.message || 'Error.', false);
        await loadChallenge();
        if (mode === 'register') await loadRegistrationStatus();
        return;
      }

      if (mode === 'register') {
        showMessage('Registrada con éxito', true);
        form.reset();
        passInput.autocomplete = 'current-password';
        await loadChallenge();
        return;
      }

      const PasswordCredentialConstructor = window['PasswordCredential'];
      if (PasswordCredentialConstructor && navigator.credentials?.store) {
        try {
          await navigator.credentials.store(new PasswordCredentialConstructor(form));
        } catch {
          // El navegador puede no implementar el guardado de credenciales; autocomplete sigue habilitado.
        }
      }
      location.reload();
    } catch (error) {
      showMessage(!proofCompleted
        ? error instanceof Error ? error.message : 'No se pudo completar la verificación de seguridad.'
        : 'No se pudo conectar con el servidor. Inícialo con "npm start" y abre http://localhost:8080.', false);
      if (!proofCompleted) {
        challengePrompt.textContent = 'No se pudo completar la verificación. Puedes reintentar.';
        refreshChallengeBtn.hidden = false;
      }
    } finally {
      submitting = false;
      submitButton.disabled = false;
      if (mode === 'register') await loadRegistrationStatus();
    }
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit('login');
  });

  registerBtn.addEventListener('click', (e) => {
    e.preventDefault();
    passInput.autocomplete = 'new-password';
    submit('register');
  });
}

async function solveChallengeProof(salt, difficulty, onProgress) {
  if (!globalThis.crypto?.subtle) throw new Error('Se requiere un navegador moderno para la verificación segura.');
  const encoder = new TextEncoder();
  const matchesDifficulty = (digest) => {
    const bytes = new Uint8Array(digest);
    for (let bit = 0; bit < difficulty; bit += 1) {
      if ((bytes[Math.floor(bit / 8)] & (1 << (7 - (bit % 8)))) !== 0) return false;
    }
    return true;
  };

  for (let candidate = 0; candidate < 2 ** 32; candidate += 1) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', encoder.encode(`${salt}:${candidate}`));
    if (matchesDifficulty(digest)) return String(candidate);
    if (candidate > 0 && candidate % 2048 === 0) {
      onProgress(candidate);
      await new Promise((resolve) => window.setTimeout(resolve, 0));
    }
  }
  throw new Error('No se pudo completar la verificación.');
}
