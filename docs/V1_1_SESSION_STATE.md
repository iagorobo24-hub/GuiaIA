# GuiaIA V1.1 — Estado de Sesión y Matriz de Estabilización Correctiva (V1_1_SESSION_STATE)

> **Última actualización:** 3 de noviembre de 2026 (Auditoría Correctiva, Integración Auténtica y Estabilización Multinivel)  
> **Estación de trabajo:** `DURÁN` (Windows 11, x86_64)  
> **Workspace activo:** `C:\Users\iagui\AI Projects\GuiaIA` (Junction `D:\AI Projects D\03_PLATAFORMA_AGENTICA\GuiaIA`)  
> **Rama activa:** `main`  
> **Commit base V1.0.0:** `4b3e917674a889eaf251a79efb5c441349983459` (Tag `v1.0.0`)  
> **Commit de recuperación previo:** `e2fef0d` (Checkpoint de estabilización)  
> **Protección de infraestructura:** Servidor Teselia / Chromebook (PID 11085) protegido e intacto. Sin conexiones no autorizadas.  
> **Directiva de Cierre:** **NO DECLARAR V1.1 CERRADO NI PUBLICADO**. V1.1 continúa en desarrollo activo bajo gobernanza estricta.

---

## 1. Taxonomía de Estado y Criterio de Verdad

Para garantizar máxima honestidad técnica y evitar confirmaciones sintéticas o declaraciones de éxito prematuras, todo componente de GuiaIA V1.1 se clasifica bajo cuatro estados inequívocos:

1. **`IMPLEMENTADO`**: Código fuente original, esquemas JSON y contratos tipados presentes en el árbol de trabajo del repositorio.
2. **`SIMULADO`**: Verificado funcionalmente mediante arneses de prueba unitaria, entidades mock y entornos en memoria sin conexión a servidor físico.
3. **`VERIFICADO REALMENTE`**: Ejecutado empíricamente mediante baterías automatizadas de pruebas en Durán (`npm test`, `npm run test:product`, `npm run test:security`, `python -m unittest`) con resultado PASS reproducible y trazable.
4. **`PENDIENTE` / `NOT RUN`**: Requiere ejecución o validación sobre infraestructura física real (hardware Teselia Chromebook PID 11085 aislado por seguridad, o modpack live en servidor dedicado).

---

## 2. Auditoría Correctiva de los 7 Bloqueantes Resueltos

### Bloqueante 1: Dashboard — Bootstrap Seguro con PIN y Estado Honesto de P0
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (11/11 PASS en `v1_1_web_dashboard.test.js`).
- **Solución técnica implementada:**
  - `companion/src/web/server.js`:
    - Eliminada la inyección de token en texto claro en `index.html`. El placeholder `__GUIAIA_BOOTSTRAP_TOKEN__` se sustituye por `""`.
    - Generación de PIN de emparejamiento efímero de 6 dígitos (`crypto.randomInt(100000, 999999)`).
    - Endpoint no autenticado `POST /api/session/pair`: valida el PIN contra `timingSafeEqualStr` y, tras el primer éxito, lo invalida de forma irrevocable (`pinUsed = true`) previniendo ataques de repetición.
    - Parada P0 honesta: `/api/emergency-stop` devuelve estrictamente `remoteConfirmed: Boolean(result?.remoteConfirmed === true)` (`false` en paradas puramente locales).
  - `companion/src/web/public/index.html` y `style.css`:
    - Añadido diálogo modal accesible `#pairing-overlay` con formulario de PIN y feedback visual (`.modal-overlay`, `.modal-dialog`).
  - `companion/src/web/public/app.js`:
    - Gestión de flujo de emparejamiento por PIN, persistencia en `sessionStorage` y visualización honesta en cabecera: `PARADA LOCAL (SIN TESTIGO REMOTO)`.

