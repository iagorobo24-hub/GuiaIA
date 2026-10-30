# GuiaIA — seguimiento firmado (QA aislado)

Fecha: 2026-10-29. Rama: feature/principal-enrollment-qa.
Sin despliegue en Teselia, push, PR ni merge.

El CLI sigue rechazando follow. El nuevo modulo
companion/src/qa_authorized_follow.js es solo para pruebas.

El permiso de movimiento guiaia:session-follow:v1 requiere una firma
Ed25519 del operador, mundo, bot, principal, conexion, desafio,
nombre del propietario, nonce de un solo uso y duracion maxima de 10 s.
Su inicio comprueba la sesion firmada, la presencia viva de Fabric,
el registro de revocacion y un testigo criptografico separado.
El nonce se consume de forma durable antes de mover el pathfinder.

Durante el movimiento, el monitor comprueba cada 250 ms la presencia,
revocacion, testigo, expiracion, distancia, salud y eventos de desconexion.
Sin nueva validacion el movimiento se detiene en un maximo nominal
de 1500 ms, incluso si una consulta de red queda pendiente.

Las pruebas dirigidas cubren firma falsa, cambio de objetivo o mundo,
caducidad, desconexion, salud, distancia, testigo caido, revocacion
durante una consulta, detencion antes de iniciar, repeticion del nonce
y bloqueo prolongado de red.

La integracion real se realiza solamente en un mundo Fabric desechable
con claves efimeras de laboratorio. El testigo todavia comparte Penguin
y no es un almacen seguro externo resistente al rollback total.
No hay identidad real de amigos, controles de regiones o claims ni
activacion del seguimiento desde la CLI. El ensayo real no demuestra
por si solo distancia recorrida: el objetivo comprobable es la
aceptacion del movimiento y su parada tras la revocacion.

Logs locales:
- /tmp/guiaia-signed-follow-focused-20261029.log
- /tmp/guiaia-follow-node-global-20261029.log
- /tmp/guiaia-signed-follow-real-fabric-20261029.log

El resultado de Fabric debe verificarse en el log antes de
marcarlo como superado. No despliegue en produccion.

## Resultado real verificado

Regresion Node: 176/176. Movimiento firmado: 13/13.
Fabric real desechable: cinco marcadores PASS, incluido seguimiento
firmado detenido tras revocacion y verificacion del testigo QA.
El timeout de arranque QA aumento de 240 a 390 s porque el
primer intento agoto el limite mientras terminaba de iniciar Fabric.
