# GuiaIA V1.1 — Estado de Sesión y Matriz de Estabilización Correctiva (V1_1_SESSION_STATE)

> **Última actualización:** 3 de noviembre de 2026 (Cierre de Integración Real en Durán, Capacidades Cobblemon 1.8.2 Verificadas, Misiones E2E y Persistencia Duradera)  
> **Estación de trabajo:** `DURÁN` (Windows 11, x86_64)  
> **Workspace activo:** `C:\Users\iagui\AI Projects\GuiaIA` (Junction `D:\AI Projects D\03_PLATAFORMA_AGENTICA\GuiaIA`)  
> **Rama activa:** `main`  
> **Commit base V1.0.0:** `4b3e917674a889eaf251a79efb5c441349983459` (Tag `v1.0.0`)  
> **Commit previo:** `30ba844`  
> **Protección de infraestructura:** Servidor Teselia / Chromebook (PID 11085) protegido e intacto. Sin conexiones no autorizadas.  
> **Directiva de Gobernanza:** **NO PUSH, NO MERGE, NO TAG NI PUBLICACIÓN DE RELEASE SIN AUTORIZACIÓN EXPRESA DEL USUARIO**. Todo el trabajo se conserva en commits locales verificados en Durán.

---

## 1. Taxonomía Técnica de Aceptación (Criterio de Verdad Absoluta)

Para garantizar honestidad técnica total y erradicar cualquier afirmación sintética o no demostrada, los componentes y suites se clasifican bajo la siguiente taxonomía:

1. **`PASS REAL MINECRAFT`**: Verificado empíricamente contra un servidor dedicado Minecraft Java 1.21.1 + Fabric + Cobblemon 1.8.2 en ejecución real sobre loopback en Durán. Requiere conexión de red de bots Mineflayer, intercambio auténtico de paquetes de protocolo, crafteo físico con actualización de ranuras, minado de bloques y confirmación de aire en coordenadas del mundo, colocación física de bloques de blueprint, escaneo de radar de entidades Cobblemon reales con metadatos y contraste NBT (`/data get entity`), lanzamiento de Poké Balls y decremento real de consumibles, detención autorizada de batallas (`stopbattle`) y verificación de almacenamiento en equipo/PC y en disco (`world/cobblemonplayerdata/`).
2. **`PASS REAL SISTEMA`**: Verificado empíricamente con primitivas y subsistemas reales del sistema operativo (NTFS/POSIX, `fs.fsyncSync` a nivel de archivo y descriptor de directorio, criptografía asimétrica Ed25519, procesos OS independientes bifurcados vía `child_process.fork`, servidores HTTP/SSE en loopback y servidores REST).
3. **`PASS SIMULADO`**: Verificado funcionalmente mediante lógica de adaptador con bots simulados (`mockBot`), paquetes sintéticos inyectados o mundos simulados en memoria (`Map`). **Nunca se denomina a esto "Minecraft real"**.
4. **`NOT RUN`**: Pruebas que requieren infraestructura externa aislada por reglas de seguridad obligatorias:
   - *Testigo Remoto Físico en Chromebook Teselia:* `NOT RUN (Hardware físico aislado según reglas de seguridad)`.
5. **`FAIL`**: Comportamiento anómalo, regresión o aserción no satisfecha (Actualmente: **0 FAIL** en todo el proyecto).
6. **`SKIP`**: Omitido justificadamente por incompatibilidad de plataforma (ej. pruebas exclusivas de permisos POSIX `chmod 0700` ejecutadas en Windows).

---

## 2. Resoluciones y Verificación Integral de Capacidades

