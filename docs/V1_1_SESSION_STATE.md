# GuiaIA V1.1 — Estado de Sesión y Matriz de Estabilización Correctiva (V1_1_SESSION_STATE)

> **Última actualización:** 3 de noviembre de 2026 (Auditoría Correctiva, Integración y Estabilización)  
> **Estación de trabajo:** `DURÁN` (Windows 11, x86_64)  
> **Workspace activo:** `C:\Users\iagui\AI Projects\GuiaIA` (Junction `D:\AI Projects D\03_PLATAFORMA_AGENTICA\GuiaIA`)  
> **Rama activa:** `main`  
> **Commit base V1.0.0:** `4b3e917674a889eaf251a79efb5c441349983459` (Tag `v1.0.0`)  
> **Protección de infraestructura:** Servidor Teselia / Chromebook (PID 11085) protegido e intacto. Sin conexiones no autorizadas.  
> **Directiva de Cierre:** **NO DECLARAR V1.1 CERRADO NI PUBLICADO**. Pendiente de validación en infraestructura física multi-host y modpack real.

---

## 1. Taxonomía de Estado y Criterio de Verdad

Para garantizar máxima honestidad técnica y evitar confirmaciones sintéticas o declaraciones de éxito prematuras, todo componente de GuiaIA V1.1 se clasifica bajo cuatro estados inequívocos:

1. **`IMPLEMENTADO`**: Código fuente original, esquemas JSON y contratos tipados presentes en el árbol de trabajo del repositorio.
2. **`SIMULADO`**: Verificado funcionalmente mediante arneses de prueba unitaria, entidades mock y entornos en memoria sin conexión a servidor físico.
3. **`VERIFICADO REALMENTE`**: Ejecutado empíricamente mediante baterías automatizadas de pruebas en Durán (`npm test`, `npm run test:product`, `npm run test:security`, `pytest`, `npm ci`) con resultado PASS reproducible y trazable.
4. **`PENDIENTE`**: Requiere ejecución o validación sobre infraestructura física real (servidor Cobblemon 1.8.2 en ejecución con modpack Fabric live, o conexión multi-host vía Tailscale al hardware de Teselia).

---

## 2. Auditoría Correctiva de los 8 Ejes Prioritarios

### Eje 1: Cobblemon — Eliminación de Confirmaciones Ficticias y Bloqueo Fail-Closed
- **Estado:** `IMPLEMENTADO` + `SIMULADO` + `VERIFICADO REALMENTE` (Pruebas unitarias y de arnés 10/10 PASS). Servidor Cobblemon real: `PENDIENTE`.
- **Correcciones aplicadas:**
  - `companion/src/cobblemon_capture.js`: Eliminado el atajo sintético `captured = true`. Sin un paquete genuino del servidor o confirmación criptográfica atestada, la captura falla de forma cerrada devolviendo `{ ok: false, status: 'blocked', reason: 'unverified_protocol_packet', captured: false }`.
  - `companion/src/cobblemon_pc.js`: Eliminado el generador ficticio de Pokémon en memoria (`boxes = new Map()`, `'sample_pokemon'`). El controlador del PC exige datos atestados del servidor (`serverAttested: true` o carga NBT de red). Sin dicha atestación, cualquier consulta o transferencia queda bloqueada con `status: 'blocked'`.
  - `companion/src/cobblemon_battle.js`: Eliminada la transición instantánea a combate. `challengeWild` requiere confirmación de handshake del servidor (`serverConfirmation` o `onChallenge` positivo). Sin ella, la FSM revierte a `idle` y bloquea la acción con `status: 'blocked'`.
  - `companion/test/v1_1_cobblemon_full.test.js`: Actualizado con aserciones negativas fail-closed y aserciones positivas con datos atestados.

### Eje 2: Construcción — Contabilización Exacta, Colisiones y Previsualización
- **Estado:** `IMPLEMENTADO` + `SIMULADO` + `VERIFICADO REALMENTE` (12/12 PASS).
- **Correcciones aplicadas:**
  - `companion/src/blueprint_builder.js`:
    - **Contabilización:** Los bloques que ya coinciden en el mundo con el objetivo no incrementan `totalPlaced` ni `batchPlaced`; se registran como `skippedExisting` y se documentan en `totalSkippedExisting`.
    - **Verificación en el Mundo:** Tras la llamada a `bot.placeBlock`, se efectúa una comprobación posterior obligatoria con `bot.blockAt(worldTarget)`. Solo si el bloque coincide con el objetivo se contabiliza como colocado.
    - **Colisiones Reales:** La presencia de bloques no-aire distintos al objetivo en el volumen de construcción detiene la ejecución inmediatamente con `{ ok: false, reason: 'world_collision', conflict: ... }`.
    - **Previsualización Obligatoria:** Si no se aporta previsualización y autorización previa (`previewAuthorized` / `previewConfirmed`), el constructor deniega la mutación física con `{ ok: false, status: 'preview_required', reason: 'preview_authorization_required' }`.
    - **Diario de Construcción:** Estructurado diario recuperable write-ahead (`journal`) con estados `in_progress`, `completed`, `cancelled` y `failed`.
  - `companion/test/v1_1_blueprint_builder.test.js`: Verificadas pruebas de colisión, previsualización forzosa, salto de bloques existentes y estabilidad de gravedad.