### Bloqueante 2: Cobblemon — Capturas Seguras sin Lanzamientos a Ciegas
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (10/10 PASS en `v1_1_cobblemon_full.test.js`).
- **Solución técnica implementada:**
  - `companion/src/cobblemon_capture.js`:
    - Función de validación de origen: `verifyCaptureEvent(event, expected)` que comprueba canal (`cobblemon:capture_result`), `targetId`, `sequence` y código de resultado inequívoco (`captured` vs `escaped`).
    - Comprobación previa al lanzamiento (*pre-throw check*): si no existe canal de paquetes activo (`bot._client.on`) ni tracker explícito, el bot **NO lanza la Poké Ball** y devuelve `{ ok: false, status: 'blocked', reason: 'no_tracking_channel', throwsUsed: 0 }`.
    - Supresión de relanzamientos ciegos: ante resultado desconocido o fallo de confirmación, se detiene inmediatamente con `{ ok: false, status: 'uncertain', reason: 'unverified_server_response' }`.

### Bloqueante 3: Cobblemon — PC y Batallas con Fuente Auténtica del Servidor
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (10/10 PASS en `v1_1_cobblemon_full.test.js`).
- **Solución técnica implementada:**
  - `companion/src/cobblemon_pc.js`:
    - Añadido `verifyServerStoragePacket(packet, expectedPlayerUuid)` e `ingestServerStoragePacket(packet)`.
    - Eliminado el atajo sintético `options.serverAttested: true`.
    - Falla de forma cerrada con `{ ok: false, status: 'blocked', reason: 'unverified_server_source_of_truth' }` si los datos del servidor no han sido autenticados.
  - `companion/src/cobblemon_battle.js`:
    - Añadido `verifyServerBattlePacket(packet, expected)` para canales `cobblemon:battle_start` / `cobblemon:battle_init`.
    - `challengeWild` requiere confirmación verificable mediante paquete del servidor; de lo contrario aborta con `status: 'blocked', reason: 'unverified_server_source_of_truth'`.

### Bloqueante 4: Construcción — Diario Durable, Vinculación Exacta y Cancelación
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (16/16 PASS en `v1_1_blueprint_builder.test.js`).
- **Solución técnica implementada:**
  - `companion/src/blueprint_builder.js`:
    - Persistencia durable del diario en disco: `writeDurableJournal(journalPath, journalData)` mediante escritura temporal atómica y sincronizada (`fs.writeFileSync` + `fs.renameSync`).
    - Recuperación estructural: `recoverBuildJournal(journalPath)`.
    - Vinculación estricta de la autorización (`grant`): validación exacta de `blueprintId`, coordenadas de `origin`, presupuesto máximo de bloques (`grant.maxBlocks`, denegando upfront si `blocks.length > maxBlocks`) y hash de integridad SHA-256 (`grant.blueprintSha256`).
    - Cancelación continua: verificación de `isCancelled?.()` o señal de aborto antes de **cada bloque individual**.
    - Verificación física en el mundo: comprobación post-colocación mediante `bot.blockAt(worldTarget).name === b.block`.
    - Falla cerrada ante bloques no verificados: si `failedBlocks.length > 0`, devuelve `{ ok: false, status: 'partial_failure' }` y nunca declara éxito.

### Bloqueante 5: Crafteo — Diario Durable, Estaciones Físicas y No Repetición Incierta
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (14/14 PASS en `v1_1_crafting_planner.test.js`).
- **Solución técnica implementada:**
  - `companion/src/crafting_planner.js`:
    - Persistencia durable del diario en disco: `writeDurableCraftJournal(journalPath, journalData)` y función de recuperación `recoverCraftJournal(journalPath)`.
    - Reanudación tras caídas: si se aporta un diario previo, omite los pasos ya ejecutados (`step.step_index >= journal.completedSteps`).
    - Detención inmediata ante resultados inciertos: si la variación de inventario tras `bot.craft` es $\le 0$, se registra inmediatamente `status: 'needs_review', reason: 'uncertain_inventory_delta'` en disco y se detiene la ejecución sin reintentos ciegos.
    - Estaciones físicas: resolución de mesa de trabajo cercana o colocación en el mundo si está en inventario; fallo cerrado si no existe estación disponible.

