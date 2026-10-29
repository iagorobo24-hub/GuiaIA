# GuiaIA — diagnóstico de recogida incompleta y arnés de caída de misión firmada

Fecha: 29/10/2026. Rama: feature/principal-enrollment-qa.
Ámbito: mundo Fabric 1.21.1 desechable; ninguna acción en Teselia.

## Ensayo y alcance

Se añadió a scripts/qa_signed_delivery_real_server.py la opción
--crash-after-deposit. Solo el cliente Mineflayer de QA recibe la
variable de inyección. La prueba exige que el operador haya firmado
la misión y que Fabric y el testigo hayan autorizado la sesión.

El punto de inyección es **después de comprobar una transferencia real**
en ambos inventarios y **antes de que el diario de depósito confirme
el recibo durable**. El cliente sale deliberadamente con código 77.

El auditor qa_real_signed_delivery_crash_audit.js comprueba, después de
reiniciar el mismo mundo temporal, que el tronco sigue extraído, que
el cofre contiene una unidad, que el bot conserva la unidad sobrante,
que el diario de recolección guarda un recibo, que el de depósito está
en transferring sin recibo y que los bloqueos y permisos consumidos
impiden repetir automáticamente la operación. La auditoría no excava
ni deposita nada.

## Resultados observados

La ejecución completa anterior, registrada en
GUIAIA_REAL_SIGNED_DELIVERY_E2E_2026-10-29.json, sí superó una
recolección y un depósito reales.

Se ejecutaron dos intentos posteriores con la inyección habilitada.
**Ambos fallaron durante la recolección, antes del punto de caída.**
La primera ejecución dejó mission.phase=needs_review,
mission.index=0, cero recibos y deposit.phase=ready.

En la segunda se añadieron diagnósticos solo al arnés QA. El bot
salió desde (2.5,64,2.5), terminó en (4.5,64,2.5) y registró dos
objetivos de navegación hacia el tronco (7,64,2). El bloque estaba
en estado air, pero el inventario de oak_log continuaba en una unidad
sin aumento. El propietario seguía visible y la salud era 20.
El diario volvió a needs_review sin recibo. El servidor también
registró retrasos de ticks. No se ha determinado si la falta de
recogida procede de navegación, demora del servidor, entidad de
objeto o renovación de la autorización; no debe atribuirse a una
causa específica sin más instrumentación.

Resultado de la prueba de caída tras depósito: **NO VERIFICADO**.
No debe divulgarse como PASS. La instrumentación no debilita los
límites de autorización ni permite reintentar pasos inciertos.

## Protección verificada

Se añadió una regresión al circuito firmado:
qa_delivery_navigation_integration.test.js. Comprueba que extraer
un bloque sin registrar su recogida no crea recibo de misión,
no realiza depósitos ni repite la extracción al reintentar la
ejecución del coordinador.

El flujo queda protegido frente a duplicaciones; eso NO implica
que la recolección esté estabilizada en un servidor con lag.

## Prioridad para el siguiente desarrollo

Diagnosticar el resultado original de createQaGather y el motivo
de cancelación/renovación durante la aproximación de recogida,
corregir la causa con un cambio mínimo y probar varias veces la
recolección real bajo carga. Solo después repetir --crash-after-deposit,
reiniciar Fabric y verificar el estado físico y los diarios.

No se ha hecho push, PR, merge ni despliegue. CI no ejecutado
porque no existen minutos disponibles para este mes.
