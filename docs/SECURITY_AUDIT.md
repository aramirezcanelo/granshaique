# Auditoría técnica y de seguridad

Alcance: código fuente, configuración, dependencias bloqueadas y base SQLite local. No es una prueba de penetración ni verifica la configuración privada de Render.

## Resumen

La contraseña temporal en texto claro se quitó del `.env` local, que está ignorado por Git, y se reinició el servidor para descargarla de su entorno. La base local contiene dos cuentas admin y ambas tienen contraseñas con hash `scrypt`; por eso retirar la variable no cambia las credenciales guardadas ni invalida la contraseña anterior. Si se necesita revocarla, hay que cambiar la contraseña de la cuenta.

La aplicación tiene controles útiles para un proyecto pequeño: contraseñas con hash, autorización admin en rutas de gestión, cookies de sesión protegidas, validación del origen en producción, consultas SQL parametrizadas y límites de tamaño. Se añadió una prueba de trabajo SHA-256 de un solo uso, calculada localmente, junto con honeypot y límite de 10 intentos por IP cada 15 minutos para las altas públicas; los contenidos editables también se escapan antes de insertarse en plantillas HTML. El rate limit vive en memoria y la prueba de trabajo aumenta el costo de la automatización sin identificar a una persona; estas medidas no sustituyen verificación de correo ni un proveedor anti-bot administrado.

## Controles comprobados

