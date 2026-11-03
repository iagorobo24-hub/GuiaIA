# GuiaIA V1.1 — Estado de Sesión y Matriz de Estabilización Correctiva (V1_1_SESSION_STATE)

> **Última actualización:** 3 de noviembre de 2026 (Cierre de Integración Real en Durán, Protocolo Cobblemon 1.8.2 Canónico, Misiones E2E y Persistencia Duradera)  
> **Estación de trabajo:** `DURÁN` (Windows 11, x86_64)  
> **Workspace activo:** `C:\Users\iagui\AI Projects\GuiaIA` (Junction `D:\AI Projects D\03_PLATAFORMA_AGENTICA\GuiaIA`)  
> **Rama activa:** `main`  
> **Commit base V1.0.0:** `4b3e917674a889eaf251a79efb5c441349983459` (Tag `v1.0.0`)  
> **Commit previo:** `9ed8971`  
> **Protección de infraestructura:** Servidor Teselia / Chromebook (PID 11085) protegido e intacto. Sin conexiones no autorizadas.  
> **Directiva de Gobernanza:** **NO PUSH, NO MERGE, NO TAG NI PUBLICACIÓN DE RELEASE SIN AUTORIZACIÓN EXPRESA DEL USUARIO**. Todo el trabajo se conserva en commits locales verificados en Durán.

---

## 1. Taxonomía Técnica de Aceptación (Criterio de Verdad Absoluta)

Para garantizar honestidad técnica total y erradicar cualquier afirmación sintética o no demostrada, los componentes y suites se clasifican bajo la siguiente taxonomía:

1. **`PASS REAL MINECRAFT`**: Verificado empíricamente contra un servidor dedicado Minecraft Java 1.21.1 + Fabric + Cobblemon 1.8.2 en ejecución real sobre loopback en Durán. Requiere conexión de red de bots Mineflayer, intercambio auténtico de paquetes de protocolo, crafteo físico con actualización de ranuras, minado de bloques y confirmación de aire en coordenadas del mundo, colocación física de bloques de blueprint, escaneo de radar de entidades Cobblemon reales y verificación bidireccional de inventario.
2. **`PASS REAL SISTEMA`**: Verificado empíricamente con primitivas y subsistemas reales del sistema operativo (NTFS/POSIX, `fs.fsyncSync` a nivel de archivo y descriptor de directorio, criptografía asimétrica Ed25519, procesos OS independientes bifurcados vía `child_process.fork`, servidores HTTP/SSE en loopback y servidores REST).
3. **`PASS SIMULADO`**: Verificado funcionalmente mediante lógica de adaptador con bots simulados (`mockBot`), paquetes sintéticos inyectados o mundos simulados en memoria (`Map`). **Nunca se denomina a esto "Minecraft real"**.
4. **`NOT RUN`**: Pruebas que requieren infraestructura externa aislada por reglas de seguridad obligatorias:
   - *Testigo Remoto Físico en Chromebook Teselia:* `NOT RUN (Hardware físico aislado según reglas de seguridad)`.
5. **`FAIL`**: Comportamiento anómalo, regresión o aserción no satisfecha (Actualmente: **0 FAIL** en todo el proyecto).
6. **`SKIP`**: Omitido justificadamente por incompatibilidad de plataforma (ej. pruebas exclusivas de permisos POSIX `chmod 0700` ejecutadas en Windows).

---

## 2. Resoluciones de las 5 Prioridades Críticas

### Prioridad 1: Laboratorio Minecraft Real en Durán
- **Implementación:** `scripts/qa_v1_1_real_minecraft_server.py`.
- **Arquitectura:**
  - Descarga y aprovisionamiento autónomo en directorio temporal aislado de Adoptium JRE 21, Fabric Launcher 1.0.1, Minecraft Server 1.21.1, Fabric API 0.102.0+1.21.1 y Cobblemon 1.8.2.
  - Generación automática de `server.properties` (puerto loopback 25595, modo offline, vista pacífica, mundo plano).
  - Bridge de comandos HTTP local seguro en puerto 25599 (`POST /cmd`) para orquestación de pruebas.
  - Preparación de terreno (`fill -10 63 -10 20 63 20 minecraft:stone`), spawn seguro en `(2, 64, 2)` y congelación de ciclo solar.
  - Ciclo de vida estricto con apagado graceful (`stop`) y limpieza de puertos mediante terminación específica por PID.

