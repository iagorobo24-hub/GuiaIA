# GuiaIA V1.1 — Manual Integral de Operación y Referencia Técnica

> **Versión:** 1.1.0  
> **Entorno objetivo:** Minecraft Java 1.21.1 / Fabric 0.16+ / Cobblemon 1.8.2  
> **Estación de desarrollo:** `DURÁN` (Windows 11)  
> **Licencia:** MIT / Proyecto GuiaIA

---

## 1. Novedades y Alcance de GuiaIA V1.1

GuiaIA V1.1 amplía la arquitectura segura y criptográfica de la versión 1.0.0 incorporando 5 bloques funcionales principales:

1. **Bloque A — Automatización Cobblemon Completa:**
   - **Radar de proximidad:** Detección de entidades Pokémon (`cobblemon:pokemon`) en radio acotado ($\le 24$ bloques) con extracción de especie, nivel y variante shiny.
   - **Captura segura:** Presupuesto de consumibles acotado a un máximo estricto de $\le 5$ Poké Balls por operación.
   - **Combate salvaje (FSM):** Máquina de estados finitos con watchdogs de turno (15 s) y de combate (60 s), escape táctico y prioridad absoluta para parada P0.
   - **Almacenamiento PC:** Gestión integral de 32 cajas (0-31) y 30 ranuras por caja (0-29), con consulta, depósito y retirada autorizada.

2. **Bloque B — Dashboard Web Local (SSE + Canvas 2D):**
   - Servidor HTTP nativo en `http://127.0.0.1:8080` (sin dependencias npm innecesarias).
   - Mitigación contra DNS Rebinding (`Host: 127.0.0.1` / `localhost` estricto) y CSRF (`Origin` local / `Sec-Fetch-Site` same-origin).
   - Autenticación con Bearer token efímero de sesión en memoria (`crypto.timingSafeEqual`).
   - Minimapa táctico en Canvas 2D con visualización de posición, orientación y anillos de alcance.
   - HUD de estado del bot (vida, comida, modo activo, último motivo) e inventario interactivo de 36 slots.
   - Botón de Parada de Emergencia P0 con separación explícita de parada local inmediata y confirmación remota.

3. **Bloque C — Construcción Autónoma con Blueprints:**
   - Importador multi-formato (`companion/src/blueprint_importer.js`): soporte para `.schem` (Sponge NBT), `.schematic` (MCEdit) y estructuras JSON.
   - Cuotas de seguridad estrictas: máximo 2 MB en archivo, 16 MB en memoria descomprimida, dimensiones limitadas a $16 \times 16 \times 16$ bloques (máximo 4096 bloques).
   - Sanitización de paleta: denegación estricta de bloques peligrosos (`tnt`, `lava`, `fire`, `bedrock`, `portales`, `pistones`).
   - Motor de colocación topológica (`companion/src/blueprint_builder.js`): ordenación por capas de abajo a arriba ($Y=0, 1, 2, \dots$), soporte físico previo para bloques de gravedad (`sand`, `gravel`) y lotes acotados de $\le 64$ bloques.

4. **Bloque D — Motor de Crafteo Encadenado y Misiones Compuestas:**
   - Planificador en grafo acíclico dirigido (DAG) con recetas canónicas de `minecraft-data` 1.21.1.
   - Clasificación estricta de estaciones: rejilla 2x2 del jugador (`player_inventory`) vs mesa de crafteo 3x3 (`crafting_table`).
   - Límite acotado de subtareas ($\le 10$ pasos) según `schemas/v1/compound_mission_spec.json`.
   - Algoritmo de resolución con retroceso (backtracking) ante múltiples tipos de madera y variantes.
   - Verificación de deltas de inventario antes y después de cada paso con política fail-closed.

