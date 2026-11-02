# GuiaIA — reconciliación pasiva de dos autoridades QA ante pérdida de ACK y rollback

**Fecha:** 2026-11-02. **Base:** commit local `98ec0ae`. **Ámbito:** Chromebook Linux, testigo y custodio independientes *por proceso* con claves sintéticas, sin mundo Minecraft, sin agentes externos, sin acceso a Durán. Solo QA. **No es un protocolo de dos commits atómicos ni una defensa productiva frente a restauraciones de disco.**

## Objetivo

Separar tres escenarios que hasta ahora podían quedar ambiguos después de enviar un checkpoint al custodio:

- **Confirmación perdida después de escritura exitosa.** El custodio ya guardó y firmó el nuevo estado, pero la conexión HTTP se corta antes de que el cliente reciba el ACK. El reenvío de la misma solicitud no debe ser la política de recuperación.
- **Testigo adelantado con custodio atrasado.** Puede significar que la escritura del custodio nunca se confirmó, que se cayó, o que alguien restauró una copia antigua del suelo. Debe quedar señalado como **revisión manual necesaria**, no como autorización o reintento automático.
- **Desacuerdo de hash, suelo adelantado, ausencia de cualquiera de las autoridades o variación de estado durante la consulta.** Debe fallar de manera cerrada. No se autoriza movimiento, depósito, minería, recuperación de journals ni consumo de nuevos permisos.

## Implementación

`companion/src/qa_floor_reconciler.js` expone `createQaFloorReconciler({...}).inspect()`. Instancia **internamente** los clientes existentes con claves Ed25519 fijadas, URL local restringida, nonce de petición y caducidad estricta. La observación consiste en tres lecturas de red:

1. Recuperar suelo firmado del custodio (nonce nuevo).
2. Recuperar checkpoint firmado del testigo (nonce nuevo).
3. Recuperar otra vez el suelo firmado (nonce nuevo).

Si las dos lecturas del suelo discrepan, la ejecución **falla** por carrera; si el testigo queda por debajo del suelo, también falla; si las secuencias coinciden pero los hashes difieren, falla. Si el testigo está por delante, devuelve `qa_witness_ahead_requires_review` con `requiresManualReview=true`. Si ambos coinciden, devuelve `qa_equal_observation`, pero **nunca autorización de acciones**. En todos los resultados favorables se explicita `read_only=true`, `world_actions=false`, `production_ready=false`, `atomic_snapshot=false`.

No existe un endpoint de escritura ni de reparación en el reconciliador. **Un resultado positivo no demuestra atomicidad**, puede dejar de ser válido inmediatamente después de leerlo, y no debe convertirse en una capacidad o permiso del bot.

## Evidencia reproducible

Las pruebas de `qa_floor_custodian.test.js` ejercitan servidores HTTP reales 127.0.0.1, archivos 0600 y firmas independientes. Incluyen:

- Secuencias firmadas 0→1, ambos estados coincidentes, testigo adelantado, y avance del custodio solo con una **operación explícita distinta**.
- Proxy del laboratorio que **reenvía POST al custodio, recibe su 200 después del commit y destruye la conexión al cliente sin entregar el ACK**. La publicación falla desde el cliente, pero una consulta pasiva confirma las dos autoridades en secuencia 1; se demuestra rechazo de un segundo envío del mismo avance.
- Servicio del custodio desconectado tras avanzar el testigo. La inspección falla cerrada mientras está desconectado; después de reiniciarlo señala revisión manual con estado del custodio antiguo.
- Restauración simulada **de ambos** archivos antiguos firmados. La inspección vuelve a informar que ambos coinciden en secuencia 0. **No detecta el rollback total**: la firma y el segundo proceso, por sí solos, son insuficientes.
- Firmas válidas pero **hashes divergentes en una misma secuencia**, que producen rechazo.
- Carrera determinista: el custodio cambia entre las dos lecturas de su estado, y el reconciliador lo rechaza; al volver a leer el estado estable, ambas autoridades concuerdan.

Estas pruebas no alteran servidor de Teselia, credenciales de cuentas reales, mundos compartidos ni Git remoto.

## Validación final

- Pruebas focales del custodio y la reconciliación: **15/15 PASS**.
- Suite Node completa `npm test`: **405/405 PASS** (0 fallos, 0 omitidas).
- Python `PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -q`: **58/58 PASS**.
- Sintaxis de JavaScript y `git diff --check`: PASS. Proceso Minecraft original de Teselia observado sin intervención, PID 11085. Ningún puerto QA de la batería escuchando tras las pruebas.

## Pendiente antes de producción

La reconciliación es observacional, no una operación linealizable: no ofrece ni un protocolo transaccional de compromiso distribuido ni consistencia ante un atacante que controle ambas copias. Para producir garantías reales deberán definirse **anclaje monotónico exterior a la misma superficie de restauración**, política de pérdida de ACK y comprobación de estado persistido, gestión segura de claves, tolerancia a apagones, límites de ventana de frescura y política de intervención humana. También quedan el reinicio completo de WSL2 de Durán, consentimiento e identidad oficial de Minecraft y beta controlada. No autorizar acciones del mundo mediante estos diagnósticos.
