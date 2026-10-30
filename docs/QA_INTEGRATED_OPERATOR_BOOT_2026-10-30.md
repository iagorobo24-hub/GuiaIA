# GuiaIA — arranque integrado y restringido de operador QA (30/10/2026)

## Estado y alcance exactos

Nueva entrada ejecutable `companion/qa_operator.js` y ensamblador
`companion/src/qa_operator_bootstrap.js`. Integran los componentes
existentes, **sin generar ni aprobar credenciales**:

1. Registro durable de propietarios previamente aprobado por operador
   y consentimiento firmado con Ed25519 (`principal_enrollment`).
2. Evento JOIN real del bridge firmado por Fabric
   (`fabric_bridge_reader`), ligado a conexión y desafío.
3. Presencia reciente por TCP local firmada por el mismo bridge
   (`live_presence`).
4. Testigo de checkpoint **separado** con clave y respuestas firmadas
   (`remote_checkpoint`).
5. Nueva prueba corta de posesión de clave privada del propietario,
   ligada a la conexión (`qa_principal_session_binding`).
6. Misiones y depósitos con diarios persistentes, plan independiente
   y permisos de acción firmados de un solo uso
   (`secure_delivery_runtime`).
7. Consola restringida en TTY local, sin chat ni ejecución libre
   (`trusted_local_operator_console`).

El firmante de los permisos debe coincidir por huella de clave pública
con el operador que ancló el registro y el testigo. La verificación de
presencia y checkpoint **se repite antes de cada acción**. Una
comprobación de sesión no autoriza acciones sin permisos adicionales.

Este es un prototipo **solo QA** para Fabric 1.21.1 en
`127.0.0.1:25593`, usuario de bot `GuiaIA_QA` y mundo
`qa:real-fabric:25593`. No acepta órdenes desde Minecraft, canales
HTTP de terceros ni stdin redirigido como autoridad operativa.
No activa nada en Teselia ni autentica una cuenta Microsoft/Minecraft.

## Modos ejecutables

Desde `companion/`:

```bash
npm run operator:qa -- --qa-preflight /tmp/guiaia-operator-qa-EXAMPLE/config.json
npm run operator:qa -- --qa-operate /tmp/guiaia-operator-qa-EXAMPLE/config-operate.json
```

- **`--qa-preflight`:** abre el registro QA existente, valida clave
  de propietario, firma del bridge, presencia actual y testigo,
  devuelve **solo datos públicos de alcance** y termina sin arrancar bot
  ni acceder a los diarios de acción.
- **`--qa-operate`:** requiere TTY interactiva, diarios de misión y
  depósito ya persistidos, plan aprobado y permisos Ed25519 externos;
  verifica la sesión antes y después de iniciar Mineflayer, ensambla
  el runtime firmado y habilita únicamente los comandos existentes
  `estado`, `inventario`, `sigueme`, `siguiente`, `mision`,
  `para`, `salir` (también sus equivalentes ingleses).
  EOF y cierre paran el runtime, liberan los diarios y desconectan bot.

**Contrato de configuración** (ubicación owner-private 0700 en
`/tmp/guiaia-operator-qa-<identificador>`, archivo 0600, sin symlinks,
hardlinks ni secretos dentro del repositorio):

```json
{
  "version": 1,
  "sandboxOnly": true,
  "worldId": "qa:real-fabric:25593",
  "botName": "GuiaIA_QA",
  "username": "OwnerQA",
  "principalId": "principal_previamente_inscrito",
  "connectionId": "uuid-v4-de-la-conexion-actual",
  "eventsFile": "/tmp/guiaia-fabric-bridge-qa-EXAMPLE/config/guiaia-identity-bridge/events.jsonl",
  "registryDirectory": "/tmp/guiaia-enrollment-qa-EXAMPLE/registry",
  "principalPrivateKeyFile": "/tmp/guiaia-operator-qa-EXAMPLE/principal-private.pem",
  "operatorPublicKeyFile": "/tmp/guiaia-operator-qa-EXAMPLE/operator-public.pem",
  "serverBridgePublicKeyFile": "/tmp/guiaia-operator-qa-EXAMPLE/server-public.pem",
  "witnessPublicKeyFile": "/tmp/guiaia-operator-qa-EXAMPLE/witness-public.pem",
  "witnessUrl": "http://127.0.0.1:30000/",
  "livePort": 25594
}
```

