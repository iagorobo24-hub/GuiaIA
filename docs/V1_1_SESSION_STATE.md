# GuiaIA V1.1 — Estado de Sesión y Matriz de Estabilización Correctiva (V1_1_SESSION_STATE)

> **Última actualización:** 3 de noviembre de 2026 (Auditoría Correctiva, Integración Auténtica, Persistencia fsync y Taxonomía Honesta)  
> **Estación de trabajo:** `DURÁN` (Windows 11, x86_64)  
> **Workspace activo:** `C:\Users\iagui\AI Projects\GuiaIA` (Junction `D:\AI Projects D\03_PLATAFORMA_AGENTICA\GuiaIA`)  
> **Rama activa:** `main`  
> **Commit base V1.0.0:** `4b3e917674a889eaf251a79efb5c441349983459` (Tag `v1.0.0`)  
> **Commit previo:** `164d917` (Checkpoint de estabilización correctiva)  
> **Protección de infraestructura:** Servidor Teselia / Chromebook (PID 11085) protegido e intacto. Sin conexiones no autorizadas.  
> **Directiva de Cierre:** **NO DECLARAR V1.1 CERRADO NI PUBLICADO**. V1.1 continúa en desarrollo activo bajo gobernanza estricta.

---

## 1. Taxonomía de Aceptación y Criterio de Verdad (Honestidad Técnica Total)

Para garantizar máxima rigurosidad y evitar declaraciones de éxito prematuras o confirmaciones sintéticas, los componentes y pruebas se clasifican estrictamente bajo esta taxonomía:

1. **`PASS REAL`**: Verificado empíricamente con componentes del sistema operativo reales (sistema de archivos NTFS/POSIX, `fs.fsyncSync`, criptografía asimétrica Ed25519, servidor HTTP/SSE en loopback o procesos OS independientes bifurcados).
2. **`PASS SIMULADO`**: Verificado funcionalmente mediante lógica de adaptador con bots simulados (`mockBot`), paquetes de red sintéticos o mundos simulados en memoria (`Map`). **Bajo ninguna circunstancia se denomina a esto "Minecraft real"**.
3. **`NOT RUN`**: Pruebas que no pueden ejecutarse por ausencia de dependencias físicas o por reglas de seguridad obligatorias:
   - *Servidor Fabric 1.21.1 Live en Durán:* `NOT RUN (Sin launcher .jar en Durán)`.
   - *Testigo Remoto Físico en Chromebook Teselia:* `NOT RUN (Hardware físico aislado por reglas de seguridad)`.
4. **`FAIL`**: Comportamiento anómalo, regresión o aserción no satisfecha.
5. **`SKIP`**: Omitido justificadamente por incompatibilidad de plataforma (ej. pruebas exclusivas de permisos POSIX `chmod 0700` ejecutadas en Windows).

---

## 2. Auditoría Correctiva de los 7 Bloqueantes Resueltos

### Bloqueante 1: Matriz de Pruebas A/B/C/D y Nivel C Honesto
- **Estado:** `PASS SIMULADO` (Nivel C) / `PASS REAL` (Niveles A, B, D y Multi-Proceso) / `NOT RUN` (Live Server Durán y Teselia).
- **Corrección técnica:**
  - En `companion/test/v1_1_product_qa_matrix.test.js`:
    - Reclasificado el Nivel C como `Simulación de Protocolo y Adaptadores [PASS SIMULADO]`, documentando explícitamente que utiliza `mockBot`, paquetes sintéticos y mundos `Map` en memoria.
    - Separadas las ejecuciones reales (`[PASS REAL]` para contratos, persistencia con fsync y recuperación de caídas, dashboard con PIN y testigo de dos procesos OS).
    - Declarado explícitamente `[NOT RUN]` para el servidor live Fabric en Durán debido a la ausencia de launcher `.jar` local.

### Bloqueante 2: PC Pokémon — Confirmación Posterior y Eliminación de Almacenamiento Sintético
- **Estado:** `PASS SIMULADO` + `VERIFICADO REALMENTE` (10/10 PASS en `v1_1_cobblemon_full.test.js`).
- **Corrección técnica:**
  - En `companion/src/cobblemon_pc.js`:
    - Métodos `depositFromParty` y `withdrawToParty` convertidos en funciones asíncronas seguras.
    - Bloqueo inmediato fail-closed (`unverified_server_storage_channel`) si no existe canal de transporte de red activo (`bot._client` o `serverChannel`) ni paquete de confirmación posterior.
    - La memoria local de las cajas (`boxes.get(...)`) se actualiza **únicamente** tras la recepción y verificación del paquete auténtico del servidor que comprueba el estado resultante en la caja destino.
  - En `companion/src/cobblemon_adapter.js`:
    - Delegación asíncrona mediante `await` para depósitos y retiros.

### Bloqueante 3: Limpieza de Protocolo Cobblemon y Eliminación de Falsas Atestaciones Criptográficas
- **Estado:** `IMPLEMENTADO` + `VERIFICADO REALMENTE`.
- **Corrección técnica:**
  - Eliminado todo uso de "atestación criptográfica" referido a paquetes del juego Minecraft/Cobblemon, sustituyéndolo por "verificación de procedencia por canal de protocolo". La criptografía Ed25519 queda reservada estrictamente a concesiones de operador (`grants`) y testimonios de custodia (`witness tickets`).
  - Documentados los canales canónicos de Cobblemon 1.8.x:
    - `cobblemon:capture_result` (resultado de captura)
    - `cobblemon:battle_start`, `cobblemon:battle_init`, `cobblemon:battle_challenge` (combates)
    - `cobblemon:pc_data`, `cobblemon:storage_data`, `cobblemon:pc_action` (almacenamiento en PC)

