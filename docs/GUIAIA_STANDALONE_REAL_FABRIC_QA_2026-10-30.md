# GuiaIA — prueba del operador independiente contra Fabric 1.21.1 real

**Fecha:** 30/10/2026
**Alcance:** mundo desechable, loopback, cuentas offline sintéticas de QA.
**Exclusiones:** Teselia, mundos privados, Cobblemon productivo, cuentas Microsoft reales y despliegue.

## Objetivo y contrato

El runner `scripts/qa_signed_delivery_real_server.py --standalone-operator`
levanta el servidor Fabric 1.21.1 en un directorio temporal
`/tmp/guiaia-fabric-bridge-qa-*`, con el bridge Ed25519 y el servicio
de presencia firmado. Conserva intactos los escenarios históricos y
requiere los mismos tres JAR explícitos: launcher, Fabric API y mod.

A diferencia del ensayo anterior, el nuevo conductor
`companion/test/qa_standalone_operator_real_fabric.js`:

1. Conecta un propietario QA real vía Mineflayer y lee su JOIN firmado
   por el mod Java y su presencia actual por TCP.
2. Genera claves sintéticas de QA **fuera del lanzador**, inscribe al
   propietario con autorización y consentimiento Ed25519, persiste el
   registro y publica la secuencia de checkpoints firmada a un testigo
   de laboratorio independiente del registro (aunque sigue en loopback).
3. Prepara dos diarios durables y un plan de recolección y depósito
   ya autorizado, además de dos permisos Ed25519 para un único bloque.
4. Cierra los archivos de preparación y arranca el nuevo
   `companion/qa_operator.js --qa-operate` **como proceso separado
   con una TTY real**. El lanzador no conoce el código de los firmantes,
   no inscribe identidades y no genera permisos.
5. El servidor entrega a `GuiaIA_QA` un tronco inicial sintético.
   El operador ejecuta `mision` en TTY y luego `salir`.
6. Una vez cerrado el operador, se comprueba por separado el tronco
   realmente excavado, el contenido **real** del cofre consultado
   por el otro cliente Mineflayer, los dos recibos persistidos y los
   dos nonces de acción consumidos. Solo entonces emite
   `GUIAIA_STANDALONE_OPERATOR_REAL_FABRIC_QA_EVIDENCE`.

El cierre del runner detiene únicamente su propia JVM de laboratorio,
retira los temporales y no toca el servidor Teselia.

## Primer resultado observado

El primer intento agotó el tiempo predeterminado de 390 segundos
durante la primera descarga y carga de Fabric en Chromebook. El servidor
escribió `Done` justo después del vencimiento y fue detenido por el
runner. Código de salida 1, sin ejecutar ninguna misión.
Se cambió **solo este modo** a un máximo de 660 segundos para el
arranque inicial. No se ampliaron las caducidades de los permisos
firmados; el TTL del JOIN se mantiene en 120 segundos desde la conexión.

## Ejecución

```bash
JAVA_HOME=/ruta/a/java21 PYTHONPATH=src python3 \
  scripts/qa_signed_delivery_real_server.py \
  --launcher /ruta/a/fabric-server-1.21.1-launcher.jar \
  --fabric-api /ruta/a/fabric-api-1.21.1.jar \
  --mod /ruta/a/guiaia-world-observer-0.1.0-alpha.1.jar \
  --standalone-operator
```

Solo se admite un mundo de prueba a la vez. El resultado no demuestra
identidad de Minecraft online ni que el testigo esté fuera del equipo.
Las caducidades de conexión y sesión pueden bloquear una misión lenta;
esto debe tratarse como rechazo seguro, nunca como permiso para omitir
la autorización. No emplear el modo QA en mundos compartidos.

## Segundo resultado: misión real completa, salida del operador bloqueada

El segundo ensayo superó el arranque de Fabric, conectó dos clientes QA,
validó el alta y el testigo, y ejecutó `mision` en la TTY de
`qa_operator.js`. Las comprobaciones directas de los diarios
mostraron:

- `mission.phase=completed`, un recibo
  `inventory_and_block_verified`.
- `deposit.phase=completed`, un recibo
  `two_sided_inventory_receipt`.
- El bot `GuiaIA_QA` se desconectó al recibir `salir`; el servicio
  liberó los locks de misión y depósito.

Sin embargo, el proceso Node permaneció activo por handles de
terminal/Mineflayer y la supervisión independiente agotó los 10
segundos de cierre: `Operator TTY did not shut down`. El runner
terminó con código 1, **sin marcador de aceptación**. La verificación
externa del contenido real del cofre no llegó a completarse.

