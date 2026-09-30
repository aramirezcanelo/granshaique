export function connectionErrorView(): void {
  document.body.innerHTML = `
    <main class="error-card">
      <div class="error-brand"><span class="error-mark">G</span> GRAN CHAIQUE</div>
      <div class="error-symbol" aria-hidden="true">⌁</div>
      <h1>No hay conexión con el servidor</h1>
      <p class="error-copy">Comprueba tu conexión o confirma que el servidor esté activo. Cuando vuelva la conexión, podrás intentarlo otra vez.</p>
      <div class="error-actions">
        <a class="error-button primary" href="">Volver a intentar</a>
        <a class="error-button" href="/">Ir al inicio</a>
      </div>
      <p class="error-hint">Si el servidor sigue sin responder, contacta al administrador.</p>
    </main>
  `;
}
