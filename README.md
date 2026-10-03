# Gran Chaique

Aplicación de aprendizaje con ejercicios interactivos, seguimiento de progreso y administración de usuarios. El código de la aplicación y del servidor está escrito en TypeScript; el navegador recibe un paquete local generado durante la compilación.

## Estructura

```text
public/                 Cliente TypeScript y recursos estáticos
  views/                Vistas de la aplicación en TypeScript
  shared/               Componentes e interacciones reutilizables
server/                 Servidor HTTP y SQLite en TypeScript
docs/manual.html        Manual visual, imprimible y sin dependencias externas
docs/privacy.html       Aviso de privacidad y cookies de sesión
tsconfig.server.json    Configuración de compilación del servidor
package.json            Scripts y dependencias de compilación
package-lock.json       Versiones exactas para instalaciones reproducibles
uploads/                Archivos cargados por usuarios
dist/                   Salida generada; no se edita a mano ni se sube a Git
index.html              Entrada local, abre con doble clic
```

## Vista local con doble clic

`index.html` abre la interfaz de acceso sin instalar un servidor. Esta vista es una previsualización: el navegador no puede ejecutar la API ni SQLite desde un archivo local. Para iniciar sesión, registrar usuarios, guardar el progreso, subir archivos y administrar ejercicios, inicia el servidor siguiendo el apartado siguiente.

## Desarrollo y servidor

- Node.js 22.22.0
- npm

```sh
npm install
npm run build
npm start
```

Abre `http://localhost:8080`. `npm start` compila el servidor TypeScript antes de iniciarlo. `npm run build` genera el cliente y servidor en `dist/`; los paquetes de compilación quedan instalados localmente en `node_modules` y no se usan desde CDN.

Después de clonar o cambiar dependencias, conserva y actualiza `package-lock.json` con `npm install`; en automatización usa `npm ci` para instalar exactamente esas versiones.

En una instalación nueva, configura `ADMIN_USER` y `ADMIN_PASSWORD` mediante el entorno. No guardes secretos en Git. En producción configura `NODE_ENV=production`, almacenamiento persistente para `server/data/app.sqlite` y `uploads/`, y sirve el sitio detrás de HTTPS.

Para desarrollo local, `npm start` lee `.env` si existe. Si la base no tiene ningún admin, crea automáticamente el usuario indicado por `ADMIN_USER`; cuando no se indica, usa `Ako` fuera de producción. Configura `ADMIN_PASSWORD` con una contraseña de al menos 10 caracteres en `.env`. En producción se exigen ambos valores desde el administrador de secretos de la plataforma.

El inicio de sesión y el registro público incorporan una prueba de trabajo SHA-256 de un solo uso, calculada en el navegador, además de límites de intentos por IP y un campo trampa para bots. La verificación no usa CAPTCHA de terceros; tampoco confirma identidad, así que habilita el registro público solo cuando corresponda.

Cada cuenta recibe un identificador público diario compacto en formato `AAMMDDNN`. El contador se guarda por fecha y continúa aunque se eliminen cuentas. Los IDs antiguos con barras se convierten al nuevo formato al iniciar el servidor; la clave primaria interna sigue oculta y mantiene los vínculos existentes.

## Control de inscripciones

El admin gestiona el registro público desde **Dashboard → Gestión de usuarios**, en la tarjeta destacada **Inscripciones públicas**. El botón **Abrir inscripciones** permite crear cuentas desde la pantalla de acceso; **Cerrar inscripciones** bloquea nuevas altas públicas y oculta el botón de registro. El estado queda guardado en SQLite y el formulario de acceso lo actualiza automáticamente mientras está abierto. La administración conserva la posibilidad de crear usuarios desde Gestión de usuarios, incluso cuando el registro público está cerrado. En instalaciones nuevas las inscripciones comienzan cerradas.

Abre el botón **Manual de uso** en el acceso o **Manual** en la barra superior para consultar la guía dentro de la aplicación. También puedes abrir [docs/manual.html](docs/manual.html) directamente e imprimir o guardar como PDF desde el navegador.

En el primer acceso aparece una notificación para **Aceptar y continuar** o **Rechazar** las cookies esenciales; incluye el [aviso de privacidad](docs/privacy.html). Si se rechazan, el inicio de sesión y el registro quedan desactivados y no se prepara el reto temporal. La elección se recuerda localmente y puede cambiarse desde **Cambiar preferencia**. La aceptación se valida en el servidor y se asocia a la cuenta con la versión del aviso. La cookie de sesión dura como máximo siete días; en producción se marca `Secure`, además de `HttpOnly` y `SameSite=Strict`. El aviso no publica datos personales de contacto; la comunidad debe definir la identidad y domicilio del responsable antes de considerarlo definitivo.

Consulta [docs/SECURITY_AUDIT.md](docs/SECURITY_AUDIT.md) para revisar los controles comprobados y los riesgos pendientes.

## Despliegue

El proyecto incluye `render.yaml` para Render. La compilación usa `npm ci --include=dev` y `npm run build`; el inicio ejecuta el JavaScript de `dist/`. El servicio define `NODE_ENV=production`, zona horaria de Ciudad de México, usa `/healthz` como health check y guarda SQLite y archivos cargados en el disco persistente.

Antes del primer deploy, conecta el repositorio a Render, configura `ADMIN_USER` y `ADMIN_PASSWORD` como secretos (contraseña de al menos 10 caracteres), conserva el disco en `/var/data` y usa una sola instancia porque las sesiones actuales viven en memoria. Render termina HTTPS delante de la app; `Secure` en cookies y HSTS se activan con `NODE_ENV=production`. Tras el primer deploy, confirma que `/healthz` responda y que el acceso admin funcione. Configura backups externos del disco antes de usar datos reales.

### Actualizar el repositorio

Desde una copia clonada y conectada a GitHub, revisa y publica cambios con:

```powershell
git status --short
npm ci
npm run build
git add -A
git diff --cached --check
git diff --cached --stat
git commit -m "Describe los cambios"
git push origin main
```

El `.gitignore` excluye `.env`, `node_modules`, `dist`, la base SQLite y los archivos cargados. Confirma que no hayas quitado esas exclusiones antes de publicar; nunca agregues contraseñas ni datos privados al repositorio.

### Actualizar el servicio existente en Render

En Render, abre el servicio actual y revisa **Settings → Build & Deploy**: la rama de despliegue debe ser la principal y los comandos deben coincidir con `render.yaml` (`npm ci --include=dev && npm run build` y `node --env-file-if-exists=.env dist/server/server.js`). En **Environment** conserva los secretos `ADMIN_USER` y `ADMIN_PASSWORD`, y verifica `NODE_ENV=production`, `APP_TIME_ZONE=America/Mexico_City`, `DATA_DIR=/var/data` y `UPLOADS_DIR=/var/data/uploads`. En **Disks**, conserva el disco persistente montado en `/var/data`.

Si el auto-deploy está activado para la rama principal, Render iniciará el despliegue al fusionar el pull request. Si está desactivado, selecciona **Manual Deploy → Deploy latest commit** después de la fusión. Confirma en **Events/Logs** que el build y el arranque terminen correctamente; luego abre la URL del servicio y verifica `/healthz` y el acceso.

Consulta [ISO_READINESS.md](ISO_READINESS.md) para el alcance y las tareas operativas pendientes.