5. **Bloque E — Testigo Distribuido Multi-Host (Opt-in Fail-Closed):**
   - Cliente seguro `companion/src/remote_witness_client.js` para despliegues multi-host (Tailscale / HTTPS / HTTP).
   - Fijado de claves públicas Ed25519 para operador y testigo.
   - Política estricta **FAIL-CLOSED**: ante indisponibilidad, retraso de red (> 2000 ms), regresión de secuencia o divergencia de hash, la operación se aborta tajantemente; queda terminantemente prohibido el fallback silencioso que degrade las garantías a modo local.

---

## 2. Requisitos del Sistema e Instalación

### Requisitos Previos
- **Sistema Operativo:** Windows 10/11 (64-bit) o Linux (Ubuntu 22.04+ / Debian 12+).
- **Node.js:** Versión $\ge 22.0.0$ (requerido para APIs criptográficas modernas y test runner nativo).
- **Python:** Versión $\ge 3.10$ (recomendado para suites de análisis y esquemas).
- **Servidor Minecraft:** Java Edition 1.21.1 con Fabric Loader $\ge 0.16.0$ y opcionalmente Cobblemon 1.8.2+.

### Instalación en Windows
Ejecuta el script de verificación e instalación en PowerShell:
```powershell
.\setup.ps1
```
El script verificará el entorno Node.js, configurará los directorios de almacenamiento seguro en `%LOCALAPPDATA%\GuiaIA`, instalará las dependencias y validará los contratos canónicos.

---

## 3. Inicio del Agente y Consola Interactiva

### 3.1 Inicio Rápido (Modo Estándar)
Ejecuta el archivo `iniciar.bat` o desde la línea de comandos:
```powershell
cd companion
node src/cli_v1.js --host 127.0.0.1 --port 25565 --username GuiaBot
```

### 3.2 Inicio con Panel de Control Web Activado (Dashboard)
Para habilitar el dashboard local en el puerto 8080:
```powershell
cd companion
node src/cli_v1.js --host 127.0.0.1 --port 25565 --username GuiaBot --dashboard
```
La consola mostrará el enlace local y el token de sesión Bearer:
```text
╔════════════════════════════════════════════════════════════════════════════╗
║ PANEL DE CONTROL WEB ACTIVO (DASHBOARD LOCAL V1.1)                        ║
║ URL:   http://127.0.0.1:8080                                               ║
║ Token: a1b2c3d4...                                                        ║
╚════════════════════════════════════════════════════════════════════════════╝
```
Abre tu navegador en `http://127.0.0.1:8080`.

---

## 4. Instrucciones en Lenguaje Natural y Comandos

GuiaIA V1.1 admite instrucciones en lenguaje natural tanto en la consola interactiva como mediante mensajes susurrados (`/msg GuiaBot <instrucción>`) de jugadores emparejados.

### 4.1 Fabricación / Crafteo Encadenado
- `fabrica 4 crafting_table` — Elabora 4 mesas de crafteo.
- `craftea stick` — Elabora palos utilizando madera disponible.
- `craft 1 wooden_pickaxe` — Planifica el grafo completo (troncos $\to$ tablones $\to$ palos $\to$ mesa de crafteo $\to$ pico de madera).

### 4.2 Construcción con Blueprints
- `construye shelter_5x5` — Inicia la colocación del blueprint indicado en la posición del bot.
- `edifica torre en 10 64 -20` — Coloca el blueprint en las coordenadas absolutas especificadas.

### 4.3 Automatización Cobblemon
- `pokemon radar` o `pokemon buscar` — Escanea Pokémon salvajes en un radio de 24 bloques y muestra especie, nivel y distancia.
- `pokemon captura 42` — Inicia un intento de captura contra la entidad con ID 42 respetando el presupuesto $\le 5$ Poké Balls.
- `pokemon combate 77` — Inicia combate salvaje contra el Pokémon especificado.
- `pokemon pc` o `pokemon pc ver` — Muestra el estado de la caja 0 del PC Pokémon.
- `pokemon pc_withdraw 2` — Retira el Pokémon de la ranura 2 de la caja actual al equipo activo.