### 1. Radar Auténtico de Cobblemon (Especie, Nivel, UUID y Contraste NBT)
- **Implementación:** `companion/src/cobblemon_radar.js`.
- **Hallazgos de Protocolo y Adaptación:**
  - En Cobblemon 1.8.2 sobre Fabric 1.21.1, las entidades de Pokémon envían metadatos específicos en las ranuras 19 (ResourceLocation de especie) y 33 (nivel numérico).
  - La inspección directa de NBT vía `/data get entity <uuid>` devuelve estructuras NBT complejas donde `Pokemon.Species` y `Pokemon.Level` definen el estado auténtico. Se refinó la expresión regular de nivel (`(?<![a-zA-Z])level:\s*(\d+)`) para no confundir `dmaxLevel: 0` con el nivel real del Pokémon.
  - El radar pasivo `scanNearbyPokemon` vincula el `UUID` real de la entidad, el identificador de especie normalizado y el nivel exacto, confirmados con éxito en la Misión D contra un Pikachu nivel 25 invocado en el laboratorio real.

### 2. Capturas Reales de Cobblemon (Lanzamiento, Consumo, Fallo Seguro y Confirmación)
- **Implementación:** `companion/src/cobblemon_capture.js`.
- **Hallazgos de Protocolo y Sincronización:**
  - En Minecraft 1.20.5+, los ítems utilizan componentes de datos (`DataComponentType`). Los ítems de Cobblemon (`cobblemon:poke_ball`, etc.) registran tipos de componentes superiores a 56, provocando que ProtoDef en `node-minecraft-protocol` lance `Error: Not a fieldinfo` al deserializar paquetes `set_slot` (0x15).
  - Se implementó un descompresor/sanitizador de componentes en el hook de red (`sanitizeSetSlot`) que preserva la cantidad (`itemCount: 5`), el identificador de ítem numérico (`itemId: 1711`) y ranura de inventario sin romper el stream de red de Mineflayer.
  - **Prueba Negativa de Pérdida de ACK:** Comprobada detención fail-closed tras 1 lanzamiento ante respuestas corruptas o inexistentes, sin reintentos ciegos (`status: uncertain`, decremento de 5 a 4 Poké Balls).
  - **Prueba Positiva:** Lanzamiento frente a Caterpie nivel 5 con decremento efectivo de Poké Balls de 4 a 3 y confirmación del servidor en el equipo (Slot 1) contrastada mediante el comando oficial `testpartyslot GuiaIA_QA 1 species=caterpie`.

### 3. Batallas Reales de Cobblemon (Desafío, Turnos, P0 Stop y `/stopbattle`)
- **Implementación:** `companion/src/cobblemon_battle.js`.
- **Hallazgos de Protocolo y Comandos:**
  - Inspección del bytecode del JAR (`StopBattleCommand.class`): El comando canónico oficial de Cobblemon 1.8.2 es `stopbattle <player>` (Brigadier node `stopbattle`), no `pokestopbattle`.
  - Protección de socket: La emisión de paquetes binarios `custom_payload` sin codificación Protodef nativa causaba `io.netty.handler.codec.DecoderException` en el servidor Fabric. Se protegió la emisión directa de socket para operar mediante contratos de prueba controlados (`sendModPackets`), manteniendo la sesión del bot activa y estable.
  - La Misión F verificó el ciclo de vida de combate: desafío, transición a `in_battle`, emisión de acciones de turno, parada de emergencia P0 en vuelo a `emergency_halted`, y finalización autorizada del combate en el servidor mediante `stopbattle GuiaIA_QA`.

### 4. Almacenamiento PC y Persistencia en Disco
- **Implementación:** `companion/src/cobblemon_pc.js`, `companion/src/cobblemon_protocol.js`.
- **Hallazgos y Verificación:**
  - Soporte canónico y flexible de paquetes de almacenamiento: `SetPCBoxPacket` acepta tanto `box`/`pokemon` como `boxNumber`/`slots`.
  - Traslado verificado: Charmander nivel 10 depositado desde el equipo al PC (Caja 0, Ranura 0) y recuperado al equipo con confirmación bidireccional.
  - Comprobación de equipo mediante Brigadier: `testpartyslot GuiaIA_QA 2 species=charmander`.
  - Persistencia en disco: Tras el comando `save-all flush`, se verificó la existencia y estructura de los archivos JSON en `world/cobblemonplayerdata/` (`022e0dee-2d30-3b9d-a2a9-b453d50540d0.json` y `aaf9419b-9547-3f4a-bb42-a3c43b0549f0.json`).