### Prioridad 2: Protocolo Auténtico de Cobblemon 1.8.2
- **Implementación:** `companion/src/cobblemon_protocol.js`.
- **Estructura y Clasificación de Canales:**
  - **Canales Canónicos Oficiales de Cobblemon 1.8.2:**
    - Capturas: `cobblemon:battle_capture_start`, `cobblemon:battle_capture_shake`, `cobblemon:battle_capture_end`.
    - Combates: `cobblemon:battle_challenge`, `cobblemon:battle_challenge_response`, `cobblemon:battle_initialize`, `cobblemon:battle_select_actions`, `cobblemon:battle_end`.
    - PC / Almacenamiento: `cobblemon:open_pc`, `cobblemon:initialize_pc`, `cobblemon:set_pc_box`, `cobblemon:move_party_pokemon_to_pc`, `cobblemon:move_pc_pokemon_to_party`.
  - **Canales de Adaptador GuiaIA:**
    - `guiaia:cobblemon_action`, `guiaia:cobblemon_result`, `guiaia:cobblemon_obs`.
  - **Canales Sintéticos Históricos (Legacy):**
    - Marcados estrictamente con procedencia `PROVENANCE.LEGACY_SIMULATED`.
- **Verificadores y Constructores:**
  - `classifyChannel(channel)`: Clasifica procedencia canónica vs puente GuiaIA vs legacy.
  - `verifyCaptureEvent`, `verifyServerBattlePacket`, `verifyServerStoragePacket`: Verifican origen, estructura, tipos de datos y secuencia sin asumir atestaciones criptográficas irreales.
  - Adaptadores actualizados: `cobblemon_capture.js`, `cobblemon_battle.js`, `cobblemon_pc.js`, `cobblemon_adapter.js`.

### Prioridad 3: Misiones End-to-End Verificadas en Minecraft Real
- **Implementación:** `companion/test/qa_v1_1_real_minecraft_e2e.js`.
- **Evidencias Empíricas de las 7 Misiones (`PASS REAL MINECRAFT`):**
  1. **Misión A (Chained Tool Crafting):**
     - Planificación DAG óptima: `oak_log (8)` -> `oak_planks (12)` -> `stick (4)` -> `crafting_table (1)` -> colocación física adyacente de la mesa de crafteo -> `wooden_pickaxe (1)`.
     - Resolución de sincronización de `stateId` de Minecraft 1.21.1: ejecución paso a paso con ventana de asentamiento de paquetes e interceptor para ranura de cursor `windowId: 255`.
     - Verificación física de inventario: `wooden_pickaxe` existente y confirmado en el inventario real del bot.
  2. **Misión B (Resource Gathering & Block Digging):**
     - Colocación de bloque de piedra en `(4, 64, 4)`. Equipamiento de la `wooden_pickaxe` elaborada en Misión A.
     - Minado físico con `bot.dig(stoneBlock)`.
     - Confirmación de estado del mundo: `bot.blockAt(pos).name === 'air'` tras el minado. Recolección de 4 `cobblestone` en inventario.
  3. **Misión C (Blueprint Structure Placement):**
     - Blueprint de muro de 3 bloques de `cobblestone` con origen en `(3, 64, 5)`.
     - Pre-flight preview autorizado por concesión de sesión.
     - Colocación física secuencial con verificación de soporte y dirección de cara.
     - Verificación física del mundo: `bot.blockAt(worldP).name === 'cobblestone'` para los 3 bloques en el mundo real.
     - Registro duradero en disco (`build_journal`).
  4. **Misión D (Cobblemon Live Entity Radar Observation):**
     - Invocación de entidad real: `/summon cobblemon:pokemon 6 64 2 {species:"pikachu",level:25}`.
     - Escaneo por radar pasivo a 24m (`scanNearbyPokemon`).
     - Detección confirmada: Entidad ID 21 a 16.1m de distancia.
  5. **Misión E (P0 Emergency Stop Mid-Flight):**
     - Bot en movimiento hacia meta lejana `(15, 64, 15)` con `mineflayer-pathfinder`.
     - Disparo de parada de emergencia P0: `controller.stop('p0_emergency_stop')`.
     - Cancelación inmediata: pathfinder limpiado, control states restablecidos a cero y modo fijado en `idle`.
  6. **Misión F (Crash/Disconnect Recovery Without Replay):**
     - Reconciliación física del diario de construcción frente al mundo real (`reconcileBuildJournal`).
     - Verificación de bloques colocados intactos; sin repetición de colocaciones ni doble gasto de materiales.
  7. **Misión G (Web Dashboard REST API Dispatch):**
     - Servidor dashboard local en puerto efímero con token de sesión en memoria.
     - `GET /api/status` responde HTTP 200 con telemetría en vivo del bot `GuiaIA_QA`.
     - `POST /api/emergency-stop` responde HTTP 200 con `localHalted: true`.