### 4.4 Navegación y Recolección
- `sigue` o `sigueme` — Sigue al operador autorizado manteniendo distancia segura.
- `recoge 5 madera` — Mina de forma acotada hasta 5 bloques de roble o abedul.
- `deposita 5 roble en cofre 10 64 10` — Deposita recursos en el contenedor autorizado con recibos de dos caras.
- `parar`, `alto`, `detente`, `stop` o tecla `[ESC]` — **Parada de Emergencia P0**. Cancela inmediatamente cualquier movimiento, minado, crafteo o combate.

---

## 5. Arquitectura del Panel de Control Web Local

El dashboard web local (`companion/src/web/`) está diseñado para operar con latencia mínima y máxima seguridad:

1. **Seguridad en la Conexión:**
   - La cabecera `Host` se valida estrictamente contra `127.0.0.1` o `localhost`. Cualquier petición con otro host es rechazada con código `403 Forbidden` para neutralizar ataques de DNS Rebinding.
   - Peticiones mutativas (POST) verifican el origen `Origin` y cabeceras `Sec-Fetch-Site`.
   - Autenticación mediante token de 256 bits (`crypto.randomBytes(32)`).

2. **Minimapa Táctico en Canvas 2D:**
   - Representación en tiempo real de la posición del bot (flecha azul orientada según el ángulo yaw).
   - Anillos concéntricos de alcance a 16 m, 32 m y 64 m.
   - Controles de zoom táctico (0.25x a 3.0x).

3. **Parada de Emergencia P0 Dual:**
   - El botón rojo P0 ejecuta de inmediato un evento local visual en el navegador (`[LOCAL: DETENIDO]`) y envía de forma prioritaria la orden al endpoint `/api/emergency-stop`.
   - Cuando el servidor confirma la parada física del bot, el indicador se actualiza a `[REMOTO: CONFIRMADO]`.

---

## 6. Verificación y Batería de Pruebas

Para comprobar la integridad completa del sistema en cualquier momento:

### Suite de Producto (Integración y Funcionalidad V1.1)
```powershell
cd companion
npm run test:product
```
*Cobertura: 106 pruebas unitarias y de integración que validan esquemas, parser, identidad, dashboard, crafteo, blueprints, Cobblemon y testigo.*

### Suite de Seguridad Criptográfica
```powershell
cd companion
npm run test:security
```
*Cobertura: 205 pruebas de mitigación de ataques (forjas de firma, replays de nonces, robos de sesión, bloqueos de concurrencia y revocaciones).*

### Suite Python (Esquemas y World Observer)
```powershell
python -m pytest
```
*Cobertura: 66 pruebas de estabilidad, sandbox de políticas y contratos canónicos Draft 2020-12.*

---

## 7. Solución de Problemas Frecuentes

1. **Error: `EEXIST: file already exists ... .used`**
   - *Causa:* Se ha intentado reutilizar un permiso (grant) cuyo nonce criptográfico ya fue consumido en una operación previa.
   - *Solución:* Los permisos de GuiaIA son de un solo uso por diseño. Genera una nueva instrucción para obtener un nonce fresco.

2. **Error: `insufficient_materials` al craftear**
   - *Causa:* El planificador DAG ha descompuesto el ítem pero el inventario del bot carece de los materiales base suficientes.
   - *Solución:* Recolecta los recursos base reportados por el planificador (ej. `recoge 5 madera`) y reintenta el crafteo.

3. **Error: `RemoteWitnessUnavailableError`**
   - *Causa:* El modo multi-host está activado pero el testigo remoto no responde dentro del plazo de 2000 ms.
   - *Solución:* Por política **FAIL-CLOSED**, el agente rehúsa mutar el mundo sin testigo monotónico confirmado. Verifica la conectividad de la red Tailscale o desactiva el modo multi-host para operar con el testigo local monotónico.
