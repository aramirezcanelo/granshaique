import { authView } from './views/authView';
import { courseView } from './views/courseView';
import { showToast } from './shared/ui';
import { connectionErrorView } from './views/errorView';
async function startApp() {
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin' });
    if (response.status >= 500) return connectionErrorView();
    if (response.ok) {
      const user = await response.json();
      if (user.authenticated) return courseView(user);
    }
  } catch {
    if (location.protocol === 'file:') {
      document.body.dataset.localPreview = 'true';
      authView();
      showToast('Vista local: inicia el servidor para usar cuentas, progreso y administración.', 'info', 0);
      return;
    }
    connectionErrorView();
    return;
  }
  authView();
}

startApp();

