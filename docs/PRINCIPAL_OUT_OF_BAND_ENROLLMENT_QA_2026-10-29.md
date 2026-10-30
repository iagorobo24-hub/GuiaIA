# GuiaIA — matrícula de claves de jugador offline (QA aislada, 2026-10-29)

**Estado:** módulo de registro y revocación implementado en copia local aislada. **No hay autenticación real de jugadores Minecraft, integración en servidor ni autorización de despliegue.**

## Base y aislamiento

- Repositorio: iagorobo24-hub/GuiaIA
- HEAD de partida: b5abed04518024e317ec0099ae02c85b07968e2a
- Rama local separada: feature/principal-enrollment-qa
- Copia: /home/iagui/guiaia-principal-enrollment-lab
- No se toca la rama de atestación activa de otro agente, main ni los servicios/mundo de Teselia.
- **No push / no merge / no PR / no despliegue.**

## Contrato de implementación

- companion/src/principal_enrollment.js — registro de claves públicas Ed25519 en un directorio temporal explícito de laboratorio.
- Alta: exigencia dual de ticket de matrícula firmado por el **operador ya confiable** y firma de posesión de la **clave personal** que se pretende registrar. El ticket ata principalId, publicKeyDer, worldId, UUID de un solo uso y ventana temporal máxima de cinco minutos.
- Baja: ticket independiente firmado por el operador; revocación persistente que deniega sesiones incluso cuando el verificador retiene un mapa anterior de claves.
- No se permite autoalta por mensaje de chat, nombre de Minecraft, UUID offline, ni sobreescritura de un principal revocado. La rotación usa un principalId nuevo tras autorización externa.
- Historial de operaciones firmado, validado tras reapertura, con clave pública de operador fijada externamente, límite de tamaño, modos 0700/0600, bloqueo exclusivo, fsync del fichero temporal y del directorio tras rename atómico.
- Una caída que deje bloqueo huérfano exige revisión manual; nunca se recupera de forma automática.
- Los tokens de entrada se clonan antes de almacenarse, evitando mutaciones posteriores por el llamador.
- La API expone trustedPrincipals() y isRevoked() para el contrato ya existente en session_identity.js.

## Evidencia

- companion/test/principal_enrollment.test.js: 16 casos positivos y negativos (firmas falsas, ausencia de consentimiento, caducidad, ámbito de mundo, replay, persistencia, revocación, cierre por fallo, mutación posterior, directorios arbitrarios/symlinks, algoritmo incorrecto y contrato de sesión).
- En la prueba de integración se usa un **servidor firmado sintético**, no una conexión autenticada de Fabric. Se comprueba que revocar una identidad bloquea su sesión incluso si queda una instantánea anterior de las claves confiables.
- **VALIDADO localmente:** `npm ci --ignore-scripts --no-audit --no-fund`, 16/16 pruebas dirigidas y 124/124 pruebas Node en `npm test`, sin fallos; `git diff --check` sin errores. No equivalen a una prueba real de identidad de Minecraft.

## Límites críticos

1. Firmar un desafío con la clave enrolada demuestra **posesión de clave, no titularidad de un nombre offline**. El operador necesita verificar al jugador por un canal fuera de Minecraft que hoy no está implementado.
2. Un atacante capaz de restaurar un archivo de historial anterior puede producir **rollback de revocaciones**. La validación de firmas no constituye un anclaje monotónico externo. No apto para producción sin resolverlo.
3. El prototipo no introduce una comprobación Fabric de presencia viva ni obliga a pasar todas las acciones por la misma puerta de autorización.
4. No se ha probado contra Cobblemon, servidores multijugador con claims ni pérdida de energía durante un guardado.
5. No hay UI ni proceso de distribución, custodia, rotación y recuperación de claves de jugador.
6. Las claves privadas no se guardan en el módulo, pero su custodia real permanece fuera del alcance.

## Próximo cierre

Una vez terminada la CI del otro agente y estabilizada la rama Fabric, integrar en rama coordinada con un punto de entrada obligatorio y presencia viva del servidor, añadiendo pruebas E2E de usuarios offline que se reconectan, revocación en vuelo y tests con permisos reales de cofres. Mantener bloqueado Teselia.

## Continuación: conexión criptográfica al lector Fabric y acciones de cofre