### Eje 3: Dashboard Web — Eliminación de Tokens en URL y Pruebas Negativas
- **Estado:** `IMPLEMENTADO` + `SIMULADO` + `VERIFICADO REALMENTE` (10/10 PASS).
- **Correcciones aplicadas:**
  - `companion/src/web/server.js`:
    - Eliminado por completo el soporte de tokens en parámetros de consulta (`?token=...`).
    - Toda solicitud entrante que contenga `token` en la URL o query string es rechazada inmediatamente con **HTTP 400 Bad Request** (`Token in URL query parameters strictly forbidden`).
    - El canal SSE `/api/events` exige autenticación vía cabecera `Authorization: Bearer <token>`.
    - Rechazo de cuerpos de solicitud sobredimensionados (>8 KB en `/api/action`) con **HTTP 413 Payload Too Large**.
    - Pruebas negativas reales verificadas para DNS Rebinding (HTTP 403 ante Host externo), CSRF (HTTP 403 ante Origin externo o Sec-Fetch-Site cross-site), Rate Limiting (HTTP 429) y Directory Traversal (HTTP 403/404).
  - `companion/src/web/public/app.js`:
    - Eliminada la lectura de tokens desde `window.location.search`. El token se obtiene exclusivamente de la etiqueta `<meta name="guiaia-token">` inyectada en servidor.
    - La suscripción SSE se realiza mediante `fetch('/api/events')` con cabecera `Authorization` y decodificación de `ReadableStream`, eliminando el token de los registros de red y del historial del navegador.

### Eje 4: Testigo Distribuido — Conexión Real al Runtime y Política Fail-Closed
- **Estado:** `IMPLEMENTADO` + `SIMULADO` + `VERIFICADO REALMENTE` (8/8 PASS). Red física Tailscale multi-host: `PENDIENTE`.
- **Correcciones aplicadas:**
  - `companion/src/secure_companion_controller.js`:
    - Conectado `authority.remoteWitnessClient` directamente en el punto neurálgico de autorización `freshActionAuthority`.
    - Cuando `authority.multiHostEnabled === true`, toda acción que modifique el mundo (`gather`, `deposit`, `craft`, `build`, `pokemonAction`) ejecuta obligatoriamente `remoteWitnessClient.verifyConsistency(localCheckpoint)`.
    - Ante caída del servicio de testigo, timeout (deadline de 2000 ms), regresión de secuencia o divergencia de hash criptográfico, el sistema dispara `RemoteWitnessUnavailableError`, `RemoteWitnessRollbackError` o `RemoteWitnessDivergenceError` y **aborta de forma cerrada sin fallback local silencioso**.
  - `companion/test/v1_1_remote_witness.test.js`: Añadido test de integración end-to-end con el controlador en runtime demostrando que las acciones se bloquean de forma determinista ante el fallo del testigo remoto.

### Eje 5: Crafteo y Misiones — Estaciones Físicas, Deltas de Dos Caras y Persistencia
- **Estado:** `IMPLEMENTADO` + `SIMULADO` + `VERIFICADO REALMENTE` (11/11 PASS).
- **Correcciones aplicadas:**
  - `companion/src/crafting_planner.js`:
    - **Estaciones Físicas:** Si una receta 3x3 requiere mesa de crafteo y no hay ninguna en el entorno inmediato, el bot comprueba si posee un bloque `crafting_table` en inventario, busca un bloque de apoyo, lo equipa y lo coloca físicamente antes de proceder. Si no dispone de estación, falla de forma cerrada.
    - **Verificación de Dos Caras:** Se comprueba el inventario antes y después de cada paso. Es mandatorio tanto el incremento del producto final ($\Delta_{\text{output}} \ge 1$) como la disminución efectiva de cada ingrediente consumido ($\Delta_{\text{consumed}} \ge 1$).
    - **Persistencia y Cancelación:** Incorporado diario de misión (`journal`) con soporte para cancelación por operador (`isCancelled`) que produce un estado de misión recuperable e inspeccionable.
  - `companion/test/v1_1_crafting_planner.test.js`: Verificadas pruebas de verificación de dos caras, colocación física de estación y cancelación con persistencia.

### Eje 6: Dependencias y Reproducibilidad
- **Estado:** `VERIFICADO REALMENTE`.
- **Evidencia:**
  - `minecraft-data: 3.119.0` y `prismarine-nbt: 2.8.0` declaradas en `companion/package.json`.
  - `companion/package-lock.json` sincronizado limpiamente.
  - Verificación `npm ci` ejecutada con éxito (Exit Code 0, 92 paquetes instalados sin discrepancias de árbol).

### Eje 7: Matriz Integral de Pruebas (PASS / FAIL / SKIP / PENDIENTE)
- **Estado:** `VERIFICADO REALMENTE`.
- **Resultados consolidados en Durán:**

