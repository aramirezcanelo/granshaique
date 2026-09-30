# Gran Chaique

Aplicación de aprendizaje con ejercicios interactivos, seguimiento de progreso y administración de usuarios. El código de la aplicación y del servidor está escrito en TypeScript; el navegador recibe un paquete local generado durante la compilación.

## Estructura

```text
public/                 Cliente TypeScript y recursos estáticos
  views/                Vistas de la aplicación en TypeScript
  shared/               Componentes e interacciones reutilizables
server/                 Servidor HTTP y SQLite en TypeScript
docs/manual.html        Manual visual, imprimible y sin dependencias externas
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

Cada cuenta recibe un identificador público diario compacto en formato `AAMMDDNN`, por ejemplo `26092901`. El contador se guarda por fecha y continúa aunque se eliminen cuentas. Los IDs antiguos con barras se convierten al nuevo formato al iniciar el servidor; la clave primaria interna sigue oculta y mantiene los vínculos existentes.

Abre el botón **Manual de uso** en el acceso o **Manual** en la barra superior para consultar la guía dentro de la aplicación. También puedes abrir [docs/manual.html](docs/manual.html) directamente e imprimir o guardar como PDF desde el navegador.

## Despliegue

El proyecto incluye `render.yaml` para Render. La compilación usa `npm ci --include=dev` y `npm run build`; el inicio ejecuta el JavaScript de `dist/`. El servicio define `NODE_ENV=production`, zona horaria de Ciudad de México, usa `/healthz` como health check y guarda SQLite y archivos cargados en el disco persistente.

Antes del primer deploy, conecta el repositorio a Render, configura `ADMIN_USER` y `ADMIN_PASSWORD` como secretos (contraseña de al menos 10 caracteres), conserva el disco en `/var/data` y usa una sola instancia porque las sesiones actuales viven en memoria. Render termina HTTPS delante de la app; `Secure` en cookies y HSTS se activan con `NODE_ENV=production`. Tras el primer deploy, confirma que `/healthz` responda y que el acceso admin funcione. Configura backups externos del disco antes de usar datos reales.

### Pasar este código a un repositorio existente

Esta carpeta descargada no tiene `.git` ni un remoto configurado. Para conservar el historial del repositorio original y evitar reemplazar archivos remotos, clónalo en una carpeta nueva y copia ahí el código. En PowerShell, ejecuta esto desde esta carpeta:

```powershell
$sourcePath = (Get-Location).Path
$repoUrl = Read-Host "URL HTTPS o SSH del repositorio existente"
$repoPath = "C:\Users\Alex\Documents\web-projects\granshaique-publish"
if (Test-Path $repoPath) { throw "La carpeta destino ya existe. Cambia `$repoPath a una carpeta nueva y vacía." }
git clone $repoUrl $repoPath
if ($LASTEXITCODE -ne 0) { throw "No se pudo clonar el repositorio." }
Set-Location $repoPath
git switch -c feat/typescript-mobile-manual
robocopy $sourcePath $repoPath /E /XD ".git" "node_modules" "dist" "uploads" "$sourcePath\server\data" /XF ".env"
if ($LASTEXITCODE -ge 8) { throw "Robocopy encontró un error; revisa su salida antes de continuar." }
npm ci
npm run build
git status --short
git ls-files -- .env
```

La copia excluye la contraseña local, dependencias compiladas, base SQLite y cargas; no uses `/MIR` ni `git push --force`. Si `git ls-files -- .env` devuelve `.env`, quítalo del seguimiento con `git rm --cached -- .env` y rota cualquier secreto que haya estado publicado. Revisa los cambios con `git diff --check` y `git diff --stat`, luego:

```powershell
git add -A
git diff --cached --check
git diff --cached --stat
git diff --cached
git commit -m "feat: improve mobile experience and deployment setup"
git push -u origin feat/typescript-mobile-manual
```

Revisa el diff preparado para confirmar que no incluya `.env`, datos personales, SQLite ni archivos privados. Después abre un pull request desde `feat/typescript-mobile-manual` a la rama principal y fusiónalo según las reglas del repositorio.

### Actualizar el servicio existente en Render

En Render, abre el servicio actual y revisa **Settings → Build & Deploy**: la rama de despliegue debe ser la principal y los comandos deben coincidir con `render.yaml` (`npm ci --include=dev && npm run build` y `node --env-file-if-exists=.env dist/server/server.js`). En **Environment** conserva los secretos `ADMIN_USER` y `ADMIN_PASSWORD`, y verifica `NODE_ENV=production`, `APP_TIME_ZONE=America/Mexico_City`, `DATA_DIR=/var/data` y `UPLOADS_DIR=/var/data/uploads`. En **Disks**, conserva el disco persistente montado en `/var/data`.

Si el auto-deploy está activado para la rama principal, Render iniciará el despliegue al fusionar el pull request. Si está desactivado, selecciona **Manual Deploy → Deploy latest commit** después de la fusión. Confirma en **Events/Logs** que el build y el arranque terminen correctamente; luego abre la URL del servicio y verifica `/healthz` y el acceso.

Consulta [ISO_READINESS.md](ISO_READINESS.md) para el alcance y las tareas operativas pendientes.
