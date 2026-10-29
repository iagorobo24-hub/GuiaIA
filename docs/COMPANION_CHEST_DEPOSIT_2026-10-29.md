# GuiaIA — Depósitos duraderos y recolección → cofre (2026-10-29)

**Estado: FASE QA DE LABORATORIO CERRADA Y VERIFICADA. NO APTO PARA PRODUCCIÓN.**

Repositorio público: `iagorobo24-hub/GuiaIA`. Rama de trabajo: `feature/companion-chest-deposit-qa`. No se han realizado cambios en Teselia, su mundo, sus servicios, su base de datos ni en la rama pública `main`.

## Qué funciona realmente

- `companion/src/deposit.js` admite solo un cofre `chest` autorizado mediante coordenadas exactas y materiales `oak_log` o `birch_log` en cantidades pequeñas y acotadas. Comprueba presencia del dueño, salud, radio máximo al dueño y proximidad al cofre.
- Cada transferencia comprueba dos variaciones independientes: el inventario del jugador disminuye la cantidad autorizada y las ranuras del cofre la aumentan exactamente. Abre el cofre real mediante Mineflayer 4.39.0 y una posición `Vec3` (error de integración detectado y corregido).
- `openDepositJournal` conserva un registro de escritura previa `transferring` con `fsync` antes de iniciar cada operación. Cada recibo contiene tipo, cantidad, posiciones autorizadas y saldos de ambos inventarios. Las operaciones sin resultado inequívoco pasan a `needs_review` y nunca se repiten automáticamente. Los archivos y el directorio del laboratorio quedan privados en Linux.
- `companion/test/qa_multiresource_server.js` verifica una partida **sin introducir objetos artificiales entre pasos**: un tronco de roble y uno de abedul minados realmente, navegación controlada hasta el segundo bloque, dos recibos de minería, depósitos de esos mismos objetos y dos recibos de almacenamiento, cierre y reapertura del cofre y del diario, y rechazo de repetición.
- El ensayo independiente `qa_chest_server.py` comprueba la API real de cofres con recursos inyectados **únicamente en su propio mundo sintético**. Su fuente está identificada claramente, sin confundirla con minería.

## Evidencia registrada

**Pruebas automatizadas:** 56 pruebas Node 22 y 50 Python superadas localmente; suites CI Node y Python también superadas para el código de esta fase.

**Minecraft Java 1.21.1 y Fabric reales (mundo temporal solo loopback):**
[CI integral 40855197839](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40855197839) — **SUCCESS**.
[CI de cofre independiente 40854617901](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40854617901) — **SUCCESS**.

| Prueba | Resultado real |
| --- | --- |
| Recolección sin `/give` | `oak_log=1`, `birch_log=1` |
| Movimiento al segundo recurso | 7 bloques medidos en la ejecución integral |
| Inventario tras depositar | 0 robles, 0 abedules |
| Cofre real reabierto | 1 roble y 1 abedul |
| Recibos de minería | 2 |
| Recibos de depósito | 2 |
| Diario reabierto | Correcto |
| Repetición de depósito terminado | Rechazada |
| Pruebas de observación, carga y seguimiento | Superadas |
| Entorno de prueba | Mundo Fabric desechable, puerto loopback, RCON deshabilitado |

Las ejecuciones anteriores que fallaron se conservaron para diagnóstico: la consulta inicial del cofre usaba un objeto ordinario en lugar de `Vec3` y causaba un error capturado por el diario, que pasó correctamente a `needs_review`. Se corrigió la causa y se agregó una regresión que comprueba explícitamente el tipo de coordenadas.

## Limitaciones y próximos bloqueos

El éxito en laboratorio **no demuestra** seguridad ni estabilidad en Teselia. Todavía faltan autenticación sólida del dueño/UUID (los nombres offline no son identidad), pruebas en terreno irregular y con cofres ocupados, desconexiones y caídas reales del servidor durante el depósito, reconciliación entre inventario persistido y diario, compatibilidad con Cobblemon y objetivos abiertos, política de autorización de cofres en mundos de amigos y auditoría de condiciones de carrera.

La simulación unitaria demuestra el estado seguro tras una interrupción, pero **no** se ha ejecutado una caída brusca de Minecraft durante una transferencia ni se han validado cofres en producción. Sigue prohibido desplegar, fusionar con `main` o conectar al mundo Teselia sin una autorización específica y superar esas barreras.
