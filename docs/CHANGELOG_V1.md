# Changelog Oficial — GuiaIA V1.0.0

Todas las modificaciones notables, nuevas capacidades y garantías arquitectónicas introducidas en la versión **V1.0.0** de GuiaIA quedan documentadas en este archivo.

---

## [1.0.0] — 2026-11-03

### Resumen del Lanzamiento
Esta versión consolida la transición de GuiaIA desde prototipos experimentales de laboratorio hacia un producto utilizable, robusto, instalable y verificado para jugadores y operadores en **Minecraft Java 1.21.1**.

---

### Novedades Principales

#### 1. Consola TUI Interactiva y Lanzador de Un Clic
- **Nueva Consola ANSI (`companion/src/cli_v1.js`)**:
  - Prompt interactivo `GuiaIA>` con autocompletado de comandos.
  - HUD visual de estado en tiempo real con coordenadas ($X, Y, Z$), vida, comida, estado del bot y operador vinculado.
  - Parada de emergencia de prioridad absoluta P0 invocable con una sola pulsación (`ESC`, `q`, `Ctrl+C` o comando `parar`) garantizando cancelación en $\le 50$ms.
- **Instalador y Lanzador para Windows**:
  - `setup.ps1`: Asistente interactivo en 5 pasos que audita Node.js >= 22, Python, dependencias e integridad.
  - `iniciar.bat`: Lanzador de doble clic para Windows 11 / Durán.
  - `iniciar.sh`: Lanzador POSIX para entornos Linux y Chromebook sobre Tailscale.

#### 2. Autenticación y Autorización Dual (Zero-Trust)
- **Microsoft OAuth Device Code Flow (`companion/src/auth/microsoft_auth.js`)**:
  - Integración oficial mediante `prismarine-auth`.
  - Almacenamiento seguro de tokens en `%LOCALAPPDATA%\GuiaIA\auth` con permisos restringidos (0700/0600), completamente desacoplado del repositorio Git.
- **Emparejamiento por PIN Efímero (`companion/src/auth/owner_pin_pairing.js`)**:
  - Generación de código numérico de 6 dígitos con tiempo de vida limitado (180 segundos).
  - Emparejamiento mediante chat en el juego (`/msg GuiaBot pair <PIN>`).
  - Bloqueo preventivo tras 3 intentos fallidos y vinculación criptográfica de sesión del operador.
- **Modo Vanilla Paired Operator**:
  - Capacidad de operar en servidores Vanilla estándar sin requerir el mod de servidor Fabric ni el puente HTTP 25594.

#### 3. Capacidades de Acción Autónomas y Multi-Recursos
- **Operaciones en Lotes (Batch 1-16)**:
  - Recolección y depósito secuencial acotado entre 1 y 16 bloques/ítems.
  - Ampliación del catálogo de recursos verificados: `oak_log`, `birch_log`, `stone`, `cobblestone`, `coal`, `coal_ore`.
  - Mapeo determinista de mecánicas de Minecraft (ej. minar bloque de piedra genera ítem de adoquín).
- **Comprensión en Lenguaje Natural**:
  - Parser robusto con soporte para comandos coloquiales (`recoge 5 madera`, `deposita 10 roble en cofre 10 64 10`, `sigue`, `inventario`).

#### 4. Resiliencia y Testigos de Seguridad
- **Testigo Monotónico Local Duradero (`companion/src/local_monotonic_witness.js`)**:
  - Sustitución del simulador en memoria por un registro persistente append-only en disco (`witness.log` y `head.json`).
  - `fsync` estricto en cada avance de secuencia, encadenamiento de hashes SHA-256 y firmas digitales Ed25519.
- **Reconciliación Guiada de Diarios (`companion/src/mission.js`, `companion/src/deposit.js`)**:
  - Manejo seguro de fallos y caídas en mitad de tareas (`needs_review`).
  - Opciones de resolución explícitas: `retry`, `mark_step_completed` o `cancel` sin riesgo de duplicar acciones irreversibles en el mundo.

#### 5. Compatibilidad Dinámica con Fabric y Cobblemon
- **Detector de Perfil (`companion/src/cobblemon_profile.js`)**:
  - Detección automática en la conexión mediante marcas y canales de red.
  - Aplicación de parche preventivo de tabla de recetas de Fabric 1.21.1 evitando excepciones y desconexiones de Mineflayer.
  - Aislamiento seguro: la automatización avanzada de criaturas Pokémon queda delimitada para la versión V1.1.

---

### Verificación y Cobertura de Pruebas
- **Node.js**:
  - 52 pruebas nuevas específicas de V1 en suites unitarias y de integración de extremo a extremo (**52/52 PASS**).
  - Cero regresiones sobre las 412 pruebas de laboratorio previas.
- **Python**:
  - 61 pruebas unitarias y de esquemas canónicos superadas (**61/61 PASS**).
- **Integración E2E**:
  - `companion/test/v1_e2e_flow.test.js` superado verificando el ciclo de vida completo: emparejamiento por chat -> comando batch -> parada P0 -> avance del testigo duradero.
