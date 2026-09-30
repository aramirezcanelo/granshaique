# Auditoría técnica y de seguridad

Fecha: 2026-09-29. Alcance: fuentes y configuración disponibles en este repositorio. Esta revisión no constituye una auditoría de penetración, certificación ni verificación del proveedor de alojamiento.

## Cambios realizados

- TypeScript del servidor compila con `strict`, `noImplicitAny`, `noUnusedLocals` y `removeComments`. El comando `npm run typecheck` lo verifica antes de crear los bundles.
- El empaquetado sigue generando el servidor y el cliente bajo `dist/`; no genera source maps y el servidor solo sirve una lista explícita de recursos estáticos. No entrega archivos `.ts`.
- Las entradas JSON se rechazan si no son objetos. Se conservan límites de cuerpo, validación de credenciales, parámetros SQL y autorización administrativa por rol.
- El inicio de sesión limita a diez intentos fallidos por IP cada quince minutos y responde con HTTP 429 al excederlos.
- En producción se exige `Origin` del mismo host en las mutaciones y se envía HSTS. Las cookies de sesión ya usan `HttpOnly` y `SameSite=Strict`; `Secure` se activa en producción.
- `/health` y `/healthz` comprueban también que SQLite responda, y no revelan detalles internos ante un fallo.
- Se eliminaron los `console.log` de diagnóstico. Los errores operativos usan el nivel `error` y las líneas de arranque `info`.
- `.env.example` documenta variables sin incluir secretos. La base local, cargas, `node_modules` y `dist` están excluidos de Git.

## Límites y acciones fuera del código

- El cliente se transpila y empaqueta con esbuild, pero no está incluido en el chequeo estricto de TypeScript: sus vistas usan muchos selectores DOM dinámicos y requieren una migración tipada propia antes de activar `strict` para esos archivos.
- El limitador por IP vive en memoria y se reinicia al reiniciar la instancia. En despliegues con varias instancias se requiere un almacén compartido y considerar la IP real del proxy confiable.
- Este repositorio no define Docker, GitHub Actions, pruebas automatizadas, un ORM, React/TSX, GraphQL, Swagger ni servicios externos. Esos controles no se aplican a la arquitectura actual; no se añadieron dependencias o infraestructura ficticias.
- WAF, protección DDoS, reglas de firewall, TLS del proveedor, backups externos cifrados, restauración, alertas, límites de CPU/RAM, políticas de ramas y notificaciones dependen de cuentas y permisos de la plataforma. `render.yaml` configura el servicio y el disco persistente, pero no demuestra que dichos controles estén activos.
- La cookie usa `SameSite=Strict` y el servidor valida el origen de mutaciones en producción. No hay token CSRF separado; si se integran clientes externos o flujos entre sitios, se debe añadir un token anti-CSRF y revisar CORS.
- Las contraseñas nuevas usan `scrypt` de Node.js con salt aleatorio y comparación en tiempo constante; la migración a Argon2id/bcrypt requiere una decisión de dependencia y migración de credenciales.

## Verificación realizada

- `npm run build`: compilación TypeScript del servidor y empaquetado local del cliente completados.
- No se ejecutaron pruebas automatizadas ni un escáner de dependencias; el proyecto aún no incluye suite de pruebas. Para auditoría de despliegue, revisar los secretos y controles directamente en el proveedor antes de publicar.
