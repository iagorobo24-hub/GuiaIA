# GuiaIA — Cobblemon 1.8.2 / Fabric 1.21.1, laboratorio aislado

**Fecha:** 2026-11-02. **Base inicial:** `c338f44`, rama `main`. **Estado:** observación real mediante MCP **PASS**; misión firmada usando Mineflayer **NO VALIDADA**.

## Material y aislamiento

- Chromebook, mundo nuevo desechable generado bajo `/tmp/guiaia-fabric-qa-*`, puerto **127.0.0.1:25596**, `online-mode=false` solo para cuentas sintéticas de laboratorio, sin RCON ni consultas remotas. El servidor compartido Teselia se mantuvo separado; no se modificaron sus ficheros.
- Minecraft Fabric **1.21.1**, Java **21**, Fabric API `0.116.17+1.21.1`, Cobblemon `1.8.2+1.21.1` (JAR original SHA-256 `cae8ac328b61354fbe415208b8c6ffc12e7155094d0a87082e85e7914fb380c2`).
- Observador GuiaIA `0.1.0-alpha.1`, JAR previamente compilado, SHA-256 `3db9091b7bcbe768b4dddfed503b1985ccc3bc1ecef4bfbbbae31583d49973b6`. No se ha recompilado durante este ensayo. Cobblemon incorpora Kotlin y otras librerías como JAR anidados; se cargó una copia en el mundo QA, sin trasladar datos ni credenciales de Teselia.
- Verificaciones de prearranque: metadatos reales `fabric.mod.json` (id, versión, Minecraft), puerto libre y rechazo de JAR distinto antes de iniciar el servidor: **PASS**.

## Resultados verificables

### Escenario positivo de observación

El comando `scripts/qa_fabric_server.py --cobblemon <jar> --cobblemon-smoke` utiliza **un solo arranque** de laboratorio, con el observador expresamente habilitado y el puente de identidad deshabilitado (no se prueban aquí permisos de acción). El registro real confirmó `Launching Cobblemon 1.8.2`, sus registros y `Done`. El controlador creó en el mundo temporal un bloque de diamante y una oveja mediante la consola autorizada del laboratorio y consultó el observador a través del controlador MCP real.

Marcador `GUIAIA_COBBLEMON_OBSERVER_QA_EVIDENCE` con `result=pass` y:

| Evidencia | Observada |
| --- | --- |
| `cobblemon_mod_loaded` y `cobblemon_version` | `true`, `1.8.2+1.21.1` |
| `mcp_fabric_real_snapshot_roundtrip` | `true` |
| `diamond_blocks` | 1 |
| `sheep_observed` | 1 |
| `chunks_loaded` y `blocks_sampled` | 1 y 16 |
| `private_file_0600_and_directory_0700_verified` | `true` |
| `observer_code_has_no_world_mutation_calls` | `true` |
| `entities_capped` | `false` |
| `mineflayer_client_probe.spawned` | **`false`**; `reason=client spawn timeout` |

El servidor y el mundo temporal finalizaron tras la captura. El JAR de Cobblemon produjo mensajes sobre mixins opcionales, data fixers y ausencia de datos antiguos de jugadores nuevos; pese a ellos, el mundo se creó y MCP devolvió una observación válida. No se atribuye todavía una causa raíz específica a esas entradas del registro.

### Prueba de misión firmada: fallida

Se probó el runner `scripts/qa_signed_delivery_real_server.py --cobblemon <jar> --standalone-operator` con mundo nuevo, cofres y troncos sintéticos. El servidor se inició y registró la entrada de `OwnerQA`, pero Mineflayer no completó la sesión de propietario: el controlador terminó con **código 1**, `Standalone real Fabric QA failed: QA owner connection refused`. **No hubo un recibo de recolección/depósito firmado validado**.

Para separar las causas, el ensayo de observación incluyó un cliente Mineflayer diagnóstico sin acciones. El servidor registró la entrada de `CobblemonProbeQA`, pero el cliente no disparó su evento `spawn` antes de 16 segundos, sin mensaje `kicked` ni `error` adicional. **Hecho probado:** la conexión de Mineflayer no está integrada completamente con este servidor modificado. **Hipótesis pendiente:** diferencia de protocolo/registro modded o sincronización bajo carga. No se han suprimido validadores, otorgado privilegios ni modificado Cobblemon para forzar un resultado positivo.

## Límites, pruebas y siguiente paso

