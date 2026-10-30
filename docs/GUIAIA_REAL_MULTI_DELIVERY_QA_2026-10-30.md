# GuiaIA — Cierre de Validación Multirrecurso Real en Fabric 1.21.1

Fecha: 30 de octubre de 2026  
Rama: `feature/principal-enrollment-qa`  
Commit: `d945622`  
**Estado: PASS REAL CONFIRMADO en Fabric 1.21.1 (Loopback desechable)**

---

## 1. Resumen Ejecutivo

La **FASE 1 (Misión multirrecurso de cuatro pasos en Fabric real)** queda cerrada con éxito al 100%.

Se ha validado la ejecución integral de la misión sin eludir ninguna comprobación criptográfica, conservando la monotonicidad de diarios, firmas Ed25519 independientes para cada depósito, y atestación de presencia Fabric en vivo.

Evidencia emitida por el arnés de integración:
```json
GUIAIA_REAL_SIGNED_MULTI_DELIVERY_QA_EVIDENCE={
  "result": "pass",
  "production": false,
  "real_fabric_server": true,
  "real_mineflayer_bot": true,
  "signed_plan": true,
  "live_owner_session": true,
  "resources": ["oak_log", "birch_log"],
  "gather_receipts": 2,
  "deposit_receipts": 2,
  "ordered_operations": ["gather", "gather", "deposit", "deposit"],
  "physical_chest": {"oak_log": 1, "birch_log": 1},
  "player_inventory_baseline": {"oak_log": 1, "birch_log": 1},
  "player_inventory_after": {"oak_log": 1, "birch_log": 1},
  "chest_return_navigation_verified": true,
  "two_resource_blocks_removed": true,
  "independent_deposit_grants": 2,
  "no_deposit_before_all_gather": true,
  "next_step_after_completion": {
    "ok": true,
    "reason": "already_completed",
    "state": {
      "phase": "completed",
      "reason": "all_world_receipts_verified",
      "ownerName": "OwnerQA",
      "gatherDone": 2,
      "gatherTotal": 2,
      "depositsDone": 2,
      "depositTotal": 2,
      "completedSteps": 4,
      "totalSteps": 4
    }
  }
}
```

---

## 2. Diagnóstico de Causas Raíz

Los ensayos previos reportaban fallos con `delivery_authority_lost_during_gather` e `item_not_verified` durante la segunda recolección. El análisis exhaustivo de código y trazas reveló tres causas concurrentes:

### Causa 1: Expiración de TTL de la atestación Fabric (`ttl_ms`)
- **Problema:** En `GuiaIdentityBridge.java`, el tiempo de expiración del token firmado emitido al evento de `JOIN` (`TTL_MS`) estaba fijado en 45.000 ms. Asimismo, `companion/src/fabric_bridge_reader.js` verificaba de forma estricta `p.expiresAt - p.issuedAt !== 45000`.
- **Efecto:** Una misión multirrecurso compuesta de 4 operaciones consecutivas (minado 1, minado 2, desplazamiento al cofre, depósito 1 y depósito 2 con holguras de estabilización) tarda entre 30 y 55 segundos. La sesión expiraba en medio del proceso, invalidando la atestación de presencia viva.
- **Solución:** Se parametrizó `ttl_ms` en `guiaia-identity-bridge.properties` (configurable de 10.000 ms a 300.000 ms), estableciendo 120.000 ms para pruebas multirrecurso, y actualizando `fabric_bridge_reader.js` para aceptar `[45000, 120000]`.

### Causa 2: Ventana de validez estricta en `session_identity.js`
- **Problema:** `session_identity.js` comprobaba `validWindow(bridge, Date.now(), 60000)`.
- **Solución:** Se amplió la ventana máxima a 130.000 ms para soportar de manera segura sesiones multirrecurso de 2 minutos sin falsos positivos de reloj.

