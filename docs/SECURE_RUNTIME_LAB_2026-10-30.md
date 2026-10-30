# Signed secure delivery — isolated Fabric QA (2026-10-30)

## Estado verificado (ES)

Esta fase añade un runtime de laboratorio que conecta **autorización Ed25519 de cada acción**, atestación de conexión Fabric, presencia reciente del servidor, testigo independiente y los diarios durables de recolección y depósito existentes. **No es una beta jugable general**: falta un arranque autónomo de operador con identidad, claves y control interactivo fuera del laboratorio.

El 30/10/2026 se ejecutó la ruta nueva en un **mundo Fabric 1.21.1 desechable y aislado en 127.0.0.1** con Mineflayer y Java 21. El proceso terminó con código 0 y el marcador GUIAIA_REAL_SECURE_RUNTIME_QA_EVIDENCE, result: pass.

| Evidencia física / durable | Resultado observado |
| --- | --- |
| Bloque de roble | Extraído físicamente; inventario +1 |
| Inventario del bot antes de recolectar | 1 (elemento de preparación QA) |
| Inventario después de recolectar | 2 |
| Inventario después de depositar | 1 |
| Cofre autorizado | 0 → 1 |
| Recibos durables | 1 de recolección y 1 de depósito |
| Permisos Ed25519 gastados | 2 |
| Repetición de misión completada | Denegada |
| Presencia Fabric y testigo independiente | Exigidos y comprobados |
| Objetivos de navegación del bot | 3 |

La identidad del operador procede de **claves efímeras y enrolamiento sintético QA**. El alias o UUID offline no demuestra la identidad real. Teselia y sus datos no se utilizaron.

## Reproducción segura

Requisitos: Linux, Java 21, Python 3.11+, Node.js 22+, servidor Fabric 1.21.1, Fabric API y JAR del observador compatibles; puertos 25593 y 25594 disponibles en loopback. Los JAR de entrada deben ser archivos de lectura, no un servidor en ejecución.

    cd companion
    npm ci --no-audit --no-fund --ignore-scripts
    npm test
    cd ..
    PYTHONPATH=src python3 -m unittest discover -s tests

    JAVA_HOME=/path/to/java21 PYTHONPATH=src python3 scripts/qa_signed_delivery_real_server.py \
      --launcher /path/to/fabric-server-1.21.1-launcher.jar \
      --fabric-api /path/to/fabric-api-1.21.1.jar \
      --mod /path/to/guiaia-world-observer-0.1.0-alpha.1.jar \
      --secure-runtime

El observador de la prueba procede del artefacto guiaia-observer-build-qa de la ejecución de [GitHub Actions 40990105695](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40990105695) para el commit 060497ccb56bb0a2e9b5e488c84256e51bfbf2ef. SHA-256 del JAR: 3db9091b7bcbe768b4dddfed503b1985ccc3bc1ecef4bfbbbae31583d49973b6.

El ensayo crea mundo, credenciales y diarios temporales, usa conexión loopback, desactiva RCON y limpia el mundo al terminar. Solo emite el marcador tras comparar bloque, ambos inventarios, cofre, diarios y protección contra repetición.

## Límites y siguientes criterios de cierre

- Las acciones de recolección exigen un permiso firmado específico de bloque, material y conexión, además de presencia y testigo actuales.
- Los diarios registran intención antes del efecto. Una operación incierta exige revisión manual, sin repetición automática.
- El runtime nuevo conecta autorización, recolección y depósito reales. Los adaptadores QA históricos no se publican como API de acciones.
- Pendiente para beta: interfaz de operador integrada y configuración de identidad, seguimiento/parada en el mismo flujo, pruebas reales de revocación y reinicio de este nuevo runtime, instalación independiente y distribución.
- No habilitar esta configuración en Teselia, servidores públicos ni mundos compartidos.

## Verified status (EN)

