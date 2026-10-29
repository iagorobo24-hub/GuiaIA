# GuiaIA — v5: desplazamiento acotado para tareas firmadas (solo QA)

Fecha: 2026-10-29. Destino previsto: `feature/principal-enrollment-qa` de Penguin.
**No se ha aplicado al Chromebook ni conectado a Teselia.**

## Funcionalidad entregada

`companion/src/qa_bounded_navigation.js` introduce una aproximación de Mineflayer
hacia un **único objetivo ya aprobado**, hasta 10 bloques desde el punto inicial.
No permite exploración libre, búsqueda de objetivos, colocación, excavación para
abrir camino, apertura de puertas ni saltos de parkour. Sólo usa `GoalNear`
y `Movements` inyectados expresamente por el arnés de QA.

`companion/src/qa_delivery_minecraft.js` acepta la opción **desactivada por defecto**
`navigationClasses: {GoalNear: goals.GoalNear, Movements}`. Con esa opción:

1. La extracción puede acercarse al bloque exacto ya firmado antes de picarlo.
2. Si necesita recoger el drop, puede aproximarse más al mismo bloque, sin
   desviarse a objetivos no autorizados.
3. Una vez terminado todo el trabajo de extracción, la fase de depósito puede
   caminar hasta el cofre exacto que figura en el plan y en el grant de depósito.
4. Todas esas acciones ocurren **dentro** de `journal.runNext` y de la
   autorización/revocación del pipeline firmado v4. Los constructores no mueven.
5. Se corrige un contrato del prototipo: `bot.blockAt()` de Mineflayer recibe
   un `Vec3` real, no coordenadas planas de JSON.

## Condiciones y fallos cerrados

- Requiere propietario visible y cercano: distancia máxima 18 bloques, salud
  de GuiaIA al menos 12, información de bloques del entorno disponible.
- Prohíbe destino de más de 10 bloques del punto de partida o más de 18
  bloques del propietario. Vigila el recorrido cada 100 ms, detiene si supera
  el perímetro o encuentra agua, lava, fuego, cactus u otros peligros inmediatos.
- Duración máxima de navegación por operación: 12 s (configurable en el
  adaptador de QA hasta un máximo de 30 s). Borra siempre el objetivo de
  pathfinding y estados de control al terminar, fallar o cancelarse.
- No acepta desplazamientos simultáneos ni resultados `goto()` positivos
  que no alcancen realmente el objetivo. Objetivo y origen se copian para
  impedir cambios de coordenadas a mitad de recorrido.
- Errores por chunks no cargados, desconexión, pérdida de propietario,
  revocación o consulta de autorización perdida dejan el paso sin recibo.
- Si no puede llegar al cofre **antes** de intentar transferir, el diario
  queda pausado sin registrar una transferencia incierta. Si se interrumpe
  tras una acción de mundo, queda en revisión para evitar duplicados.
- El conector es solamente de laboratorio: no expone stdin, chat, MCP,
  comandos arbitrarios ni API pública de movimiento.

## Uso para el arnés desechable

```js
const {Movements,goals}=require('mineflayer-pathfinder')
const {createQaSignedMinecraftDelivery}=require('./src/qa_delivery_minecraft')
const job=createQaSignedMinecraftDelivery({
  bot,bundle,signedPlan,authority,missionJournal,depositJournal,
  depositGrants,
  navigationClasses:{GoalNear:goals.GoalNear,Movements}
})
const result=await job.runAll() // Sólo en mundo de prueba autorizado
```

La opción `navigationClasses` es opt-in. Sin ella no cambia el comportamiento
precedente y el bloque fuera de alcance produce una negativa sin movimiento.

## Validación y límites

- **105/105 pruebas Node** en laboratorio aislado: 78 de v4 + 19 de
  navegación y 8 de integración de misión. No se han debilitado pruebas.
- Se ha usado `gather.js` **exacto** de GitHub (blob
  `6b5d3c3619be892e6e280d4355d41a5542fddbe9`) y los diarios originales
  `mission.js`/`deposit.js`. La conexión de depósito y sesión del laboratorio
  sigue siendo un doble de prueba: no equivale a ejecución Fabric real.
- Se ha comprobado con un bot simulado un flujo de aproximación al bloque,
  excavación, recibo de inventario, vuelta al cofre y recibo final, así como
  revocación mientras se camina, cancelación durable, negativa de navegación
  y retorno inseguro.
- La ruta interna de Mineflayer en un terreno real, chunks, desniveles,
  claims/regiones, jugadores reales, rendimiento y resultado real de abrir
  el cofre **NO se han validado**. No habilitar en Teselia antes de prueba
  Fabric real desechable con claves, grants y sesión de servidor auténticos.
- **Límite de recuperación:** el nonce del paso se consume antes de caminar.
  Si falla el recorrido antes de picar o transferir, el diario puede quedar
  `paused`, pero `resume()` no permite gastar de nuevo ese nonce. La misión
  exige revisión y un procedimiento futuro de reautorización explícita con
  una nueva pareja de diarios; nunca borrar el ledger ni forzar un replay.
- El módulo antiguo `gather.js` adjunta listeners de vida por acción; revisar
  su limpieza cuando se integre el supervisor permanente.

## Integración futura

1. Recuperar acceso a Penguin y comprobar rama, HEAD, otros agentes y
   cambios sin guardar. No aplicar nada a ciegas.
2. Si v4 no está aplicada, usar parche **v5 completo**. Si v4 ya está
   aplicada, usar el **incremental v4→v5**. Nunca aplicar ambos.
3. `git apply --check`, revisión de diferencias, `npm test` y test de Fabric
   1.21.1 **desechable** antes de continuar.
4. No push, PR, merge, desplegar ni modificar Teselia sin autorización.
