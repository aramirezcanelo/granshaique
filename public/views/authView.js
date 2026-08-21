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
          <form id="authForm" class="auth-form">
            <label class="field">
              <span>Usuario</span>
              <input name="user" type="text" placeholder="Tu usuario" required />
            </label>
            <label class="field">
              <span>Contraseña</span>
              <div class="password-field-wrap">
                <input name="pass" type="password" placeholder="••••••••" required />
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
            <div id="authMessage" class="auth-message"></div>
            <button class="btn primary" type="submit">Accede</button>
            <button class="btn ghost" type="button" id="registerBtn">¡Registrala!</button>
          </form>
        </div>
      </section>
    </div>
  `;

  const form = document.getElementById('authForm');
  const registerBtn = document.getElementById('registerBtn');
  const messageBox = document.getElementById('authMessage');
  const togglePassBtn = document.getElementById('togglePassBtn');
  const passInput = form.pass;

  togglePassBtn.addEventListener('click', () => {
    const showing = passInput.type === 'text';
    passInput.type = showing ? 'password' : 'text';
    togglePassBtn.classList.toggle('is-visible', !showing);
    togglePassBtn.setAttribute('aria-label', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
    togglePassBtn.setAttribute('title', showing ? 'Mostrar contraseña' : 'Ocultar contraseña');
  });

  const showMessage = (text, ok = true) => {
    messageBox.textContent = text;
    messageBox.style.color = ok ? '#0f766e' : '#b91c1c';
  };

  const submit = async (mode) => {
    const user = form.user.value.trim();
    const pass = form.pass.value.trim();
    if (!user || !pass) {
      showMessage('Completa usuario y contraseña.', false);
      return;
    }

    const res = await fetch(`/api/${mode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user, pass })
    });

    const data = await res.json();
    if (!res.ok) {
      showMessage(data.message || 'Error.', false);
      return;
    }

    if (mode === 'register') {
      showMessage('Registrada con éxito', true);
      form.reset();
      return;
    }

    location.reload();
  };

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    submit('login');
  });

  registerBtn.addEventListener('click', (e) => {
    e.preventDefault();
    submit('register');
  });
}