### Bloqueante 6: Testigo Multi-Host — Ciclo de Vida, Custodia y Recuperación
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (11/11 PASS en `v1_1_remote_witness.test.js`). Hardware físico: `NOT RUN`.
- **Solución técnica implementada:**
  - `companion/src/remote_witness_client.js`:
    - Validación de esquema de configuración: `validateRemoteWitnessConfig(config)` (protocolos HTTP/HTTPS, claves Ed25519, `worldId`, plazos acotados).
    - Verificación de custodia activa: `verifyRemoteCustody(client, localCheckpoint, options)` con cota máxima de deriva de reloj (máx. 2000 ms) y atestación de secuencia monótona.
  - `companion/test/v1_1_remote_witness.test.js`:
    - Prueba integral de recuperación ante desastres en servidor local efímero: conexión -> avance de secuencia -> caída total del servidor -> fallo cerrado determinista (`RemoteWitnessUnavailableError`) -> reinicio del servidor con almacenamiento persistido restaurado -> reconexión del cliente -> sincronización de marca de agua y avance seguro a secuencia siguiente.
    - Aserción explícita de seguridad: hardware físico Teselia Chromebook PID 11085 aislado y registrado como `NOT RUN`.

### Bloqueante 7: QA de Producto — Matriz Multinivel A/B/C/D
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE` (16/16 PASS en `v1_1_product_qa_matrix.test.js`).
- **Estructura de la suite:**
  - **Nivel A (Código y Esquemas):** Integridad de esquemas JSON, orden topológico de blueprints, planificador DAG de crafteo y esquemas de configuración.
  - **Nivel B (Integración y Resiliencia):** Recuperación de diarios de crafteo y construcción tras crash, parada de emergencia P0 y fail-closed del testigo remoto ante caída de servicio.
  - **Nivel C (Minecraft Real / Desechable Aislado):** Handshake de seguimiento de captura Cobblemon, paquete auténtico de combate en servidor desechable y verificación de estado físico en el mundo.
  - **Nivel D (Producto y Operador Seguro):** Bootstrap con PIN, ausencia de token en HTML inicial, autenticación de emparejamiento por PIN y reporte honesto de P0 (`remoteConfirmed: false`).
  - **Estado de Hardware:** Documentación estructurada de plataformas (Durán PASS, Teselia NOT RUN).

---

## 3. Matriz Integral de Resultados de Pruebas

| Suite | Comando | Total Tests | PASS | FAIL | SKIP (Windows NTFS) | NOT RUN (Teselia físico) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Node: Producto V1/V1.1** | `npm run test:product` | 144 | **144** | 0 | 0 | 0 |
| **Node: Seguridad e Integridad** | `npm run test:security` | 205 | **205** | 0 | 0 | 0 |
| **Node: Batería General** | `npm test` | 536 | **529** | 0 | **7** | 0 |
| **Python: Esquemas y Sandboxes** | `python -m unittest` | 66 | **66** | 0 | 0 | 0 |
| **Laboratorio Multi-Host Físico** | *Aislado por seguridad* | N/A | 0 | 0 | 0 | **NOT RUN (Chromebook 11085)** |
| **Total Global Automatizado** | — | **602** | **595** | **0** | **7** | **1 (Hardware físico)** |

*Detalle de los 7 SKIPs en Windows:*
Pertenecen a verificaciones de permisos POSIX/Linux (`chmod 0700`, paths `/home/`) en `qa_floor_custodian.test.js`, `qa_high_water_contract.test.js`, `qa_physical_witness_fixture.test.js` y `qa_physical_witness_preflight.test.js`, diseñadas para ejecutarse en CI Linux.

---

## 4. Estado de Git y Directivas de Seguridad

- **Rama:** `main`
- **Árbol de trabajo:** Limpio, probado y listo para checkpoint técnico local.
- **Acciones prohibidas estrictas:**
  - NO realizar `git push` a `origin/main` ni a ninguna rama remota.
  - NO crear tags de versión final ni publicar release.
  - NO ejecutar comandos prohibidos (`taskkill /IM`, `taskkill /FI`).
  - NO conectar al hardware físico de Chromebook Teselia PID 11085.
