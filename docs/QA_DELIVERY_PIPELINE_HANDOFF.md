# GuiaIA: fase funcional «recolectar → guardar» (QA)

**Estado (revisión 2):** coordinador ampliado y **36/36 pruebas superadas fuera de Penguin**: 27 pruebas unitarias de flujo, seguridad y carreras, más 9 de integración con los diarios reales recuperados de GitHub (fuentes exactas verificadas por SHA de blob). **Ninguna prueba se ha ejecutado en Penguin o Minecraft en esta fase**. No se ha creado ningún commit ni desplegado nada en GitHub o Teselia.

## Objetivo y alcance

Crear un coordinador limitado de tareas de entrega a cofre que use **los diarios durables preexistentes** `openMission` y `openDepositJournal` sin sustituir sus barreras de escritura previa. No crea mecanismos de minería, permisos ni acciones nuevas: acepta adaptadores de QA suministrados expresamente y un callback de autorización por operación.

Soporta **de 1 a 3** bloques `oak_log` / `birch_log` y **1 o 2** tipos de depósito, siempre con cantidades coincidentes. Las acciones se ejecutan en el orden `gather` hasta completar todos sus recibos y solo después `deposit` en el cofre aprobado. `status`, `runNext`, `runAll` y `stop` son las únicas operaciones de esta interfaz, sin chat ni lenguaje natural.

## Contratos de seguridad

- `approvedPlan` viene de una fuente aprobada **separada** de los diarios y debe coincidir exactamente con propietario, identificadores únicos `missionId` y `planId`, bloques, materiales y cofre. Este módulo **no verifica una firma de ese plan**: la integración debe hacerlo antes de suministrarlo.
- `authorizeDispatch(summary)` debe ser una **comprobación pasiva** y consultar la sesión viva de Fabric, la revocación y el testigo externo según los contratos más recientes de Penguin. Devolver `false`, lanzar una excepción, tardar más de 1,5 segundos o no estar disponible bloquea la acción. **Se vuelve a autorizar después de crear el adaptador**, justo antes de entrar en el diario durable. Una respuesta tardía nunca dispara acciones. Esta doble consulta evita utilizar una autorización que se haya revocado mientras se preparaba el adaptador.
- La solicitud de acción se vuelve a contrastar con los diarios después de cualquier `await`. No se acepta cambio silencioso de plan ni estado en mitad de una autorización.
- La operación `stop()` invoca la cancelación durable de **ambos** diarios y no deja que una autorización o fábrica de adaptadores pendiente lance operaciones. Si una de las cancelaciones falla, se intenta también la otra y se informa del fallo. Los adaptadores deben respetar `cancel()` durante operaciones activas.
- Cualquier resultado `paused`, `dispatching`, `transferring`, `needs_review` o `cancelled` bloquea la continuación automática. En particular, **nunca** se reintenta una extracción o transferencia incierta.
- Los adaptadores y diarios reales siguen siendo las autoridades finales de alcance, recibos, bloqueo de proceso y fsync.
- **No conectar esta interfaz a `cli.js`, chat, LLM o el servidor real**. No existe aún una identidad de jugador ni un anclaje remoto de producción.

## Aplicación cuando Penguin vuelva a estar disponible

1. Verificar `git status -sb`, `HEAD`, procesos y trabajo de otros agentes en `/home/iagui/guiaia-principal-enrollment-lab`. Último HEAD observado antes del bloqueo: `cc4ce3d`.
2. Inspeccionar los contratos actuales de `mission.js` y `deposit.js` por si han cambiado; **no** aplicar ciegamente a otro commit o rama.
3. Aplicar el archivo `guiaia-qa-delivery-pipeline.patch` con `git apply --check` y, si pasa, `git apply`; no tocar la otra rama ni Teselia.
4. `cd companion && npm ci --ignore-scripts --no-audit --no-fund && node --test test/qa_delivery_pipeline.test.js test/qa_delivery_real_journals.test.js && npm test`.
5. Antes de hacer jugable la tarea, conectar **la fuente aprobada del plan y el control de identidad verdadero**: `authorizeDispatch` no puede ser un booleano aceptado de un comando de usuario. Integrar luego los adaptadores reales de Mineflayer solo en `scripts/qa_...` de Fabric desechable; verificar inventarios y recibos, fallo de red, reinicio y no duplicaciones.
6. Revisar el diff, documentar resultados y efectuar **solo commit local**. No push ni merge sin autorización.

## Evidencia de esta sesión

- `node --test test/qa_delivery_pipeline.test.js test/qa_delivery_real_journals.test.js` — **36/36 PASS**, Node v22.16.0 (entorno aislado de ChatGPT, no Penguin): **27 unitarias** y **9 de integración de diarios**.
- Los archivos reales `companion/src/mission.js` y `companion/src/deposit.js` se recuperaron del commit público de la rama `feature/fabric-connection-attestation-qa`; sus hashes Git blob coinciden con GitHub: `4d7e6bcf552f28466c330479e167884043294e90` y `49b0d3447118a72ff0c9db449a7ecbcaee310077`.
- Las importaciones de `vec3`, `gather` y `controller` se sustituyeron **solo dentro del laboratorio** por módulos mínimos: las pruebas de diarios no requieren Minecraft ni invocan las acciones reales.
- `node --check` del módulo y ambas suites — PASS.
- Pruebas reales de Mineflayer, pruebas completas del repositorio en Penguin y GitHub Actions de esta revisión — **no ejecutadas**.

Limitación importante: los tests unitarios utilizan *dobles de prueba* de los diarios, almacenados en ficheros. La prueba de integración con diarios reales obtiene los identificadores desde los diarios para construir su fixture de laboratorio; **una integración de producción NO puede hacer eso al recuperar un plan**: los identificadores deben estar fijados en una autorización externa anterior. Tampoco se detecta un rollback de los mismos archivos a una versión antigua con identificadores idénticos sin un testigo monotónico independiente. Aunque el flujo se implementa como código real, no se podrá cerrar esta fase como integrada o jugable hasta ejecutar las pruebas de APIs reales y el ensayo Fabric.

## Hallazgos cerrados en la revisión 2

1. **TOCTOU (confirmado y corregido):** un permiso concedido inicialmente se podía revocar durante el trabajo asíncrono de construcción del adaptador. Ahora se comprueba nuevamente justo antes de `journal.runNext`. Prueba negativa de autorización caducada/caída del testigo con cero acciones ejecutadas.
2. **Cancelación de tarea (añadida):** `stop()` persiste cancelación en ambos diarios. Durante una extracción o transferencia ya iniciada, cada diario deja `needs_review` y se solicita cancelar el adaptador; ninguna respuesta tardía puede generar un recibo de éxito.
3. **Cancelación parcialmente fallida (corregida):** el segundo diario también recibe el intento de parada aunque el primero arroje un error; la interfaz informa que la cancelación no se pudo garantizar.
4. **Competencia concurrente (verificada):** dos coordinadores sobre los mismos diarios no consiguen duplicar la extracción; el journal bloquea el segundo despacho.

**Importante:** `authorizeDispatch` y los factories se proporcionan por una integración confiable: el coordinador no valida las firmas de sesión por sí mismo. La fábrica de adaptadores **no debe provocar cambios en Minecraft**; solo `journal.runNext` está autorizado para despacharlos. Una segunda autorización no sustituye la revocación activa dentro de las acciones, la protección contra rollback de almacenamiento ni los permisos del servidor. Los programas de recuperación de diarios requieren revisión humana de operaciones inciertas.
