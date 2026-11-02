# GuiaIA — misión Fabric real con testigo Ed25519 en un segundo ordenador

**Fecha:** 2026-11-02. **Rama base:** `main`, HEAD inicial `123b2b7`. **Resultado definitivo:** PASS, código de salida 0, **326,90 s**. **Solo QA**, sin autenticación Microsoft y sin tocar Teselia.

## Alcance y aislamiento

- **Chromebook:** mundo Minecraft Fabric **1.21.1** desechable en `/tmp/guiaia-fabric-bridge-qa-*`; operador Mineflayer bajo un proceso TTY separado, propietario QA `OwnerQA`, bot `GuiaIA_QA` y mod de identidad firmado; servicio enlazado a loopback (`25593/25594`). El operador empleó una clave Ed25519 privada **preprovisionada** en un directorio temporal 0700, fichero 0600; únicamente su clave pública se entregó a Durán.
- **Durán, Ubuntu WSL2:** `qa_witness.js` en un proceso separado, almacén de checkpoint y clave privada **propios** en `/tmp` privado. Solo la clave pública del testigo se entregó al Chromebook. Se verificaron las huellas públicas intercambiadas por SHA-256 SPKI.
- **Transporte:** HTTP de testigo limitado a `127.0.0.1` en WSL2; adaptador HTTP local; Tailscale Serve **HTTPS solo tailnet, sin Funnel**; cliente `tailscale nc` y `socat` en espacio de usuario desde Crostini; proxy HTTPS QA del repositorio en `127.0.0.1:24121`, con SNI del host Durán y `rejectUnauthorized:true`. Antes de arrancar Fabric, `curl --connect-to` comprobó `REMOTE_HTTP=403` esperado y **`TLS_VERIFY=0`**.
- **Identificador exacto:** `qa:real-fabric:25593`. La autoridad del testigo **no** posee la clave privada del operador o del propietario, y la autoridad del operador **no** posee la clave privada del testigo.

La nueva opción `--physical-witness-outage` de `scripts/qa_signed_delivery_real_server.py` solo funciona con `GUIAIA_QA_PHYSICAL_WITNESS_DIRECTORY` y una autoridad externa de prueba. `companion/test/qa_physical_witness_fixture.js` comprueba directorio 0700, ficheros 0600, claves Ed25519 y rutas temporales estrictas. La entrada `companion/qa_physical_witness_proxy.js` se liga únicamente a loopback y autentica HTTPS frente al host tailnet explícitamente fijado. No existe un acceso sin firma al estado del testigo ni un modo alternativo que omita sus pruebas.

## Ensayo end-to-end verificado

Se generaron externamente dos capacidades de acción de un solo uso, un registro de identidad y el consentimiento Ed25519 del propietario sintético. El proceso del testigo ubicado en Durán recibió y persistió los avances firmados del checkpoint, secuencia **0 → 1**.

El operador en el Chromebook realizó físicamente la recolección de un roble autorizado. **Tras confirmar un único recibo real de extracción**, el controlador QA creó la marca privada `outage-requested`; el proxy cliente interrumpió las conexiones hacia Durán cerrando sus sockets. No se apagó Durán ni se alteró su estado firmado, pero la ruta de red que consume el operador quedó indisponible. El operador intentó el depósito y recibió `authorization_unavailable`. Se verificaron los diarios y un segundo cliente leyó el cofre: **cero troncos depositados**; un único nonce gastado y ninguno correspondiente al depósito. Al cerrar el operador se persistió la cancelación segura.

La marca privada `restore-requested` restableció el paso HTTPS hacia **el mismo testigo** y **la misma clave** en Durán. La nueva verificación de checkpoint y un preflight de identidad independiente dieron resultado positivo, **sin reejecutar el depósito cancelado**. Se verificó directamente en Durán el `head.json` con el mundo correcto, la huella del operador y `sequence=1`.

Marcador `GUIAIA_STANDALONE_WITNESS_OUTAGE_REAL_FABRIC_QA_EVIDENCE`:
- `result=pass`, `real_fabric=true`, `physical_remote_witness=true`, `offline_account_identity=false`.
- `real_gather_receipts=1`, `real_deposit_receipts=0`, `physical_mined_block=true`, `physical_chest_oak_log=0`.
- `witness_disconnection_denied=true`, `deposit_authorization_denied=true`, `journals_unchanged_during_outage=true`, `spent_nonces=1`.
- `durable_deposit_cancellation=true`, `persisted_signed_sequence=1`, `restarted_witness_verified=true`, `recovery_preflight_exit=0`, `no_automatic_world_action_replay=true`, `teselia_untouched=true`.

**Precisión:** `restarted_witness_verified` es el nombre heredado del marcador común del runner; en este escenario significa que **se restauró la conectividad y se verificó el testigo remoto original**, no que se reiniciara el proceso WSL. El reinicio físico del proceso del testigo se verificó por separado en `QA_REMOTE_WITNESS_PROCESS_RESTART_2026-11-02.md`.

## Fallos previos y corrección mínima

1. Primer intento: señalización manual del corte demasiado lenta (`Physical QA link coordination unavailable`); Java y el mundo QA se apagaron, sin depósito autorizado. Se eliminó la dependencia de órdenes manuales: la falla se inyecta automáticamente **en el proxy local del Chromebook**, sin manipular Durán ni alterar los límites de firma.
2. Segundo intento: durante el arranque de Fabric, Durán **persistió el checkpoint inicial, secuencia 0**, pero se perdió el acuse HTTP dentro del plazo de 1,5 segundos. El cliente se detuvo de forma segura antes de aceptar la sesión. El controlador QA adquirió una reconciliación **solo de lectura**: ante ACK incierto, nunca retransmite automáticamente un ticket CAS, sino que espera una nueva prueba Ed25519 firmada del checkpoint exacto esperado; si no llega, rechaza. El plazo absoluto de cada petición permanece en **1.500 ms**, sin rebajarse las validaciones.
3. Tercer intento: claves y estados QA efímeros renovados en ambos extremos, arranque estabilizado 12 segundos antes de la ceremonia remota, prueba completa **PASS**. El mundo y la JVM desechables terminaron limpiamente.

## Validaciones y límites

- Fabric real 1.21.1 con JAR de observación previamente compilado; este ensayo **no recompila el JAR desde fuentes actuales**.
- Python, **58/58** pruebas unitarias: PASS; pruebas focales del aislamiento/fallo y recuperación del fixture Node, **2/2**: PASS. Node `npm test`, **368/368 PASS**, 0 fallos y 0 omisiones (código de salida 0).
- **No es** una beta, un ensayo de identidad oficial de Minecraft, un mundo con Cobblemon, un reinicio completo de Windows/WSL, un test de pérdida física total de Durán ni un despliegue productivo. En este escenario **se corta deliberadamente el puente de red del cliente**, mientras Durán sigue encendido. El testigo todavía requiere una política real de persistencia/ACL, operación y despliegue antes de producción.
- Todo el tráfico, claves y mundos se mantienen bajo controles de laboratorio. Los proxies y servicios temporales no deben exponerse a LAN ni a internet.

**Próximas fases:** identidad y consentimiento oficiales online-mode, QA Cobblemon aislado, persistencia/endurecimiento del testigo fuera de rutas efímeras y beta controlada con instalación limpia.