- El ensayo companion/test/qa_live_bridge_gateway.js ya no usa un mapa sintético de claves trustedPrincipals. Ahora registra claves públicas en el registro duradero autorizado por el operador, exige firma de consentimiento de posesión y consume el JOIN firmado real de Fabric mediante createPinnedQaServerBridgeAuthority.
- Con una sesión válida, primero deposita exactamente un tronco de roble. Después revoca la identidad original mientras la conexión Fabric sigue activa: la acción de abedul previamente preparada debe denegarse antes de abrir el cofre. Enrola una segunda identidad de QA con clave separada y, tras DISCONNECT real, exige que su acción también sea denegada. Los inventarios esperados siguen siendo bot: roble=0/abedul=1; cofre: roble=1/abedul=0; un recibo durable.
- Se añade una prueba dirigida de integración principal_enrollment.test.js que combina el lector del log firmado, matrícula con doble firma, puerta del compañero, revocación y desconexión sin simular que los eventos provienen de un servidor real. La nueva prueba usa un firmante Fabric de laboratorio y un bot simulado, e inspecciona que no se abre el cofre.
- El workflow fabric_bridge.yml vuelve a ejecutarse si cambia el registro de identidad o sus pruebas.
- Evidencia ahora contrastada en Penguin: esta revisión sí completó una prueba real del servidor Fabric 1.21.1 con depósito, matrícula firmada de QA, denegación por revocación y denegación por desconexión. No equivale a una prueba con claves reales de amigos ni a un despliegue. El resultado y sus saldos constan a continuación.
- Límite de seguridad: un log firmado de conexión solo expira a los 45 segundos y no ofrece prueba de presencia en vivo frente a caída súbita del servidor. También sigue pendiente anclaje externo de revocaciones contra rollback.

## Cierre verificado de la continuación en Penguin

**Fecha:** 2026-10-29. **Rama local:** feature/principal-enrollment-qa. **Sin push, merge ni despliegue.**

- 17/17 pruebas específicas Node aprobadas, incluidos lector de eventos firmados, registro persistente y rechazo previo a cualquier apertura de cofre.
- 125/125 pruebas Node de la aplicación aprobadas; comprobaciones de sintaxis JS y Python, y git diff --check correctas.
- Fabric Observer 1.21.1 construido con JDK 21 y Gradle 8.10.2: BUILD SUCCESSFUL.
- Primera ejecución de servidor descartada como fallo de infraestructura de prueba: el arranque en Penguin tardó casi 150 segundos, agotando el tiempo de espera justo cuando alcanzaba Done. Se amplió exclusivamente la espera de arranque de 150 a 240 segundos en scripts/qa_fabric_identity_bridge.py, sin alterar ningún requisito de autorización, inventario o firma.
- Segunda ejecución completa REAL_QA_RETRY_PASS en Penguin, finalizada con código 0. Log local de evidencia: /tmp/guiaia-enrollment-real-qa-retry.log. El laboratorio creó exclusivamente un mundo temporal loopback; se cerró y se eliminó automáticamente.
- GUIAIA_REAL_BRIDGE_CLIENTS_QA_EVIDENCE PASS: dos conexiones reales offline con el mismo nombre, distintas conexiones.
- GUIAIA_REAL_FABRIC_BRIDGE_QA_EVIDENCE PASS: dos JOIN y dos DISCONNECT firmados Ed25519 y verificados, desafíos distintos, falsificaciones rechazadas.
- GUIAIA_REAL_BRIDGE_RESTART_QA_EVIDENCE PASS: tras reiniciar Fabric, el log anterior queda vacío y no mantiene una conexión antigua.
- GUIAIA_REAL_SERVER_SESSION_GATE_QA_EVIDENCE PASS: JOIN firmado real + prueba de posesión de clave y matrícula de laboratorio autorizada por operador + depósito real en un cofre. Inventario final del bot oak_log=0, birch_log=1; cofre oak_log=1, birch_log=0; un recibo persistente. Nonce gastado no reutilizable. Revocación firmada en plena conexión niega el segundo depósito; sesión con otra clave de QA queda negada tras DISCONNECT; las dos denegaciones se producen antes de modificar el mundo. Reapertura del registro duradero confirma que la revocación sobrevive.

### Criterios de producción todavía no superados

- La matrícula utilizó claves y aprobación efímeras del laboratorio, no enrolamiento real fuera de Minecraft ni autenticación de la titularidad de un nombre offline.
- No hay presencia en vivo garantizada durante un corte abrupto: los eventos firmados de Fabric pueden quedar momentáneamente desfasados (hasta 45 segundos).
- Falta un anclaje monotónico externo que impida restaurar revocaciones antiguas, una puerta global obligatoria para cualquier acción, controles de claims y cofres multijugador, compatibilidad con Cobblemon, pruebas de corte de energía durante transferencia y verificación GitHub CI para este commit local.
- Teselia, el mundo, los servicios y main no se modificaron. La prueba real fue reproducida exclusivamente en un laboratorio desechable.

**Evidencia JSON verificable de las cuatro fases:** docs/evidence/PRINCIPAL_FABRIC_QA_2026-10-29.json. No contiene claves privadas ni datos de un servidor de producción.