Los valores son **ilustrativos, no credenciales reales**. El fichero de
preflight usa exactamente esos campos. El fichero de operación añade,
también de forma exacta, los siguientes campos: `missionDirectory`,
`depositDirectory`, `spentDirectory` (obligatoriamente
subdirectorios `mission`, `deposit`, `spent` del mismo QA root),
`approvedPlanFile`, `grantsFile` (ambos dentro del mismo QA root).
`grantsFile` tiene las claves `gather` (array), `deposit` (array)
y `followGrant` (permiso firmado o `null`). El programa no inventa
grants, no reescribe planes, no acepta permisos de otro operador y
no borra locks de una ejecución que terminó de forma incierta.

El certificado de identidad Ed25519 del propietario se crea y aprueba
previamente por otro canal. La interfaz `principal:offline-qa`
publicada antes documenta la ceremonia de inscripción/revocación;
ver `OFFLINE_PRINCIPAL_HANDOFF_QA_2026-10-30.md`.
Para integrar en un servidor de pruebas no basta con un alias o UUID
offline: se necesita la clave privada del principal, la identidad
firmada de Fabric y un testigo configurado y disponible.

## Pruebas y límites

El test `qa_principal_session_binding.test.js` incluye el flujo
completo **en proceso simulado** del runtime de recolección/depósito,
con firma Ed25519, diarios durables, consumos de nonce y consola local.
Para el lanzador prueba un **proceso Node independiente**, evento
firmado, presencia TCP realmente atendida por un socket, registro
persistente abierto de nuevo y un testigo HTTP firmado real.
Incluye negativas por desconexión, autoridad incorrecta y stdin no TTY.

**Validado el modo `--qa-operate` con Fabric 1.21.1 real en laboratorio
el 30/10/2026:** comando `mision` en TTY, un roble físicamente excavado,
un cofre con una unidad verificada por otro cliente, dos recibos durables,
dos nonces consumidos y cierre con código 0. Ver
[GUIAIA_STANDALONE_REAL_FABRIC_QA_2026-10-30.md](GUIAIA_STANDALONE_REAL_FABRIC_QA_2026-10-30.md).
**Todavía NO hay credenciales humanas de Minecraft autenticadas ni un
testigo realmente remoto:** el firmante y la identidad son sintéticos,
el testigo está en loopback y el servidor usa offline-mode.
Los grants caducan y la prueba de sesión dura un máximo de 20 segundos;
si expiran, la ejecución debe denegarse y no reintentarse automáticamente.

Próximos criterios: alta de un propietario real fuera del laboratorio,
prueba del testigo en otro host, autenticación oficial de la cuenta
Minecraft, negativa de revocación en el lanzador real, instalación limpia
en un segundo equipo y Cobblemon con permisos y pruebas específicos.

## Integración pendiente de la rama histórica

Se compararon las fuentes Java con la rama local
`feature/principal-enrollment-qa`. El texto lógico de ambos
`GuiaIdentityBridge.java` y `GuiaWorldObserver.java` coincide con
`main`; las diferencias pendientes en aquella rama son CRLF frente
a LF. La rama no se modificó ni borró. Sus cachés Gradle, artefactos
y trabajo del servidor Teselia tampoco se alteraron.

## Resultados de verificación de esta fase

- Suite Node completa: **349/349** (código de salida 0).
- Suite Python: **54/54** (código de salida 0).
- Pruebas del enlace y del arranque: **14/14**.
- Comprobaciones de sintaxis JS y `git diff --check`: correctas.
- No se ha utilizado el mundo de Teselia ni alterado el servidor activo.
- No se ha probado una cuenta oficial Minecraft ni una instalación limpia
  en otro ordenador.