| Suite | Comando | Total Tests | PASS | FAIL | SKIP | PENDIENTE (Multi-Host físico) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| **Node: Producto V1/V1.1** | `npm run test:product` | 117 | **117** | 0 | 0 | 0 |
| **Node: Seguridad e Integridad** | `npm run test:security` | 205 | **205** | 0 | 0 | 0 |
| **Node: Batería General** | `npm test` | 509 | **502** | 0 | **7** (POSIX Linux) | 0 |
| **Python: Esquemas y Sandboxes** | `python -m pytest` | 66 | **66** | 0 | 0 | 0 |
| **Laboratorio Multi-Host Físico** | *N/A (Chromebook Teselia)* | N/A | 0 | 0 | 0 | **PENDIENTE (Bloqueado por seguridad)** |
| **Total Automatizado Local** | — | **575** | **568** | **0** | **7** | **PENDIENTE** |

*Nota sobre los 7 SKIPs:* Pertenecen exclusivamente a verificaciones específicas de permisos de sistema de archivos POSIX/Linux (`qa_floor_custodian.test.js`, `qa_high_water_contract.test.js`, `qa_physical_witness_fixture.test.js`, `qa_physical_witness_preflight.test.js`) que requieren llamadas nativas `chmod` y rutas absolutas `/home/`, diseñadas para ejecutarse en CI Linux. En Windows se saltan de manera explícita y justificada sin degradar aserciones.

### Eje 8: Integración Real y Verificaciones Pendientes
- **Pruebas en Servidores Desechables (Niveles A/B/C/D del Plan Maestro):**
  - **Nivel A (Loopback Vanilla sin servidor):** `VERIFICADO REALMENTE` (100% verde en suites automatizadas).
  - **Nivel B (Servidor Minecraft desechable local):** `IMPLEMENTADO`, arneses de conexión listos.
  - **Nivel C (Servidor Fabric + Cobblemon 1.8.2 live):** `IMPLEMENTADO`, adaptador y cliente listos; verificación de paquetes custom_payload en servidor real: `PENDIENTE`.
  - **Nivel D (Multi-host distribuido vía Tailscale con hardware Teselia):** `IMPLEMENTADO` a nivel de cliente fail-closed; despliegue físico y prueba de canal en vivo: `PENDIENTE`.

---

## 3. Matriz Detallada de Componentes V1.1

| Componente | Fichero Principal | Estado Técnico | Evidencia de Verificación |
| :--- | :--- | :---: | :--- |
| **Esquemas Canónicos V1.1** | `schemas/v1/*.json` | `IMPLEMENTADO` / `VERIFICADO REALMENTE` | 5 tests Node (`v1_1_schemas.test.js`) + 5 tests Python (`test_v1_1_schemas.py`) PASS |
| **Despacho y Nonces en Runtime** | `companion/src/session_identity.js`<br>`companion/src/secure_companion_controller.js` | `IMPLEMENTADO` / `VERIFICADO REALMENTE` | `v1_1_dispatcher.test.js` (8/8 PASS) |
| **Dashboard Web Local** | `companion/src/web/server.js`<br>`companion/src/web/public/app.js` | `IMPLEMENTADO` / `VERIFICADO REALMENTE` | `v1_1_web_dashboard.test.js` (10/10 PASS, pruebas negativas y Bearer streaming) |
| **Planificador de Crafteo DAG** | `companion/src/crafting_planner.js` | `IMPLEMENTADO` / `VERIFICADO REALMENTE` | `v1_1_crafting_planner.test.js` (11/11 PASS, 2-sided deltas y placement físico) |
| **Constructor por Blueprints** | `companion/src/blueprint_importer.js`<br>`companion/src/blueprint_builder.js` | `IMPLEMENTADO` / `VERIFICADO REALMENTE` | `v1_1_blueprint_builder.test.js` (12/12 PASS, colisiones y accounting real) |
| **Adaptador Cobblemon** | `companion/src/cobblemon_radar.js`<br>`companion/src/cobblemon_capture.js`<br>`companion/src/cobblemon_battle.js`<br>`companion/src/cobblemon_pc.js`<br>`companion/src/cobblemon_adapter.js` | `IMPLEMENTADO` / `SIMULADO` | `v1_1_cobblemon_full.test.js` (10/10 PASS, protocolo fail-closed sin mocks ficticios). Servidor live: `PENDIENTE`. |
| **Testigo Remoto Multi-Host** | `companion/src/remote_witness_client.js` | `IMPLEMENTADO` / `SIMULADO` | `v1_1_remote_witness.test.js` (8/8 PASS, corte y rollback fail-closed probados en controller). Hardware físico: `PENDIENTE`. |

---

## 4. Estado de Git y Próximos Pasos

- **Árbol de trabajo:** Limpio de procesos residuales, auditado y sincronizado.
- **Acciones NO autorizadas:** No realizar push, no hacer merge a ramas remotas, no crear tags de versión final ni publicar release.
- **Checkpoint local:** Permitido commit de punto de control técnico intermedio (ej. `chore(v1.1): checkpoint de auditoria correctiva y estabilizacion integral`).
