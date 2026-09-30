export function openUserManual(): void {
  if (location.protocol === 'file:') {
    location.assign('./docs/manual.html');
    return;
  }

  const existing = document.getElementById('manualDialog');
  if (existing instanceof HTMLDialogElement) {
    existing.showModal();
    return;
  }

  const dialog = document.createElement('dialog');
  dialog.id = 'manualDialog';
  dialog.className = 'manual-dialog';
  dialog.setAttribute('aria-label', 'Manual de usuario');
  dialog.innerHTML = `
    <button class="manual-close" type="button" data-close-manual aria-label="Cerrar manual" title="Cerrar manual">×</button>
    <iframe title="Manual de usuario y administración" src="/docs/manual.html"></iframe>
  `;
  dialog.querySelector('[data-close-manual]')?.addEventListener('click', () => dialog.close());
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  dialog.addEventListener('close', () => dialog.remove(), { once: true });
  document.body.appendChild(dialog);
  dialog.showModal();
}