- La observación no prueba capturas, batallas, permisos sobre Pokémon ni operación de cuentas Minecraft oficiales.
- La misión firmada y el checkpoint físico de Durán ya fueron verificados en **Fabric sin Cobblemon** (documentación de QA anterior); este ensayo **no acredita** su compatibilidad con Cobblemon.
- El requisito antes de una beta Cobblemon es disponer de un cliente/adaptador que complete el protocolo Fabric+Cobblemon en versión fijada, o un ejecutor del lado del mod con controles equivalentes de identidad, confirmación, permisos de un solo uso, checkpoint y fallos cerrados. Prohibido eludir la autoridad criptográfica para superar QA.
- Regresión Python: **58/58** PASS; sintaxis y `git diff --check`: PASS. Suite completa Node `npm test`: **368/368 PASS**, sin fallos ni omisiones, verificada con el código de esta fase. No hay evidencia de login oficial, prueba de un cliente Cobblemon real ni build reproducible del observador en esta fase.

**Prioridad:** cerrar compatibilidad de cliente/ejecutor en QA, repetir extracción y depósito sintéticos con Cobblemon y ejecutar también caída de testigo, sin tocar Teselia. Mantener la parte de observación como validada y la de actuación como pendiente.

## Continuación: diagnóstico reproducido a nivel de paquetes (2026-11-02)

Se repitió **un único mundo temporal** con Fabric 1.21.1, Cobblemon 1.8.2 y el observador; se amplió el límite de la sonda sintética de 16 a **65 segundos** y se registraron **solo nombres de paquetes y transiciones de protocolo**, nunca cargas binarias, identidades reales, tokens o mensajes. El controlador limita su espera a 90 segundos y conserva la retirada de mundo/JVM en el bloque `finally`.

**Resultado medido**, archivo QA `/tmp/guiaia-cobblemon-protocol-diagnosis-20261102.log`:

- **MCP real: PASS otra vez**: bloque de diamante 1, oveja 1, 16 bloques muestreados, permisos privados correctos. El servidor de laboratorio acabó y se retiró.
- **Cliente Mineflayer 4.39.0 / minecraft-protocol 1.68.0 / prismarine-registry 1.12.0**: llegó a `handshaking -> login -> configuration -> play`, recibió 2 paquetes en `login`, 18 en `configuration` y 79 en `play`.
- Emitió `mineflayer:login`, `mineflayer:game` y **`mineflayer:error`**, pero no `spawn`. El servidor sí registró entrada y salida de `CobblemonProbeQA`.
- **Fallo confirmado**: `Parse error for play.toClient: Read error for undefined : array size is abnormally large, not reading: 1718575989`. Los últimos 18 paquetes correctamente decodificados se denominan `play:custom_payload`. El número **no es una longitud válida autorizada** y no debe aceptarse o ignorarse como solución.
- No conocemos todavía el identificador exacto del **siguiente** paquete que falló ni su campo/esquema. Que el error ocurra después de `custom_payload` no demuestra que el paquete averiado sea uno de ellos, ni identifica por sí solo una causa NBT o Cobblemon concreta.

**Revisión de hipótesis:** el problema principal **no** es que la biblioteca se quede detenida en `configuration` ni que 16 segundos sean insuficientes: sí alcanza `play`, pero la decodificación falla de manera explícita antes del `spawn`. La biblioteca instalada ya tiene manejadores `settings` y `select_known_packs`; no se debe copiar un parche para versiones que no los incluyen. En las incidencias de PrismarineJS [#3787](https://github.com/PrismarineJS/mineflayer/issues/3787) y [#3573](https://github.com/PrismarineJS/mineflayer/issues/3573) se describen errores de tamaño semejantes en parsing NBT/SlotComponent, pero **la correspondencia con este caso sigue sin verificar**. En particular, las respuestas de mantenimiento advierten contra eliminar la comprobación de tamaño de array cuando la causa es un esquema incorrecto.

**Siguiente corrección acotada:** identificar el **ID/tipo del paquete que no pudo decodificarse** con trazas de metadatos sintéticos del flujo de entrada (sin persistir cargas ni claves); contrastar exactamente ese esquema con `minecraft-data`/`protodef` y el protocolo 1.21.1. Aplicar solo una corrección de contrato de paquete versionada y probada, o seleccionar un cliente Fabric real compatible. Repetir luego un inicio hasta `spawn` y **solo después** la misión firmada/caída del testigo. No debilitar límites de arrays, firmas, autoridad del propietario, permisos de un solo uso ni protección frente a replays.

**Seguimiento (2026-11-02):** las limitaciones de actuación de esta fase de observación se resolvieron posteriormente en **QA** mediante la corrección versionada de IDs de recetas (PR upstream #1291) y una misión firmada real **PASS**. Véase [QA_COBBLEMON_SIGNED_OPERATOR_2026-11-02.md](QA_COBBLEMON_SIGNED_OPERATOR_2026-11-02.md). No convertir el resultado histórico de esta fase en éxito retroactivo.
