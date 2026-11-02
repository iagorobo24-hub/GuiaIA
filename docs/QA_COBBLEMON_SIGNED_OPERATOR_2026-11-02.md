# GuiaIA + Cobblemon — corrección de recetas y misión firmada (QA)

**Fecha:** 2026-11-02. **Base Git:** `97f6090` (`main`, cambios locales posteriores a verificar). **Resultado:** Mineflayer `spawn` PASS y misión firmada de recolección/deposito/revocación **PASS** en servidor real Fabric+Cobblemon aislado. **No es beta ni producción.**

## Causa verificada del bloqueo

La instrumentación de `companion/test/qa_cobblemon_client_probe.js` observó antes de decodificar el paquete `play.toClient` ID `0x77` **`declare_recipes`**, de **194539 bytes**; el parser antiguo de `minecraft-data` 1.21.1 falló con longitud de array inválida `1718575989` y no emitió `spawn`. Esa cifra no era una longitud de array admisible; no se ha aumentado ni desactivado el límite.

La [PR upstream PrismarineJS/minecraft-data #1291](https://github.com/PrismarineJS/minecraft-data/pull/1291) (abierta/no fusionada al consultar) corrige un ID de serializador vanilla 1.21.1: elimina `minecraft:crafting_special_banneraddpattern` y desplaza posteriores IDs. Confirmamos contra la estructura de la versión instalada que el mapeo antiguo contiene 24 tipos y el corregido, **23**. En el JAR Cobblemon también se verifican serializadores `cobblemon:cooking_pot`, `cobblemon:cooking_pot_shapeless` y `cobblemon:brewing_stand`. No se han implementado tipos inventados ni se ha desactivado la lectura de recetas.

Se implementó una corrección **únicamente QA** en `companion/test/qa_cobblemon_recipe_ids_qa.js`: exige precondiciones exactas del esquema, modifica solo en memoria el mapeo del proceso de laboratorio, comprueba su resultado y falla si el proveedor ya cambió. Se activa exclusivamente con `GUIAIA_QA_UPSTREAM_RECIPE_IDS=1` y, para operador/propietario, `GUIAIA_QA_COBBLEMON=1` en mundo de prueba preaprobado. No se edita `node_modules` ni se cambia el protocolo productivo.

## Evidencia real y verificaciones

1. Sonda sin acciones, mundo nuevo con Fabric 1.21.1 / Cobblemon 1.8.2: `spawned=true`, `error=""`, `handshaking → login → configuration → play`, paquete de recetas leído y recepción posterior de `update_health` (evento `spawn`). Registro: `/tmp/guiaia-cobblemon-upstream-recipe-ids-20261102.log`. Observador MCP también PASS con diamante y oveja reales.
2. Misión real en **otro mundo desechable** (solo loopback `127.0.0.1:25593/25594`, offline sintético): `OwnerQA` y `GuiaIA_QA` entraron con la corrección; autoridad de identidad del servidor explícitamente habilitada, claves y grants Ed25519 externos al bot, testigo firmado en loopback y acciones mediadas por runtime. Registro: `/tmp/guiaia-cobblemon-signed-mission-upstream-20261102.log`.
3. Marcadores verificados: `GUIAIA_STANDALONE_OPERATOR_REAL_FABRIC_QA_EVIDENCE` con `result=pass`, `real_fabric=true`, `mission_receipts=1`, `deposit_receipts=1`, `physical_chest_oak_log=1`, `spent_nonces=2`, `signed_revocation_durable=true`, `revocation_checkpoint_sequence=2`, `post_revocation_preflight_denied=true`, `world_action_journals_unchanged_after_denial=true`, `chest_unchanged_after_denial=true` y `teselia_untouched=true`. Marcador separado `GUIAIA_COBBLEMON_FABRIC_COMPAT_QA_EVIDENCE` confirma el JAR activo y `scenario=standalone-operator`. **Proceso de QA: exit 0**.
4. El lanzamiento copia bibliotecas y `.fabric/server` originales a un directorio de laboratorio antes de ejecutar. Nunca usa enlaces al runtime de Teselia; las copias y mundos son efímeros.


## Testigo en proceso separado: caída durante misión Cobblemon

**Ensayo real ejecutado, PASS, código de salida 0.** En otro mundo Fabric 1.21.1 desechable con Cobblemon 1.8.2 activo se invocó `scripts/qa_signed_delivery_real_server.py --cobblemon ... --standalone-witness-outage`. El propietario y el bot sintéticos se unieron al mundo. El testigo Ed25519 era **un proceso separado de la misma máquina Chromebook** (no Durán). Se confirmó físicamente una recolección autorizada antes de apagar el testigo, después se intentó el depósito y se exigió rechazo seguro. La recuperación no volvió a ejecutar la acción cancelada.

El marcador del proceso `GUIAIA_STANDALONE_WITNESS_OUTAGE_REAL_FABRIC_QA_EVIDENCE` verificó `result=pass`, `real_fabric=true`, `standalone_witness_process=true`, **`physical_remote_witness=false`**, `real_gather_receipts=1`, `real_deposit_receipts=0`, `physical_mined_block=true`, `physical_chest_oak_log=0`, `witness_disconnection_denied=true`, `deposit_authorization_denied=true`, `journals_unchanged_during_outage=true`, `spent_nonces=1`, `durable_deposit_cancellation=true`, `persisted_signed_sequence=1`, `restarted_witness_verified=true`, `recovery_preflight_exit=0`, `no_automatic_world_action_replay=true` y `teselia_untouched=true`. El segundo marcador `GUIAIA_COBBLEMON_FABRIC_COMPAT_QA_EVIDENCE` confirma `scenario=standalone-witness-outage` con Cobblemon 1.8.2. Registro: `/tmp/guiaia-cobblemon-witness-outage-20261102.log`. Proceso Python de prueba **exit 0**.

**Límite:** no equivale a cortar el cable de red entre dos equipos ni a reiniciar Durán/WSL; el ensayo de testigo físicamente remoto se validó anteriormente con **Fabric sin Cobblemon**. No se manipularon Teselia ni los archivos del mundo compartido.

## Límites y continuación

Este éxito demuestra la interoperabilidad **de vanilla Mineflayer con el servidor Cobblemon durante la misión de troncos**, no soporte de acciones Pokémon ni del protocolo Cobblemon completo. La identidad fue offline sintética; no hubo autenticación Microsoft oficial, permisos de jugadores reales, despliegue productivo ni un testigo físico en otro ordenador en este ensayo. El testigo independiente en otro **proceso local**, su caída y la recuperación sin replay también están ahora validados en Cobblemon, como se detalla arriba. El parche upstream sigue sin fusionar y **no debe trasladarse a producción sin revisión, tests de regresión y una estrategia de versión fija**.

La regresión Python posterior a los cambios terminó con **58/58 PASS**. La suite completa Node (`npm test`) terminó con **369/369 PASS**, 0 fallos, 0 omisiones y código de salida 0. Ambas verificaciones son sobre el árbol de esta fase, con los escenarios reales aislados documentados arriba. No efectuar push, PR, merge ni despliegue sin autorización explícita.