Se corrigió la entrada ejecutable `qa_operator.js` para finalizar el
proceso únicamente **después de** que la operación retorne, el
`finally` cierre bot/diarios/registro y la salida pública se vacíe.
La batería focal de 14 pruebas Node continuó pasando.

**Criterio aún no cerrado hasta repetición:** marcador completo con
cofre físico = 1, dos recibos, dos nonces consumidos y salida 0.

## Tercer y cuarto intento: diagnóstico y cierre verificado

El tercer intento arrancó Fabric correctamente, pero el cliente
`OwnerQA` abandonó el servidor antes del arranque del bot. El runner
anterior no conservó la salida del proceso hijo y terminó con
`Timed out waiting for two real QA clients joined`. No hubo acción
de mundo en este intento. Se añadió al runner una comprobación inmediata
del proceso hijo y su salida, y al conductor una espera acotada por
evento JOIN completo y presencia reciente: la validación de firmas
inválidas, la revocación y la caducidad **no** se relajan.

El **cuarto intento concluyó con código de salida 0**, y ambos puertos
de QA quedaron libres. Evidencia original del runner:

```json
{
  "result": "pass",
  "production": false,
  "real_fabric": true,
  "offline_account_identity": false,
  "standalone_tty": true,
  "external_qa_signers": true,
  "live_fabric_presence": true,
  "signed_remote_witness_on_loopback": true,
  "independently_signed_grants": 2,
  "spent_nonces": 2,
  "gathered_oak_log_real": true,
  "physical_chest_oak_log": 1,
  "mission_receipts": 1,
  "deposit_receipts": 1,
  "replay_not_attempted": true,
  "teselia_untouched": true
}
```

El conductor comprobó el **contenido del cofre desde el segundo cliente**
una vez concluida la misión, además de los diarios y los dos archivos
duraderos de nonces gastados. El lanzador recibió `salir`, liberó
sus bloqueos y terminó sin intervención; la JVM de laboratorio se
detuvo y el directorio temporal fue eliminado por el runner.
Logs del ensayo local: `/tmp/guiaia-standalone-real-fabric-r4-20261030.log`.

Esta prueba cubre el **arranque integrado y la transferencia física
con autorizaciones sintéticas en Fabric real**. No acredita una sesión
online Microsoft, la identidad real del operador, una instalación
reproducible en otro equipo, Cobblemon ni resistencia a fallos
de producción. El mismo permiso no se reenvió en este ensayo específico;
la protección de replay se verifica en otras pruebas automatizadas.

## Revocación posterior a una misión real: comprobación negativa (30/10/2026)

Se amplió el mismo ensayo de operador autónomo, sin modificar Teselia ni
introducir una ruta de ejecución nueva. Tras acreditar una misión completa y
verificar físicamente un roble dentro del cofre, el conductor:

1. Cierra el operador y conserva una copia binaria de los dos diarios y el
   recuento de los dos nonces consumidos.
2. Reabre el registro de identidades persistido, aplica un **ticket Ed25519
   de revocación** para el propietario QA y confirma `isRevoked=true`.
3. Publica el nuevo checkpoint firmado al testigo existente y comprueba
   por separado que la secuencia avanzó de 1 a **2**.
4. Inicia un **segundo proceso Node**, `qa_operator.js --qa-preflight`,
   utilizando exactamente las mismas credenciales sintéticas que antes
   habían permitido la misión. Exige salida **2** y motivo explícito
   `Principal revoked or registry unavailable`, sin sesión emitida.
5. Compara los archivos de misión y depósito byte a byte, el recuento de
   nonces consumidos y el contenido del cofre desde el otro cliente.

**Resultado observado:** `GUIAIA_STANDALONE_OPERATOR_REAL_FABRIC_QA_EVIDENCE`
con `result=pass`, `signed_revocation_durable=true`,
`revocation_checkpoint_sequence=2`, `post_revocation_preflight_exit=2`,
`post_revocation_preflight_denied=true`,
`world_action_journals_unchanged_after_denial=true` y
`chest_unchanged_after_denial=true`. El runner finalizó con **código 0**.
La JVM de prueba se detuvo, sus directorios temporales se limpiaron y
los puertos de QA 25593/25594 quedaron libres.

El resultado demuestra el **rechazo de nuevas sesiones después de revocar**
una identidad sintética previamente autorizada. No se ha probado en esta
fase la revocación durante una acción ya iniciada, cuentas Minecraft online,
ni un testigo alojado físicamente fuera del Chromebook. La prueba de
replay de los mismos grants permanece cubierta por otras pruebas; este
ensayo no reutilizó permisos.

Log local de este ensayo: `/tmp/guiaia-revocation-real-fabric-20261030.log`.
