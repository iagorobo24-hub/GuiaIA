# GuiaIA V1 — Estado de Sesión y Continuidad de Desarrollo (V1_SESSION_STATE)

> **Última actualización:** 3 de noviembre de 2026 (Sesión 2 — Cierre de Fases 1 a 7)  
> **Equipo:** Durán (Windows 11)  
> **Rama activa:** `main`  
> **Último commit base verificado:** `df8c0dd3fbc61573bc8bfbf893090f4d8ec4a4e8`

---

## 1. Resumen Ejecutivo del Estado del Proyecto

Se ha completado con éxito la ejecución técnica de las **Fases 1, 2, 3, 4, 5, 6 y 7** del Plan Maestro de GuiaIA V1, transformando el prototipo de laboratorio en una aplicación instalable, segura, interactiva y contrastada empíricamente en Durán:

- **Instalador y Lanzador Windows:** Asistente `setup.ps1` en 5 pasos 100% verificado y lanzador `iniciar.bat`.
- **Consola TUI Unificada:** `cli_v1.js` con prompt interactivo `GuiaIA>`, HUD en tiempo real y parada de emergencia instantánea P0 (`ESC`, `q`, `Ctrl+C`, `parar`).
- **Autenticación Dual:** Microsoft OAuth Device Code Flow oficial (`prismarine-auth`) con tokens protegidos en `%LOCALAPPDATA%\GuiaIA\auth` + Emparejamiento por PIN efímero de 6 dígitos para LAN/offline.
- **Operaciones Batch y Multirrecurso:** Recolección y depósito en lotes de 1 a 16 ítems para roble, abedul, piedra, adoquín y carbón.
- **Reconciliación Guiada de Journals:** Resolución quirúrgica de estados `needs_review` (`cancel`, `retry`, `mark_step_completed`).
- **Testigo Monotónico Duradero:** Persistencia en disco append-only (`witness.log` y `head.json`) con `fsync` y firmas Ed25519.
- **Detección Cobblemon:** Compatibilidad automática de recetas en Fabric 1.21.1 sin desconexiones de red.
- **Batería de Pruebas:**
  - **52/52** pruebas V1 Node.js superadas (**100% PASS**).
  - **61/61** pruebas Python superadas (**100% PASS**).
  - Cero regresiones respecto al estado inicial.

---

## 2. Inventario de Entregables Completados por Fase

### Fase 1: Contratos y Esquemas Canónicos
- `schemas/v1/mission_spec.json`: Esquema JSON canónico de especificaciones de misión (1-16 bloques).
- `schemas/v1/mission_state.json`: Esquema JSON de diario de misión persistente.
- `schemas/v1/deposit_plan.json`: Esquema JSON de planes de transferencia en contenedores.
- `schemas/v1/action_grant.json`: Esquema JSON de permisos firmados Ed25519 de un solo uso.
- Tests: `companion/test/v1_schemas.test.js` y `tests/test_v1_schemas.py`.
- Soporte `vanilla_paired_operator`: `session_identity.js` y `secure_companion_controller.js`.
- Tests: `companion/test/vanilla_paired_operator.test.js` (3/3 PASS).

### Fase 2: Multirrecurso Batch y Reconciliación Guiada
- Catálogo ampliado en `gather.js` y `secure_companion_controller.js`: `oak_log`, `stone`, `cobblestone`, `coal`, `coal_ore`.
- Parser de lenguaje natural: `parseNaturalInstruction` ampliado para batch (1-16) y lenguaje coloquial.
- Reconciliación en diarios: métodos `reconcile(decision, details)` en `mission.js` y `deposit.js`.
- Tests: `companion/test/v1_multiresource_batch.test.js` (16/16 PASS).
- Tests: `companion/test/v1_journal_reconciliation.test.js` (8/8 PASS).

### Fase 3: Identidad y Autenticación Dual
- `companion/src/auth/microsoft_auth.js`: Integración de Microsoft Device Code Flow con almacenamiento fuera de git (`%LOCALAPPDATA%\GuiaIA\auth\`).
- `companion/src/auth/owner_pin_pairing.js`: Gestor de PIN de 6 dígitos efímero (3 min TTL, 3 intentos máx, evento `whisper` en chat).
- Tests: `companion/test/v1_auth_pairing.test.js` (9/9 PASS).

### Fase 4: Detección Dinámica de Perfil Cobblemon
- `companion/src/cobblemon_profile.js`: Inspección de marcas y canales (`minecraft:brand`), parcheo seguro de tabla de serialización de recetas de Fabric 1.21.1.
- Tests: `companion/test/v1_cobblemon_profile.test.js` (5/5 PASS).

### Fase 5: Testigo Monotónico Local Duradero
- `companion/src/local_monotonic_witness.js`: Log append-only en disco (`witness.log`) con `head.json` firmado con clave Ed25519 del testigo y verificación CAS de hashes SHA-256.
- Tests: `companion/test/v1_local_monotonic_witness.test.js` (5/5 PASS).

### Fase 6: Consola Interactiva Unificada (TUI / CLI)
- `companion/src/cli_v1.js`: Consola ANSI completa, HUD de estado en tiempo real, despachador de instrucciones con emisión de permisos firmados y parada P0 inmediata por tecla (`ESC`, `q`, `Ctrl+C`).
- Tests: `companion/test/v1_cli.test.js` (3/3 PASS).

### Fase 7: Empaquetado y Asistente de Instalación
- `setup.ps1`: Asistente PowerShell en 5 pasos (verificación Node >= 22, Python, directorios de usuario, dependencias npm y auto-test).
- `iniciar.bat`: Lanzador de doble clic para escritorio Windows.
- `iniciar.sh`: Lanzador POSIX para entornos Linux / Chromebook.
- `companion/package.json`: Actualizado a versión `1.0.0` con comandos `start:v1` y `start`.

---

## 3. Estado de Servidores Externos y Seguridad

- **Servidor Fabric / Teselia en Chromebook (PID 11085):** Intacto, protegido y sin perturbaciones.
- **Almacenamiento Local Seguro:** `%LOCALAPPDATA%\GuiaIA\` inicializado y aislado del árbol de trabajo de Git.
