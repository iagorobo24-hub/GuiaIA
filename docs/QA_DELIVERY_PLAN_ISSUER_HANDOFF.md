# GuiaIA QA — fase 4: emisión reproducible de un plan de entrega firmado

Fecha: 29-10-2026. Destino previsto: `feature/principal-enrollment-qa` de Penguin, **sin aplicación en el equipo por agotamiento de cuota RDC**.

## Entregable

`companion/src/qa_delivery_plan_issuer.js` añade `issueQaDeliveryPlan({...})` para que una **integración de operador de confianza**, nunca el chat de Minecraft ni una interfaz pública, convierta una especificación revisada y dos diarios durables ya creados en un único permiso firmado Ed25519.

Entradas obligatorias: `bot`, `bundle` del servidor y principal, `authority` con clave pública del operador y autoridad de conexión, `operatorPrivateKey` (KeyObject/PEM en memoria), `reviewedSpec` con **exactamente** `{sandboxOnly:true,ownerName,targets,chest,items}`, objetos abiertos `missionJournal`, `depositJournal` y `approvalDirectory` absoluto, independiente del ledger de pasos. Duración opcional `lifetimeMs` entre 2 s y 5 minutos (por defecto 15 s), siempre limitada por la expiración de ambas pruebas de sesión.

El operador debe haber revisado externamente la ubicación de los bloques y del cofre, su propiedad y los permisos del servidor. Un objeto con `reviewedSpec` **no demuestra consentimiento humano ni derechos de edición**. No existe emisión automática de grants de depósito ni acción Minecraft al preparar el plan.

Comprobaciones:

- Validadores reales de `mission.js` y `deposit.js`, orden, coordenadas, allowlist roble/abedul y campos exactos.
- Ambos diarios deben estar aún en fase `ready`, con progreso y recibos cero, y coincidir con el plan revisado. No se permite construir el plan a partir de un journal modificado sin aprobación independiente.
- `verifySessionBundle` confirma dos firmas, conexión real activa y no revocada. El operador firmante tiene que poseer la clave privada Ed25519 que corresponde exactamente a la clave pública fijada.
- El payload emitido coincide con `guiaia:session-delivery-plan:v1`, incluyendo los IDs durables de misión y depósito, los bloques, los objetos, el mundo, el bot, el titular, el ID de conexión y el desafío.
- Se vuelve a comprobar sesión y ambos diarios inmediatamente antes de consumir una barrera durable de emisión de un solo uso. No se permiten dos planes nuevos para la misma pareja de diarios. La emisión que llega a la barrera y sufre un error no es recuperable automáticamente: revisión humana obligatoria.
- La emisión no abre cofres, no mina, no mueve al bot y no importa ningún comando de stdin, chat, RCON ni modelo de lenguaje.

## Integración de QA

```js
const {issueQaDeliveryPlan}=require('./src/qa_delivery_plan_issuer')
const issued=issueQaDeliveryPlan({
  bot,bundle,authority,operatorPrivateKey,
  reviewedSpec,missionJournal,depositJournal,
  approvalDirectory:'/ruta-absoluta/solo-qa/emisiones'
})
// No hay ninguna acción automática. El plan se pasa explícitamente al
// creador de tareas y al gateway de depósitos, con grants específicos.
const pipeline=createQaSignedMinecraftDelivery({
  bot,bundle,signedPlan:issued.signedPlan,authority,
  missionJournal,depositJournal,depositGrants
})
```

El operador ha de crear previamente los dos diarios con un plan revisado. No se eliminan, sobrescriben ni recrean automáticamente los diarios existentes. Si la aprobación es rechazada o se detecta una discrepancia, la emisión termina sin consumir el marcador. Si un marcador ya fue consumido, una nueva emisión se deniega con `EEXIST`.

## Resultados verificables

- Batería acumulada v3 + v4 en copia aislada de Node 22: **78/78 PASS** (64 heredadas + 14 nuevas).
- La prueba positiva recorre `issueQaDeliveryPlan -> verifyQaDeliveryPlan -> createQaSignedDeliveryPipeline -> openMission/openDepositJournal -> cuatro recibos durables` con adaptadores de acciones simulados. Se prueban la firma, ámbitos, falsificación del plan revisado, claves distintas, expiración, conexión inactiva, revocación, emisión duplicada, estado avanzado del diario, carrera en lectura, permisos de archivos y no mutación del mundo en emisión.
- La copia de laboratorio conserva los diarios reales de GitHub. **Los módulos `session_identity.js` y `operator_authorization.js` del laboratorio son adaptadores equivalentes para pruebas**, no la implementación completa más reciente de Penguin. El adaptador Mineflayer continúa sin validación completa en Fabric real para la v4.
- No se ha accedido ni modificado el repositorio de Penguin, GitHub ni Teselia. Último estado verificado localmente en una sesión previa: `cc4ce3d`; no asumir que ese HEAD sigue siendo actual.

## Criterio de integración pendiente

Al recuperar el conector: inspeccionar `git status -sb`, HEAD, modificaciones locales y procesos, comprobar el parche con `git apply --check`, elegir **solo uno** de los parches (completo v4 si no se instaló la v3; incremental v3→v4 si se instaló la v3); revisar compatibilidad con `session_identity` real, ejecutar `npm test`, pruebas end-to-end Fabric 1.21.1 desechables con sesiones y grants Ed25519 reales, comprobar revocación en curso y las barreras durables. No conectar al chat, servidor productivo ni GUI hasta esas comprobaciones y el sistema de identidades reales.