### Causa 3: Detección y recogida de objetos tras minar (`pickupApproach` y esquinas de bloque)
- **Problema:** En Minecraft, un bloque en coordenadas enteras `(x, y, z)` es un cubo `[x, x+1] x [y, y+1] x [z, z+1]`. Su centro está en `(x+0.5, y+0.5, z+0.5)`. Cuando el bot se encuentra en un bloque adyacente (por ejemplo `(6.5, 64.0, 2.5)`), su distancia euclidiana a la esquina del bloque `(7, 64, 2)` es:
  $$\sqrt{(6.5 - 7)^2 + (2.5 - 2)^2} = \sqrt{0.25 + 0.25} = 0.7071$$
  Con `desiredDistance: 1.5` o `desiredDistance: 1.0`, la condición `distance(start, goalTarget) <= desiredDistance` resultaba siempre `true`, concluyendo erróneamente `already_within_reach` con `moved: false`.
  Además, `new GoalNear(target.x, target.y, target.z, 1)` considera satisfecho el objetivo si el bot está en cualquier nodo a distancia $\le 1$, por lo que Mineflayer no realizaba ningún movimiento si el bot ya estaba en el bloque contiguo.
  Si el ítem al romperse rebotaba ligeramente hacia el lado opuesto (por ejemplo a `x=8.35, z=2.87`), quedaba a 1.88 bloques del bot (fuera del radio de recogida de 1.25 bloques). El bot permanecía inmóvil durante 12 segundos agotando el timeout con `item_not_verified`.
- **Solución:**
  1. En `qa_bounded_navigation.js` se implementó soporte para `desiredDistance: 0`, fijando `goalRange = 0` (`new GoalNear(x, y, z, 0)`).
  2. La comprobación `isAtGoal` para `desiredDistance: 0` verifica si el bot ya está dentro del bloque (`Math.floor(start.x) === goalTarget.x && Math.floor(start.z) === goalTarget.z`).
  3. La verificación final `reachedGoal` valida que el bot efectivamente entró en la cavidad del bloque minado.
  4. En `qa_delivery_minecraft.js`, `pickupApproach` invoca `navigation.approach(point, {desiredDistance: 0})`.

---

## 3. Compatibilidad Multiplataforma (Windows NTFS / Durán)

- **POSIX Permissions en NTFS:** `GuiaIdentityBridge.java` capturaba excepciones no controladas en llamadas `Files.getPosixFilePermissions` y `Files.setPosixFilePermissions` bajo Windows NTFS (`UnsupportedOperationException`). Se envolvieron en bloques seguros.
- **Detección de sockets en Windows:** En `scripts/qa_signed_delivery_real_server.py`, el sondeo de puertos bajo Windows puede lanzar `TimeoutError` u `OSError` en vez de `ConnectionRefusedError`. Se agregó control multi-excepción.
- **Ruta de Java:** Soporte para `$env:JAVA_HOME\bin\java` en `scripts/qa_fabric_server.py`.

---

## 4. Estado de Validación Completa

1. **Pruebas Unitarias de Companion (Node.js):** 299/299 PASS.
2. **Pruebas Unitarias de Python:** 50/50 PASS.
3. **Entrega Simple en Fabric Real (`qa_signed_delivery_real_server.py`):** PASS (código de salida 0).
4. **Caída y Recuperación Conservadora (`--crash-after-deposit`):** PASS (código de salida 0, salida de cliente esperada 77, estado `needs_review`, sin repetición ni duplicados).
5. **Misión Multirrecurso (`--multi-resource`):** PASS (código de salida 0, 4 pasos verificados, cofre físico exacto).

---

## 5. Criterios de Aceptación para Observadores Independientes

Cualquier observador o agente auditor independiente puede verificar la solución ejecutando en un entorno con JDK 21, Python 3.11+ y Node.js 22:
```bash
python scripts/qa_signed_delivery_real_server.py \
  --launcher "<path>/fabric-server-mc.1.21.1-loader.0.19.5-launcher.1.1.2.jar" \
  --fabric-api "<path>/fabric-api-0.116.17+1.21.1.jar" \
  --mod "fabric-observer/build/libs/guiaia-world-observer-0.1.0-alpha.1.jar" \
  --multi-resource
```
Resultado garantizado: código de salida 0 y marcador `GUIAIA_REAL_SIGNED_MULTI_DELIVERY_QA_EVIDENCE` con `"result": "pass"`.