On 30 October 2026, the new signed delivery runtime passed an end-to-end test against an isolated, disposable Minecraft Fabric 1.21.1 server. It physically mined an approved oak log, picked up its drop, transferred one log into an approved chest, verified both inventory changes, saved separate gather/deposit receipts, consumed two signed Ed25519 one-use action grants and denied replay. Bot inventory was **1 → 2 → 1** and chest inventory **0 → 1**.

This is an **isolated laboratory integration**, not a public or production-ready playable beta. Operator identity in this run used ephemeral laboratory keys and synthetic enrolment, not authenticated real users. A standalone interactive operator client, full clean installation, interruption/restart validations of the new runtime and deployable identity integration are still missing.

## Consola local del operador añadida en la fase siguiente

Existe una nueva interfaz **exclusivamente local y de laboratorio**:
`companion/src/trusted_local_operator_console.js`. Acepta únicamente
`estado`, `inventario`, `sigueme`, `siguiente`, `mision`,
`para`, `ayuda` y `salir` (y equivalentes ingleses).
Una entrada no reconocida, multilinea, inyección de instrucciones o
entrada de tipo pipe se deniega. El terminal se conecta únicamente después
de construir el runtime con las claves y los permisos ya verificados; la
propia consola no emite privilegios.

El mismo `createSecureDeliveryRuntime` ahora admite un permiso **follow**
separado, firmado y de un solo uso; comprueba además que su nonce no se
reutilice como permiso de recolección o depósito. El seguimiento y la misión
comparten parada y barreras de concurrencia. `para` no espera a la
autorización que está pendiente. Las operaciones detenidas conservan la
decisión durable de los diarios.

Evidencias de pruebas unitarias locales: **323 Node y 54 Python aprobadas**,
incluidos rechazo de comandos, permiso de seguimiento falso, nonce duplicado,
carrera entre misión y parada, revocación durante la misión y recibos durables.
Estas pruebas no acreditan por sí mismas una identidad real de usuario, la
resistencia a fallos en producción ni una interfaz de onboarding pública.

La consola de este bloque se comprueba dentro de la prueba Fabric real
`--secure-runtime` para validar que no se eludan las barreras existentes.
La prueba en mundo desechable es distinta del funcionamiento en Teselia.

## Validación final de la consola dentro de Fabric real — 30/10/2026

Se ha ejecutado nuevamente la prueba con `--secure-runtime` tras
integrar la consola y el permiso de seguimiento. **Salida 0** y
`GUIAIA_REAL_SECURE_RUNTIME_QA_EVIDENCE.result = "pass"`:

| Verificación | Resultado |
| --- | --- |
| Seguimiento del operador con permiso Ed25519 | Activado; segunda utilización rechazada |
| Instrucción arbitraria del operador | Rechazada antes de cualquier acción |
| Extracción de bloque en Fabric real | Confirmada |
| Inventario del bot | 1 → 2 → 1 durante recolección y depósito |
| Cofre real autorizado | 0 → 1 |
| Recibo durable de recolección | 1 |
| Recibo durable de depósito | 1 |
| Nonces firmados consumidos | 3, sin reejecución |
| Ruta de navegación real | 3 objetivos; 2,256 bloques de desplazamiento |
| Autoridad | Fabric actual + testigo independiente |
| Repetición de misión completada | Rechazada |
| Puertos temporales 25593 y 25594 | Liberados al finalizar |
| Mundo temporal `/tmp/guiaia-fabric-bridge-qa-*` | Limpiado automáticamente |

El servidor de Minecraft original y los procesos de otros agentes
permanecieron sin cambios. No hubo push, despliegue ni ejecución
adicional de GitHub Actions.

**Límite de evidencia:** no se ha demostrado todavía un enrolamiento real
de jugadores o un cliente autónomo instalable. Tampoco queda demostrada
por esta ejecución la recuperación tras caída abrupta **del nuevo runtime**
o su instalación en Teselia. El puerto loopback con Minecraft offline-mode
y las claves efímeras no deben exponerse a redes ni servidores públicos.
