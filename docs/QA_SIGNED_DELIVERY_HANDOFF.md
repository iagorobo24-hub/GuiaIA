# GuiaIA — fase funcional 3: tarea completa de entrega con autorización firmada

**Fecha:** 29-10-2026. **Destino previsto:** `feature/principal-enrollment-qa` (Penguin).
**Estado:** implementación construida y probada en una **copia aislada**, NO aplicada a Penguin/GitHub/Teselia.

## Qué se ha cerrado

El coordinador v2 ya ejecutaba `recolectar → depositar` mediante los diarios persistentes `openMission` y `openDepositJournal`, pero recibía `approvedPlan` de una integración externa. Faltaba vincularlo a la identidad efectiva del jugador y al permiso del operador. La fase 3 crea una integración **sin comandos públicos** con:

- `companion/src/qa_signed_delivery.js`: permiso Ed25519 `guiaia:session-delivery-plan:v1`, formato estricto, mundo, bot, propietario, principal, conexión, desafío, IDs durables de ambos diarios, posiciones, objetos, cantidades y nonce. Vigencia máxima de 5 minutos; 1–3 bloques de roble/abedul y 1–2 tipos de depósito.
- Reutilización de `verifySessionBundle()` del módulo real `session_identity`: pruebas separadas de servidor Fabric y posesión de clave del principal. Solo funciona con `sandboxOnly:true`, `identityMode:'trusted_server_bridge_lab'`, consulta de presencia viva y checkpoint remoto activados.
- La **autorización fresca se consulta antes y después de construir el adaptador, antes del cambio de mundo y al registrar el recibo**. Cada paso de mundo se reserva en un ledger persistente mediante `reserveGrantOnce` y una clave derivada del nonce firmado, tipo de acción e índice. Si se restauran ambos diarios a una versión anterior pero el ledger se conserva, el paso no puede repetirse.
- Durante una acción de recolección o transferencia, supervisión de la sesión y testigo cada 250 ms, con lease máximo de 1,5 s. Si desaparece la autoridad o se corta la red, se solicita `cancel()` al adaptador y el resultado incierto queda en `needs_review`; no se emite un recibo de éxito.
- `companion/src/qa_delivery_minecraft.js`: ensamblado limitado para el `createQaGather()` real y el `createQaStrictSessionActionGateway()` real. Requiere permisos firmados **específicos para cada depósito**, no permite navegación libre ni activa chat/CLI/MCP.

Los archivos de la versión 2 (coordinador, tests y documentación) están **incluidos en el parche acumulativo**. La v3 no exige introducir manualmente código de otras conversaciones.

## Evidencia y límites precisos

`node --test test/*.test.js` con Node 22.16, en un laboratorio de ChatGPT: **64/64 PASS**. De ellos, 36 son las pruebas v2 y 28 nuevas verificaciones portables de identidad, permiso firmado, sesión, revalidación, denegación, nonce, rollback conservando el ledger, interrupciones, supervisión y guardas de la nueva API.

- `mission.js` y `deposit.js` son archivos tomados del código real de GuiaIA ya verificado en la revisión v2.
- El laboratorio utilizó copias mínimas de `verifySessionBundle` y `reserveGrantOnce` con el mismo contrato criptográfico/atómico, y dobles de Minecraft para que no dependiera de una JVM. **No se ha ejecutado el `session_identity.js` completo del último commit local ni un servidor Fabric real en esta fase.**
- Cinco pruebas adicionales con adaptadores Minecraft **simulados** superaron la batería local, pero se dejaron **fuera** de los tests portables del parche: el gateway estricto real de GuiaIA requiere firmas de depósito completas y Mineflayer real, no un stub.
- El plan firmado sigue usando claves efímeras de QA. El testigo localhost y ledger Penguin no son resistentes a una restauración coherente de **todos** sus archivos y claves. Falta un anclaje remoto fuera del Chromebook.
- Una cancelación es una solicitud de parada: no prueba que Minecraft haya deshecho una excavación/transferencia ya ejecutada. Los diarios bloquean el reintento y exigen revisión humana ante resultados inciertos.
- Ningún componente se conecta a `companion/src/cli.js` ni ofrece acciones por texto, chat, RCON o lenguaje natural.

## Integración controlada en Penguin

1. Recuperar acceso RDC; comprobar `git status -sb`, `HEAD`, trabajos ajenos y procesos. El último HEAD comprobado fue `cc4ce3d`, **no debe suponerse el HEAD actual**.
2. Si no se aplicó el parche v2, utilizar `guiaia-qa-delivery-pipeline-v3-full.patch`. Si se aplicó v2 exactamente, usar `guiaia-qa-delivery-pipeline-v3-from-v2.patch`. No aplicar ambos. `git apply --check` antes de editar. Nunca tocar una rama ajena.
3. Revisar que `createQaStrictSessionActionGateway` esté disponible en `session_identity.js`, y comparar las firmas exactas de `createQaGather` y `createDeposit` con los contratos usados por el adaptador; actualizar solo lo necesario.
4. `cd companion && npm ci --ignore-scripts --no-audit --no-fund && node --test test/qa_delivery_pipeline.test.js test/qa_delivery_real_journals.test.js test/qa_signed_delivery.test.js test/qa_delivery_minecraft_guard.test.js && npm test`.
5. Construir las pruebas en un servidor Fabric **desechable** con ambos jugadores visibles, cofre y bloques autorizados, **firmas reales** de sesión y permisos por depósito. Verificar cuatro recibos durables, condiciones de seguridad, parada tras revocación durante la operación, caída de JVM, recuperación y no repetición. No activar en Teselia todavía.
6. Revisar `git diff`, documentar resultados reales y efectuar como máximo un commit local. No push, PR, merge ni despliegue sin autorización explícita.

## Contrato mínimo de plan firmado

El emisor autorizado firma con Ed25519 `Buffer.from(JSON.stringify(payload))`. El contenedor tiene exactamente `{payload,signature}` y la firma se codifica base64url. El `payload` lleva exactamente estas propiedades (sin campos extra):

```text
aud='guiaia:session-delivery-plan:v1'
sandboxOnly=true
worldId, botName, ownerName, principalId, connectionId, challenge
missionId, planId, targets=[{x,y,z,block}], chest={x,y,z}
items=[{name,count}], nonce, issuedAt, expiresAt
```

`missionId` y `planId` deben corresponder a planes **previamente aprobados** y estar firmados fuera de los diarios. Nunca considerar suficiente leer los IDs del propio JSON del diario si se ha podido modificar. La sesión Fabric debe ser la misma que autorizó la tarea. Los grants de depósito son adicionales, firmados por separado y de un solo uso.

**Definición de cierre de la fase:** código y laboratorio portables cerrados; integración local, pruebas completas de Penguin y juego real **pendientes** por límite mensual de Remote Desktop Commander. No proclamar finalización del proyecto GuiaIA todavía.
