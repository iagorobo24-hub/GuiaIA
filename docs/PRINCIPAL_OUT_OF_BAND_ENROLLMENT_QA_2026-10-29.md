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
