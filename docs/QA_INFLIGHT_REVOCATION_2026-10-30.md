# GuiaIA — cierre de ventana de revocación durante acciones de QA (30/10/2026)

## Diagnóstico

Se auditó la cadena real de `createQaEnrolledOperatorRuntime` → `createSecureDeliveryRuntime` → `createSecureCompanionController` → `createSessionAuthorizedQaDeposit` → `createQaChestDeposit`. La autorización se comprobaba antes de abrir el cofre, pero `bot.openContainer()` es una operación asíncrona. Una revocación o la pérdida del testigo durante esa espera podía dejar llegar a `window.deposit()` una autorización ya caducada.

La recolección ya disponía de una comprobación adicional `authorizeBeforeDig` después de la navegación. El depósito carecía de un equivalente **entre la apertura del cofre y la transferencia física**.

## Cambio mínimo

El adaptador local de depósito acepta un callback interno `authorizeBeforeTransfer`. Los depósitos firmados lo suministran obligatoriamente mediante `createSessionAuthorizedQaDeposit`. Después de `openContainer` y de validar los inventarios observados, pero **antes de invocar `window.deposit`**, el adaptador vuelve a:

- Verificar el bundle y el permiso Ed25519 ligado a mundo, propietario, conexión, desafío y cofre.
- Consultar de nuevo la presencia viva firmada, cuando el runtime exige presencia.
- Comprobar el checkpoint actual con el testigo independiente, cuando está habilitado.
- Verificar nuevamente revocación y alcance **después** de las consultas asíncronas.

Cualquier rechazo devuelve `authorization_denied` sin marcar `transferAttempted`, sin mutar el cofre y sin emitir recibo de depósito. El diario deja un estado `paused`, no `completed`, si no se intentó una transferencia. Los permisos que ya alcanzaron la barrera de reserva siguen gastados: el runtime no los reintenta automáticamente.

## Evidencia y límites

La prueba `qa_principal_session_binding.test.js` utiliza registro persistente con alta y revocación **firmadas realmente**, permisos de acción Ed25519, motor de misión y diarios de recibos. Se prueban tres carreras dirigidas:

1. Revocación mientras está pendiente `openContainer()`, después de una recolección con recibo: un roble permanece en el jugador y ninguno en el cofre.
2. Testigo denegado durante esa misma ventana: tampoco hay transferencia ni recibo inventado.
3. Revocación durante la navegación de recolección: el nonce está reservado, pero no se excava ningún bloque.

Todas las aserciones negativas incluyen recuentos de acciones, fases y recibos, consumo de nonces y ausencia de reintento automático. Las pruebas usan bot y presencia inyectados para poder detener exactamente la carrera. Esto no demuestra que la revocación en caliente pueda publicarse **desde otro proceso** mientras la instancia del registro está bloqueada: el actual diseño mantiene un lock exclusivo y necesita un canal de revocación independiente antes de desplegarse.

Una transferencia **ya iniciada** en Minecraft no puede retirarse retroactivamente. Ante resultado incierto, el diario debe impedir el replay y requerir revisión manual, no afirmar rollback.

La prueba de un nuevo proceso que rechaza una sesión **después** de revocar en Fabric real se documenta separadamente en `GUIAIA_STANDALONE_REAL_FABRIC_QA_2026-10-30.md`.

## Pendiente

Comprobar compatibilidad del código reforzado con un servidor Fabric real (misión positiva), diseñar un mecanismo verificable de publicación de revocación *mientras* el runtime tiene abierto el registro, después testigo externo, identidad oficial Minecraft y Cobblemon.

## Regresión adicional en Fabric 1.21.1 real

Después de introducir la doble autorización, se repitió el runner
`--standalone-operator` completo usando Fabric y un cofre reales en
un mundo desechable. El proceso terminó con **código 0** y marcador
`GUIAIA_STANDALONE_OPERATOR_REAL_FABRIC_QA_EVIDENCE`, incluyendo:
`physical_chest_oak_log=1`, `mission_receipts=1`,
`deposit_receipts=1`, `spent_nonces=2`,
`post_revocation_preflight_exit=2` y
`chest_unchanged_after_denial=true`.

Esto confirma que la autorización reforzada sigue permitiendo
transferencias correctas y verificables en Fabric real. No convierte
los casos de revocación durante `openContainer` en un ensayo real de
revocación por otro host: esos tres casos de carrera se validaron con
componentes en proceso, registro real, firmas genuinas y bot simulado.

Evidencia de ejecución local:
`/tmp/guiaia-inflight-real-fabric-positive-20261030.log`.
La JVM temporal se cerró y los puertos de QA quedaron libres.