### Prioridad 4: Persistencia y Testigo Distribuido
- **Implementación:** `crafting_planner.js`, `blueprint_builder.js`, `remote_witness_client.js`, `remote_witness_server.js`.
- **Garantías de Durabilidad y Prevención de Rollback:**
  - `fs.fsyncSync(fd)` aplicado tanto al archivo de diario como al descriptor del directorio contenedor (`fs.openSync(dir, 'r')`).
  - Escritura temporal atómica + `fs.renameSync` + preservación de copia `.bak`.
  - Sobre protector con checksum SHA-256 (`guiaia_durable_craft_journal_v1` / `guiaia_durable_build_journal_v1`).
  - Detección activa de regresión de secuencia: si un respaldo `.bak` o diario restaurado presenta un `sequence` o `completedSteps` inferior al máximo presenciado en la sesión (`highWaterSequence`), la recuperación falla cerrado con `{ ok: false, reason: 'ROLLBACK_DETECTED' }`.
  - Testigo remoto ejecutado en dos procesos reales de sistema operativo (`child_process.fork`), con key pinning Ed25519, custodia estricta y prueba de caída y recuperación.

### Prioridad 5: Matriz de Aceptación Integral y Estado de Suites
- **`npm run test:product`**: **161 PASS, 1 SKIPPED (Teselia multi-host), 0 FAIL**.
- **`npm run test:security`**: **205/205 PASS, 0 FAIL**.
- **`companion/test/v1_1_product_qa_matrix.test.js`**: **18 PASS, 1 SKIPPED, 0 FAIL**.
- **`companion/test/v1_1_cobblemon_protocol.test.js`**: **5/5 PASS, 0 FAIL**.
- **`companion/test/v1_1_cobblemon_full.test.js`**: **10/10 PASS, 0 FAIL**.
- **`companion/test/v1_1_persistence_rollback.test.js`**: **3/3 PASS, 0 FAIL**.
- **`companion/test/v1_1_remote_witness.test.js`**: **12/12 PASS, 0 FAIL**.
- **`scripts/qa_v1_1_real_minecraft_server.py` (Misiones A-G)**: **7/7 PASS REAL MINECRAFT, 0 FAIL**.

---

## 3. Matriz de Cobertura y Taxonomía Final