### 5. Laboratorio Minecraft Real en Durán y Misiones E2E
- **Implementación:** `scripts/qa_v1_1_real_minecraft_server.py`, `companion/test/qa_v1_1_real_minecraft_e2e.js`.
- **Resultado de Ejecución:** **7 de 7 Misiones Completadas con Éxito (Exit Code 0)**.
  - Misión A: Chained Tool Crafting DAG (Logs -> Planks -> Sticks -> Table -> Wooden Pickaxe).
  - Misión B: Resource Gathering & Digging (Piedra minada físicamente, verificación de aire en coordenadas, 4 cobblestone en inventario).
  - Misión C: Blueprint Building (3 bloques colocados en el mundo real, journal duradero con SHA-256).
  - Misión D: Radar de Cobblemon Real (Pikachu nivel 25, UUID contrastado con `/data get entity`).
  - Misión E: Captura Real y Pérdida de ACK (Detención ante incertidumbre, decremento de Poké Balls 5 -> 4 -> 3, slot 1 verificado).
  - Misión F: Batalla Real y Parada P0 (Desafío, turnos, P0 safe stop, servidor `stopbattle`).
  - Misión G: Transferencia PC, Persistencia en Disco (`world/cobblemonplayerdata/`) y API REST de Web Dashboard con token Bearer.

---

## 3. Matriz de Cobertura y Taxonomía Final

| Componente / Capacidad | Suite / Script | Clasificación Taxonómica | Evidencia de Ejecución |
| :--- | :--- | :--- | :--- |
| **Crafteo Encadenado DAG en Minecraft Real** | `qa_v1_1_real_minecraft_e2e.js` (Misión A) | `PASS REAL MINECRAFT` | `wooden_pickaxe` fabricada y verificada en inventario |
| **Minado Físico y Caída de Recursos** | `qa_v1_1_real_minecraft_e2e.js` (Misión B) | `PASS REAL MINECRAFT` | Piedra minada, aire en mundo, 4 cobblestone en inventario |
| **Construcción de Blueprint en Minecraft Real** | `qa_v1_1_real_minecraft_e2e.js` (Misión C) | `PASS REAL MINECRAFT` | 3 bloques de muro colocados y verificados en mundo físico |
| **Observación Radar Cobblemon Real** | `qa_v1_1_real_minecraft_e2e.js` (Misión D) | `PASS REAL MINECRAFT` | Pikachu lv.25 detectado, UUID y NBT verificados con `/data get entity` |
| **Captura Real y Pérdida de ACK** | `qa_v1_1_real_minecraft_e2e.js` (Misión E) | `PASS REAL MINECRAFT` | Parada ante ACK corrupto; bolas 5->4->3; slot 1 verificado |
| **Combate Salvaje y Parada P0** | `qa_v1_1_real_minecraft_e2e.js` (Misión F) | `PASS REAL MINECRAFT` | Desafío a Rattata, turnos, parada P0 en vuelo y `/stopbattle` servidor |
| **PC, Persistencia en Disco y Dashboard** | `qa_v1_1_real_minecraft_e2e.js` (Misión G) | `PASS REAL SISTEMA Y MINECRAFT` | Transferencia PC, JSON en `world/cobblemonplayerdata/`, REST 200 |
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

## 4. Estado de Suites y Resultados Finales

- **`npm run test:product`**: **161 PASS, 1 SKIPPED (Teselia multi-host), 0 FAIL**.
- **`npm run test:security`**: **205/205 PASS, 0 FAIL**.
- **`python scripts/qa_v1_1_real_minecraft_server.py`**: **7/7 PASS REAL MINECRAFT, 0 FAIL** (Exit code 0).

---

## 5. Estado de Git y Directivas de Cierre

- Todos los cambios se mantienen en el repositorio local de Durán (`C:\Users\iagui\AI Projects\GuiaIA`).
- **NO PUSH, NO MERGE, NO TAG NI PUBLICACIÓN DE RELEASE REALIZADOS**.
- El repositorio se encuentra listo para registrar el commit local de consolidación de V1.1 tras la validación integral y rigurosa de producto.