### Bloqueante 4: Persistencia Durable de Diarios (`fsyncSync`, Checksum SHA-256 y Reconciliación)
- **Estado:** `PASS REAL` (18/18 PASS en `v1_1_blueprint_builder.test.js`, 16/16 PASS en `v1_1_crafting_planner.test.js`).
- **Corrección técnica:**
  - `companion/src/blueprint_builder.js` y `companion/src/crafting_planner.js`:
    - `writeDurableJournal` / `writeDurableCraftJournal`: envuelven el diario en un sobre con checksum SHA-256 (`guiaia_durable_build_journal_v1`), escriben en archivo temporal, ejecutan `fs.fsyncSync(fd)` para forzar el vaciado a soporte físico, generan copia de seguridad `.bak` y reemplazan atómicamente con `renameSync`.
    - `recoverBuildJournal` / `recoverCraftJournal`: verifican el hash SHA-256; si detectan corrupción por corte de energía o escritura parcial, recuperan automáticamente el estado previo desde `.bak`.
    - `reconcileBuildJournal` / `reconcileCraftJournal`: reconciliación física contra el mundo observado y el inventario tras caídas en vuelo (`in_progress`), marcando el estado como `needs_review` en lugar de permitir reanudaciones a ciegas.

### Bloqueante 5: Testigo Distribuido en el Ciclo de Vida Real y Despliegue en 2 Procesos OS
- **Estado:** `PASS REAL` (12/12 PASS en `v1_1_remote_witness.test.js`).
- **Corrección técnica:**
  - En `companion/src/cli_v1.js`:
    - Incorporados flags de línea de comandos `--witness-url`, `--witness-key`, `--witness-timeout` y mapeo a variables de entorno (`GUIAIA_REMOTE_WITNESS_URL`, etc.).
    - Validación rigurosa con `validateRemoteWitnessConfig` e inyección de `remoteWitnessClient` en la autoridad del controlador (`authority.multiHostEnabled = true`).
  - Implementado `companion/src/remote_witness_server.js`:
    - Servidor HTTP/Ed25519 ejecutable de forma autónoma con persistencia durable y verificación de avance CAS.
  - En `companion/test/v1_1_remote_witness.test.js`:
    - Añadida prueba de ciclo de vida con 2 procesos reales del sistema operativo vía `child_process.fork`: verificación de avance de secuencia -> terminación abrupta del proceso hijo (`kill()`) -> fallo cerrado instantáneo del cliente (`RemoteWitnessUnavailableError`) -> reinicio del proceso hijo en el mismo puerto con almacenamiento duradero intacto -> reconexión y avance seguro de secuencia.

### Bloqueante 6: Dashboard — TTL de Expiración de PIN y Bloqueo por Fuerza Bruta
- **Estado:** `PASS REAL` (13/13 PASS en `v1_1_web_dashboard.test.js`).
- **Corrección técnica:**
  - En `companion/src/web/server.js`:
    - Configurado TTL de PIN de 5 minutos (`pinTtlMs: 300000`).
    - Límite de 3 intentos fallidos (`maxPinAttempts: 3`).
    - Al alcanzar 3 intentos fallidos, el PIN se bloquea de forma permanente (`pinRevoked = true`) y el endpoint `POST /api/session/pair` responde con **HTTP 403 Forbidden**.
    - PIN expirado responde con **HTTP 401 Unauthorized (`Pairing PIN has expired`)**.
    - Pruebas negativas añadidas: llamadas no autenticadas a `/api/status`, `/api/action` y `/api/emergency-stop` son rechazadas con HTTP 401.

### Bloqueante 7: Pruebas Reales y Protección de Infraestructura Física
- **Estado:** `VERIFICADO REALMENTE` en Durán.
- **Evidencias:**
  - Todas las baterías de seguridad (`npm run test:security`) ejecutadas íntegramente: **205/205 PASS**.
  - Todas las baterías de producto (`npm run test:product`): **152 PASS, 2 SKIPPED (NOT RUN justificados), 0 FAIL**.
  - Chromebook Teselia (PID 11085) aislado estrictamente según directivas de seguridad.

---

## 3. Matriz Integral de Resultados de Pruebas

| Suite | Comando | Total Tests | PASS REAL | PASS SIMULADO | FAIL | SKIP (POSIX) | NOT RUN (Justificado) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **Node: Producto V1/V1.1** | `npm run test:product` | 154 | 124 | 28 | 0 | 0 | **2** (Fabric live / Teselia) |
| **Node: Seguridad e Integridad** | `npm run test:security` | 205 | **205** | 0 | 0 | 0 | 0 |
| **Node: Matriz QA Multinivel** | `node --test test/v1_1_product_qa_matrix.test.js` | 19 | 14 | 3 | 0 | 0 | **2** (Fabric live / Teselia) |
| **Node: Testigo Distribuido Multi-Proceso** | `node --test test/v1_1_remote_witness.test.js` | 12 | **12** | 0 | 0 | 0 | 0 |
| **Python: Verificación de Esquemas** | `python -m unittest discover` | 0 | 0 | 0 | 0 | 0 | 0 |
| **Laboratorio Multi-Host Físico** | *Aislado por seguridad* | N/A | 0 | 0 | 0 | 0 | **NOT RUN (Chromebook 11085)** |

---

## 4. Estado de Git y Próximos Pasos

- **Rama:** `main`
- **Árbol de trabajo:** Listo para checkpoint local de recuperación.
- **Acciones prohibidas:**
  - NO hacer `git push`.
  - NO crear tags de versión final ni publicar release V1.1.
  - NO conectar al hardware físico de Chromebook Teselia PID 11085.
