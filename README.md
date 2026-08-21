# Gran Chaique

Aplicación web de aprendizaje con ejercicios, seguimiento de progreso y administración de usuarios.

## Requisitos

- Node.js 22.22.0 (usa SQLite integrado de Node; la versión queda fijada para Render).
- Un proxy HTTPS en producción, por ejemplo Nginx, Caddy o la plataforma de despliegue.

## Arranque local

1. Copia `.env.example` como `.env` y define una contraseña de administrador larga.
2. Ejecuta `npm run check`.
3. Ejecuta `npm start` y abre `http://localhost:8080`.

En un entorno que ya tenga un administrador, las variables `ADMIN_USER` y `ADMIN_PASSWORD` no son necesarias. En una base nueva de producción sí lo son; el servidor se detiene si no se proporcionan.

## Despliegue de producción

1. Configura `NODE_ENV=production`, `PORT`, `ADMIN_USER` y `ADMIN_PASSWORD` como secretos de la plataforma; no subas `.env` a Git.
2. Usa almacenamiento persistente para `server/data/app.sqlite` y `uploads/`.
3. Publica la aplicación únicamente detrás de HTTPS. Las cookies de sesión se marcan como `Secure` en producción, por lo que no funcionarán mediante HTTP.
4. Ejecuta `npm run check` antes de cada despliegue y configura el comando de inicio como `npm start`.
5. Programa copias de seguridad cifradas de la base SQLite y de `uploads/`. Comprueba una restauración antes del lanzamiento.

## Render

El repositorio incluye `render.yaml`. Crea el servicio desde ese Blueprint y completa `ADMIN_USER` y `ADMIN_PASSWORD` como secretos en el panel. El servicio usa el plan Starter porque SQLite y los archivos cargados requieren el disco persistente de `/var/data`; no uses un plan sin disco para producción. Mantén una sola instancia: SQLite local y las sesiones en memoria no se comparten entre instancias.

Render asigna `PORT` y termina TLS; el endpoint de salud es `/healthz`. Tras el primer despliegue, comprueba ese endpoint, crea un usuario de prueba, carga un archivo y verifica que ambos sigan disponibles después de un redeploy.

## Seguridad incluida

- Contraseñas con `scrypt`; las contraseñas heredadas se convierten al iniciar sesión correctamente.
- Sesiones opacas, `HttpOnly`, `SameSite=Strict` y `Secure` en producción.
- Cuenta administradora inicial creada solo con variables de entorno, sin contraseña fija en el código.
- Encabezados de seguridad, restricción de origen en peticiones de escritura y protección contra recorridos de ruta.
- Límite para solicitudes JSON declaradas y archivos cargados de hasta 15 MB.

## Operación

No es posible consultar contraseñas desde el dashboard. Para cambiar una contraseña, escribe una nueva en su campo; dejarlo vacío conserva la actual. La API permite el registro público de usuarios normales; solo un administrador autenticado puede crear cuentas administradoras.

`server/data/app.sqlite` y el contenido de `uploads/` se ignoran en Git intencionadamente. Si ya se habían añadido a Git, retíralos del índice solo después de verificar el respaldo: `git rm --cached server/data/app.sqlite`.

Consulta [ISO_READINESS.md](ISO_READINESS.md) para el alcance, evidencia y pendientes de conformidad.
