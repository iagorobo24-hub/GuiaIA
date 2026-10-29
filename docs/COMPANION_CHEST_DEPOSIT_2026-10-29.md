# GuiaIA — depósito supervisado en cofre (2026-10-29)

**Estado: implementación experimental y pruebas unitarias añadidas; integración Minecraft real pendiente.**

Rama: `feature/companion-chest-deposit-qa`. Esta funcionalidad no está conectada a Teselia, ni a las órdenes de chat o a un modelo generativo.

## Implementación

- `companion/src/deposit.js`: una transferencia exacta, limitada a `oak_log` o `birch_log`, hacia un cofre `chest` en las coordenadas que autoriza previamente el operador.
- Antes de interactuar se verifica dueño visible, salud mínima, distancia máxima de 18 bloques al dueño y 4,2 al cofre, tipo del bloque, presencia y cantidad del material.
- La interfaz del cofre expone dos grupos de ranuras: las del contenedor y las del jugador. Solo se considera que la transferencia ha tenido éxito cuando las primeras aumentan exactamente la cantidad autorizada **y** las segundas disminuyen en esa misma cantidad.
- `openDepositJournal` guarda con `fsync` un estado `transferring` antes de ejecutar cualquier depósito. Un resultado incompleto pasa a `needs_review`; tras un reinicio con operación pendiente se bloquea cualquier repetición automática.
- Recibos tipados con material, cantidad, saldo inicial/final del jugador y saldo inicial/final del cofre, identificador por operación y bloqueo exclusivo de procesos. Directorio y archivos privados (`0700` y `0600` en Linux).
- Ninguna orden puede elegir libremente cofres, objetos o cantidades. Las credenciales y los datos del mundo de Teselia no están involucrados.

## Pruebas incluidas

`companion/test/deposit.test.js` contiene casos para doble comprobación de saldos, persistencia de dos recibos, ubicación o material falsos, cofre incorrecto, dueño ausente, salud baja, distancia excesiva, inventario insuficiente, transferencia incompleta, cancelación, interrupción tras escritura previa, reinicio y bloqueo exclusivo.

**Limitación de evidencia:** en esta sesión no se ha podido instalar la preparación del cofre en el servidor desechable ni ejecutar con éxito una transferencia contra Minecraft real. Por ello **no está validada la compatibilidad final con el protocolo de cofres de Minecraft 1.21.1**. Tampoco está demostrado el flujo completo de recolección hasta depósito en cofres tras un reinicio del servidor.

## Condiciones de cierre pendientes

1. Ejecutar las pruebas Node 22 y registrar su resultado verificable en GitHub Actions.
2. Ejecutar en servidor Minecraft 1.21.1 desechable una transferencia real de un roble y un abedul. Exigir inventario del jugador 1→0 para cada material, cofre 0→1, cierre y reapertura del cofre, y recepción duradera de ambos recibos sin repetición.
3. Repetir el ensayo con cancelación/desconexión e inventario incoherente para confirmar el bloqueo `needs_review` sin pérdidas ni duplicaciones.
4. Auditar carrera entre lectura/uso de contenedores y autenticación del dueño antes de considerar cualquier despliegue.

**No conectar ni desplegar en Teselia.** La rama está separada y no debe fusionarse hasta que se cumplan las condiciones de aceptación.