| Componente / Capacidad | Suite / Script | Clasificación Taxonómica | Evidencia de Ejecución |
| :--- | :--- | :--- | :--- |
| **Crafteo Encadenado DAG en Minecraft Real** | `qa_v1_1_real_minecraft_e2e.js` (Misión A) | `PASS REAL MINECRAFT` | `wooden_pickaxe` fabricada y verificada en inventario |
| **Minado Físico y Caída de Recursos** | `qa_v1_1_real_minecraft_e2e.js` (Misión B) | `PASS REAL MINECRAFT` | Piedra minada, aire en mundo, 4 cobblestone en inventario |
| **Construcción de Blueprint en Minecraft Real** | `qa_v1_1_real_minecraft_e2e.js` (Misión C) | `PASS REAL MINECRAFT` | 3 bloques de muro colocados y verificados en mundo físico |
| **Observación Radar Cobblemon Real** | `qa_v1_1_real_minecraft_e2e.js` (Misión D) | `PASS REAL MINECRAFT` | Pikachu nivel 25 detectado a 16.1m por escaneo de entidades |
| **Parada de Emergencia P0 en Vuelo** | `qa_v1_1_real_minecraft_e2e.js` (Misión E) | `PASS REAL MINECRAFT` | Movimiento abortado en vuelo, modo reset a `idle` |
| **Recuperación de Caída sin Repetición** | `qa_v1_1_real_minecraft_e2e.js` (Misión F) | `PASS REAL MINECRAFT` | Diario reconciliado contra mundo, sin acciones duplicadas |
| **Dashboard REST API en Loopback** | `qa_v1_1_real_minecraft_e2e.js` (Misión G) | `PASS REAL SISTEMA` | Endpoints `/api/status` y `/api/emergency-stop` HTTP 200 |
| **Contratos, Esquemas y Criptografía Ed25519** | `v1_1_product_qa_matrix.test.js` (Nivel A) | `PASS REAL SISTEMA` | Schemas JSON, Ed25519 signing/verification |
| **Persistencia fsync y Checksum SHA-256** | `v1_1_product_qa_matrix.test.js` (Nivel B) | `PASS REAL SISTEMA` | Diarios sobreviven reinicio con fsync de archivo y dir |
| **Prevención de Regresión de Secuencia** | `v1_1_persistence_rollback.test.js` | `PASS REAL SISTEMA` | Rechazo con `ROLLBACK_DETECTED` ante rollback de backup |
| **Testigo Remoto en 2 Procesos OS** | `v1_1_remote_witness.test.js` | `PASS REAL SISTEMA` | Child process fork, caída forzada, fail-closed y recuperación |
| **Dashboard PIN TTL, Bloqueo y CSP** | `v1_1_web_dashboard.test.js` | `PASS REAL SISTEMA` | TTL 5 min, 3 intentos -> bloqueo permanente HTTP 403 |
| **Protocolo Canónico Cobblemon 1.8.2** | `v1_1_cobblemon_protocol.test.js` | `PASS REAL SISTEMA` | Clasificación de canales canónicos vs puente vs legacy |
| **Adaptadores Cobblemon (Captura, Batalla, PC)** | `v1_1_cobblemon_full.test.js` | `PASS SIMULADO` | Handshake simulado, validación de procedencia de canal |
| **Testigo en Chromebook Teselia** | `v1_1_product_qa_matrix.test.js` (Nivel D) | `NOT RUN` | Aislado estrictamente por regla de seguridad obligatoria |
| **Batería Integral de Seguridad V1** | `npm run test:security` | `PASS REAL SISTEMA` | 205/205 pruebas verdes sin skips injustificados |
| **Batería Integral de Producto V1/V1.1** | `npm run test:product` | `PASS REAL SISTEMA` | 161/161 pruebas verdes (1 skip justificado Teselia) |

---

## 4. Estado de Git y Siguientes Pasos Autorizados

- Todos los cambios se mantienen en el repositorio local de Durán (`C:\Users\iagui\AI Projects\GuiaIA`).
- Ningún commit ha sido empujado (`push`), fusionado (`merge`) ni publicado.
- El repositorio está listo para consolidar el commit local de cierre de estabilización e integración real V1.1.
