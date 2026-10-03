# Revisión de preparación ISO

Alcance: código y configuración versionada de Gran Chaique. Este documento **no es una certificación ISO** ni declara conformidad total: una certificación requiere definir el alcance organizacional, análisis de riesgos, evidencias operativas y una auditoría independiente.

## Resultado

| Marco | Estado | Evidencia en el repositorio | Pendiente organizacional |
| --- | --- | --- | --- |
| ISO/IEC 27001:2022 | Parcial | Contraseñas con `scrypt`, sesiones HttpOnly/SameSite, validaciones, encabezados de seguridad y separación de secretos mediante variables de entorno. | Inventario de activos y riesgos, políticas aprobadas, gestión de incidentes, control de proveedores, registros centralizados, revisión de accesos y auditoría interna. |
| ISO 9001:2015 | Parcial | Comprobación de sintaxis repetible (`npm run check`), documentación de despliegue y cálculo trazable de progreso/calificación. | Objetivos de calidad, responsables, control de cambios, gestión de quejas, métricas, revisión de dirección y acciones correctivas. |
| ISO 22301:2019 | Parcial | Instrucciones de respaldar SQLite y `uploads/`, y de comprobar restauraciones. | BIA, RTO/RPO aprobados, procedimiento de continuidad, copias externas cifradas, simulacros y registro de resultados. |

## Controles verificados en la aplicación

- La calificación se recalcula con todos los puntos de los ejercicios evaluables. Al crear, modificar o eliminar un ejercicio se actualizan todos los usuarios; el progreso se calcula por ejercicios terminados.
- Las credenciales no se almacenan en texto plano para cuentas nuevas y las existentes se migran al siguiente acceso correcto.
- Las sesiones no contienen rol ni identidad modificables por el navegador y expiran en siete días.
- El servidor restringe las operaciones administrativas, rechaza orígenes externos de escritura y evita recorridos de directorio.
- La base de datos, archivos subidos y secretos se excluyen de Git para reducir exposición accidental.

## Condiciones obligatorias antes de afirmar conformidad

1. Designar responsable del sistema y propietarios de información.
2. Documentar el alcance, requisitos legales aplicables y evaluación de riesgos; aprobar la Declaración de Aplicabilidad para ISO/IEC 27001.
3. Configurar HTTPS, secretos administrados, respaldos cifrados externos y monitoreo/alertas en la plataforma de producción.
4. Mantener evidencias: despliegues aprobados, restauraciones probadas, revisiones de acceso, incidentes, capacitación y auditorías internas.
5. Realizar revisión de dirección y contratar un organismo certificador acreditado si se busca certificación.

Las referencias de alcance son [ISO/IEC 27001:2022](https://www.iso.org/standard/27001), [ISO 9001:2015](https://www.iso.org/standard/62085.html) e [ISO 22301](https://www.iso.org/files/live/sites/isoorg/files/store/en/PUB100442.pdf).