- `tsconfig.json` y `tsconfig.server.json` activan `strict`, `noImplicitAny`, `noUnusedLocals` y `removeComments`. La búsqueda no encontró `any`, `@ts-ignore`, `@ts-expect-error` ni conversiones `as unknown as` en TypeScript.
- `npm run build` compiló el servidor y empaquetó el cliente en `dist/`. El cliente usa esbuild con bundle y minificación; TypeScript no genera source maps por defecto. No se encontraron `.map` en `dist`, ni el servidor publica archivos `.ts`.
- La búsqueda de código no encontró contraseñas o tokens literales en fuentes. `.env` no está versionado, no aparece en el historial de Git y ahora no contiene `ADMIN_PASSWORD`. `.env.example` deja el valor vacío y `render.yaml` solo declara el secreto como variable externa.
- En la base local: 2 administradores, ambos con hash `scrypt`; 0 contraseñas sin hash. Las contraseñas nuevas usan salt aleatorio y comparación en tiempo constante. Sigue existiendo una ruta de compatibilidad que convierte contraseñas antiguas al iniciar sesión; la base de producción no se inspeccionó.
- Las consultas que usan datos de usuario pasan valores como parámetros SQLite. El código no define un ORM; los esquemas e interfaces se mantienen manualmente.
- Los endpoints de usuarios, cursos, archivos y ajustes administrativos verifican sesión y rol admin. El progreso requiere sesión y se vincula al usuario de la sesión.
- El login y las altas públicas requieren una prueba de trabajo SHA-256 de 16 bits, ligada a un reto de un solo uso en cookie HttpOnly y con vencimiento de cinco minutos. Las altas públicas también requieren el honeypot vacío y no superar 10 intentos por IP cada 15 minutos. La IP reenviada se considera solo cuando `RENDER=true`, y se valida como dirección IPv4 o IPv6. Las cuentas creadas desde una sesión admin no consumen el límite público.
- Los textos de ejercicios, nombres, instrucciones, archivos y valores de usuarios se escapan en las plantillas dinámicas. Las vistas previas de archivo aceptan solo rutas locales bajo `/uploads/`; las URL de video se convierten a dominios YouTube permitidos y se rechazan si no se reconocen.
- La cookie de sesión es `HttpOnly` y `SameSite=Strict`; `Secure` se añade en producción. Las sesiones usan tokens aleatorios de 256 bits, duran siete días y actualmente se guardan en memoria.
- En producción se exige `Origin` del mismo host en las mutaciones. No hay CORS abierto. La política CSP permite scripts y estilos locales sin `unsafe-inline`; también están configurados HSTS en producción, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` y `Permissions-Policy`.
- La lectura JSON tiene un límite de 1 MB y las cargas tienen límite de cuerpo y 15 MB decodificados; la carga requiere rol admin. Los archivos reciben nombres generados y la ruta está restringida a directorios públicos permitidos.
- `npm audit --offline` informó 0 vulnerabilidades con los datos locales disponibles. No equivale a una consulta en línea actualizada.
- No se encontraron `console.log`; los errores operativos se escriben con `console.error` y el arranque con `console.info`.

## Riesgos que requieren atención

### Prioridad alta

1. **La verificación anti-bot no confirma identidad.** La prueba de trabajo eleva el costo por intento, pero un bot puede calcularla y no verifica correo ni identidad. Para inscripciones expuestas a spam, conviene sumar verificación de correo o un proveedor CAPTCHA accesible.
2. **Las defensas por IP viven en memoria.** Los límites se reinician al reiniciar el proceso y cada instancia mantiene su propio contador. Si Render usa varias instancias o reinicia el servicio, usa un almacén compartido o limita el escalado. Revisa que el servicio de Render tenga `RENDER=true`; fuera de Render no se confía en `X-Forwarded-For`.

### Prioridad media

3. **Operaciones síncronas bloquean el Event Loop.** SQLite usa `DatabaseSync`, el hash usa `scryptSync` y las cargas escriben con `writeFileSync`. Con una instancia pequeña y baja concurrencia puede ser aceptable; ataques de carga o más usuarios pueden retrasar todas las solicitudes. Considerar APIs asíncronas, límites de concurrencia y pruebas de carga.
4. **Las sesiones viven en memoria.** Reiniciar el proceso cierra todas las sesiones y las entradas vencidas no se purgan proactivamente. La configuración actual presupone una sola instancia. Para escalar, usar un almacén compartido con expiración y definir rotación/revocación al cambiar credenciales.
5. **La validación de entradas es manual.** Hay comprobaciones por endpoint, pero no DTOs tipados con esquema ejecutable. La compilación TypeScript cubre el servidor; `tsconfig.json` incluye solo `server/**/*.ts` y el cliente se transpila sin chequeo estricto de tipos.
6. **Complejidad y errores.** El enrutador concentra muchas rutas en `handleRequest`, no hay clases de error del dominio y ciertas promesas del cliente se manejan localmente con patrones distintos. Conviene modularizar rutas y validadores sin alterar la lógica de datos.
7. **Carga de archivos.** Solo la administra un admin y se limita el tamaño, pero no hay lista permitida de tipos ni comprobación del contenido real del archivo. Definir los formatos admitidos y servir cargas como descargas cuando proceda.

## Elementos no aplicables o no verificables aquí

- Prisma, TypeORM, Drizzle, React/TSX, alias `@/`, GraphQL, Swagger, APIs de terceros y circuito de reintentos: no forman parte de esta aplicación. El empaquetado de cliente permite tree shaking; el servidor se transpila con `tsc` y no requiere un bundle.
- Docker, firewall, WAF/CDN, mitigación DDoS, TLS del proveedor, reglas de IP, límites de recursos, CI/CD, protección de rama, webhook, monitoreo centralizado, copias externas y restauración: no se pueden confirmar desde este repositorio. Render configura disco y health check; hay que verificar los valores y políticas directamente en la cuenta.
- La aplicación no redirige HTTP a HTTPS por sí misma; en Render la terminación TLS/redirección depende del proxy de la plataforma.
- No hay suite de pruebas automatizadas, análisis SAST ni pruebas de penetración. `npm run build` y `npm audit --offline` no sustituyen esas revisiones.

## Verificación realizada

- `npm run build`: correcto; el servidor y el cliente se generaron en `dist/`.
- `npm audit --offline`: 0 vulnerabilidades reportadas por la metadata local disponible.
- Búsquedas estáticas: sin secretos literales versionados, `.env` ausente del seguimiento e historial de Git, sin `any`/directivas de omisión/conversiones dobles, sin mapas fuente y sin mutaciones de estilo en línea.
- Servidor local después de retirar la variable: `/healthz` respondió correctamente y `/api/registration-status` respondió `{"open":false}`.
- La compilación final posterior a los cambios de seguridad también pasó (`npm run build`). No se verificó una instancia de producción ni la configuración del dashboard de Render.
- No se modificaron ni publicaron secretos de Render, GitHub ni otros servicios externos.
