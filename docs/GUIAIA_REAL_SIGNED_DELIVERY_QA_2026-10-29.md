# GuiaIA: misión firmada completa en Fabric real (QA)

Fecha: 29/10/2026. Rama: feature/principal-enrollment-qa.
No se ha instalado ni desplegado nada en Teselia.

## Evidencia

scripts/qa_signed_delivery_real_server.py creó un servidor Fabric 1.21.1
desechable y limitado a 127.0.0.1:25593. El puente de conexiones usó
una clave Ed25519 efímera. La prueba creó un segundo cofre y un tronco
en posiciones exactas, con dos clientes Mineflayer reales.

El plan emitido se vinculó a la conexión firmada del propietario,
a la identidad QA, al mundo, al tronco y al cofre. El resultado fue:

- Aproximación al tronco: 4,00 bloques de movimiento medido.
- Extracción del bloque y recogida real en inventario: PASS.
- Regreso hacia el cofre: 3,62 bloques de movimiento medido.
- Transferencia real de un tronco al segundo cofre: PASS.
- Diario de recolección: 1 recibo durable.
- Diario de depósito: 1 recibo durable.
- Regresión histórica de seguimiento firmado y revocación: PASS.
- Pruebas Node de la rama: 297/297 PASS.

La prueba no declara éxito sin observar el bloque eliminado,
el incremento de inventario, el decremento tras la transferencia,
el material almacenado en el cofre y ambos movimientos.

El lanzador cerró el proceso Java de prueba y eliminó el mundo temporal.
Los marcadores y hashes figuran en
docs/evidence/GUIAIA_REAL_SIGNED_DELIVERY_E2E_2026-10-29.json.

## Limitaciones reales

El mundo temporal ejecuta Minecraft en offline-mode; las claves de
operador y propietario son sintéticas y el testigo firmado se aloja
todavía en el Chromebook, no en un servicio externo inmutable.
Esta prueba demuestra una misión de un tronco y un cofre, no
integración con permisos de regiones, Cobblemon o amigos reales.

Quedan pendientes el enrolamiento auténtico de amigos, testigo
externo protegido, varias tareas y recursos, y recuperación de
una sesión interrumpida durante la ejecución, antes de producción.

No se ha hecho push, PR, merge ni despliegue.