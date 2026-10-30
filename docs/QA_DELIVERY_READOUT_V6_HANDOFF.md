# GuiaIA — fase v6: informe de estado de misión, solo lectura

**29-10-2026. Alcance: QA aislado, NO desplegado.**

## Qué aporta

`companion/src/qa_delivery_readout.js` crea un informe determinista de la
misión firmada de entrega, sin abrir Minecraft y sin escribir diarios.
Construye un resumen para el operador con la fase actual, pasos de recolección,
recibos declarados por los diarios durables, pendientes de depósito, caducidad
del plan y una acción manual recomendada. El informe tiene como máximo cinco
pasos (tres bloques y dos tipos de depósito), y sus datos quedan congelados.

Es útil para preparar la futura interfaz de GuiaIA y para inspección forense
tras una desconexión o cancelación. En particular, un paso incierto no aparece
como completado: queda bloqueado para revisión humana y conciliación de los
inventarios reales. No reanuda pasos ni reexpide credenciales automáticamente.

## Contrato

```js
const {createQaDeliveryReadout}=require('./src/qa_delivery_readout')
const report=createQaDeliveryReadout({
  signedPlan, authority, missionJournal, depositJournal
})
// report.phase: 'gather' | 'deposit' | 'completed' | 'blocked'
// report.canDispatchWithoutFreshAuthorization === false (siempre)
```

El plan se valida mediante Ed25519 contra `operatorPublicKeyPem` y se compara
con los identificadores y contenido de ambos diarios. El módulo usa los
validadores del coordinador original y compara lecturas repetidas para detectar
cambios concurrentes. El plan **caducado** puede examinarse con una marca de
lectura histórica, pero **no** autoriza a ejecutar ninguna acción.

Los recibos se identifican explícitamente como **contenido de los diarios**,
no como pruebas independientes de que el inventario real siga coincidiendo.
`liveFabricPresenceChecked` e `independentWitnessChecked` son siempre `false`.
La generación del informe no debe presentarse como validación de la conexión,
identidad, permisos de regiones o seguridad de un servidor real.

## Evidencia reproducible

Se verificó sobre una copia limpia de los módulos `mission.js`, `deposit.js`
y sus dependencias de laboratorio, junto a las versiones v2–v5.

- `node --test test/qa_delivery_readout.test.js`: 16/16 PASS.
- `node --test test/*.test.js`: 121/121 PASS.
- Tests de falsificación de plan, diarios concurrentes, caducidad, misión
  completada, extracción incierta, cancelación y solo lectura.
- No se hicieron pruebas Minecraft/Fabric, ninguna conexión RDC, commit
  remoto, push, PR, merge ni despliegue.

## Integración futura en Chromebook

1. Inspeccionar estado actual de Git y los agentes concurrentes en Penguin.
   Último commit local de la rama QA verificado previamente: `cc4ce3d`, que
   **no** debe suponerse que sigue siendo HEAD.
2. Contrastar contratos de `mission.js`, `deposit.js`, `qa_signed_delivery.js`
   y `qa_delivery_pipeline.js`. Revisar los parches anteriores antes de aplicar.
3. Si v5 ya está integrada: aplicar únicamente el parche incremental v5→v6.
   Si no: aplicar únicamente el parche completo acumulativo, tras
   `git apply --check` en rama/working tree adecuada. Nunca los dos.
4. Repetir la suite completa, después verificar informes en un servidor
   Fabric **desechable**. Nunca autorizar actos Minecraft desde este readout.
5. Distinguir qué operaciones fueron observadas, cuáles solo constan en
   el diario y cuáles exigen conciliación manual. Commit local solo tras
   validación; no push/PR/merge/despliegue sin autorización.
