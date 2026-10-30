# GuiaIA — recuperación sin duplicados de una misión firmada (Fabric QA)

**Fecha:** 29/10/2026. **Rama:** `feature/principal-enrollment-qa`.
**Resultado comprobado:** PASS, código de salida 0 del arnés completo.

## Escenario real

El arnés `scripts/qa_signed_delivery_real_server.py --crash-after-deposit`
inició un servidor Fabric 1.21.1 desechable en `127.0.0.1:25593`,
con claves temporales, mundo plano, un tronco y dos cofres sintéticos.
El único cliente que realiza acciones es `GuiaIA_QA`, vinculado al
usuario sintético `OwnerQA` mediante pruebas firmadas y una autorización
Ed25519 acotada. Para reducir la variabilidad de la prueba de caída,
el cliente empezó cerca del tronco; el recorrido completo de navegación
ya tiene su propia prueba anterior de Fabric real.

1. La recolección se completó y guardó **un recibo durable**.
2. Se verificó la **transferencia real al cofre por ambos lados** de
   la ventana del contenedor: el cofre aumentó en 1 y el inventario del
   jugador disminuyó en 1.
3. Se provocó `process.exit(77)` **después** de la transferencia y
   **antes** de que el diario persistiera el recibo.
4. El depósito quedó en `transferring`, con índice 0 y **cero recibos**,
   sin alterar el recibo anterior de recolección.
5. Se hizo `save-all flush`, se apagó Fabric de forma ordenada y se
   reinició **el mismo mundo temporal**.
6. Un cliente Mineflayer nuevo inspeccionó el mundo sin emitir acciones:
   el bloque permanecía extraído, el cofre contenía exactamente **1
   oak_log** y el jugador conservaba **1 oak_log** preexistente.
7. El auditor confirmó que los dos archivos de diario eran idénticos
   a los anteriores al reinicio, que ambos bloqueos continuaban y que
   cualquier intento de adquirirlos de nuevo era rechazado.
8. Persistían un registro de emisión de plan y **tres registros** de
   permisos consumidos; **no hubo reintento automático ni reemisión**.

**Regresión Node:** 298/298 PASS, 0 fallos y 0 omisiones.
**Marcadores:** `GUIAIA_REAL_SIGNED_DELIVERY_CRASH_POINT_QA_EVIDENCE`,
`GUIAIA_REAL_SIGNED_DELIVERY_CRASH_RECOVERY_QA_EVIDENCE` y
`GUIAIA_SIGNED_DELIVERY_CRASH_E2E_QA_EVIDENCE`, todos PASS.

Evidencia estructurada:
`docs/evidence/GUIAIA_SIGNED_DELIVERY_CRASH_RECOVERY_QA_2026-10-29.json`.

## Comportamiento demostrado y límites

El sistema conserva la integridad ante un resultado incierto:
una transferencia real **puede haberse producido** aunque falte el
recibo durable. Por eso no libera el bloqueo, no inventa un recibo
y requiere **reconciliación manual explícita**. Este ensayo **no**
implementa una recuperación automática.

Las claves de operador y propietario son sintéticas de QA, el mundo
Minecraft corre en modo offline únicamente en loopback y el testigo
firmado sigue en el Chromebook; aún no equivale a un testigo externo
protegido. No valida Cobblemon, las regiones protegidas ni el alta
real de amigos. No se ha realizado push, PR, merge ni despliegue a
Teselia.

El servidor, el mundo y las claves temporales se eliminan al finalizar
el arnés. La rama del otro agente no se modifica.
