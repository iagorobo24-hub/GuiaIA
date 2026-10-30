# GuiaIA — QA: sesión criptográfica de propietario inscrito y conexión Fabric

**Fecha:** 30/10/2026
**Estado:** integración comprobada contra componentes reales de firma/registro
con fuentes Fabric y presencia/testigo simulados en pruebas locales.
**No hay despliegue ni autenticación online demostrada.**

## Alcance cerrado

`companion/src/qa_principal_session_binding.js` incorpora
`issueQaBoundPrincipalSession(config)`. No genera identidades, no emite
permisos de acción, no conecta bots y no modifica el mundo. Requiere:

1. Identificador de mundo con prefijo `qa:`, ID de propietario,
   usuario de la conexión, ID de conexión y nombre exacto del bot.
2. Clave privada Ed25519 de la persona que solicita la sesión,
   correspondiente a una clave pública previamente enrolada con
   consentimiento y firma del operador en
   `openQaPrincipalRegistry`.
3. Fuente de eventos JOIN/DISCONNECT firmados por Fabric, verificada
   mediante `createPinnedQaServerBridgeAuthority` y clave pública
   del bridge fijada fuera del mensaje recibido.
4. Presencia **actual** del mismo ID de conexión, obtenida del
   servidor mediante el lector de respuesta firmada
   `createPinnedQaLivePresenceAuthority`.
5. Testigo de checkpoint independiente del registro,
   configurado con `createPinnedQaRemoteCheckpointClient`;
   deniega indisponibilidad y desacuerdo.
6. Revalidación de revocación, identidad, conexión, desafío y
   antigüedad de presencia después de cada llamada asíncrona.

Solo después firma una prueba de propietario
`guiaia:principal-proof:v1` ligada al desafío, mundo,
`principalId` y `connectionId` presentes en el JOIN de Fabric,
con vida máxima de 20 segundos. El paquete se pasa por el verificador
existente `verifySessionBundle` antes de devolverse.
El resultado incluye `worldActionsEnabled: false` y **no incluye
ningún permiso para seguir, excavar ni depositar**. Es un constructor
de credencial de sesión dentro de las barreras ya existentes, no una
nueva API de acciones.

## Verificación y negativas

La prueba `companion/test/qa_principal_session_binding.test.js`
crea en ubicaciones temporales un registro persistente real con dos
claves Ed25519 independientes, consentimiento del propietario,
aprobación del operador, un evento Fabric JOIN firmado y un lector
de auditoría de conexión real. Inyecta respuestas de presencia y
testigo de laboratorio, sin arrancar Minecraft.

**10/10 pruebas específicas y 345/345 Node + 54/54 Python totales:** prueba válida, rechazo por propietario
desconocido o clave diferente, mundo/nombre/autoridad incorrectos,
desconexión firmada, presencia antigua o ausente, testigo offline o
no concordante, revocación durante espera, desconexión durante espera,
manipulación del evento firmado, cambio del desafío durante espera y
caducidad de la conexión. La sesión válida se valida con el
`verifySessionBundle` existente y, tras revocar al propietario,
esa misma sesión deja de ser válida.

## Limitaciones de seguridad explícitas

- Un bridge firmado en un servidor Fabric `offline-mode` acredita que
  **ese nombre se conectó**, pero no que pertenece a una cuenta
  Microsoft/Minecraft. La posesión de la clave Ed25519 inscrita es una
  identidad **del protocolo GuiaIA**, no de la cuenta oficial.
- El código requiere dependencias de registro, bridge, presencia y testigo.
  Las pruebas las construyen o inyectan; el runtime de Teselia no está
  conectado a este flujo y `npm start` sigue limitado.
- La prueba unit/integración sin JVM **no acredita** que el servicio
  Fabric live-presence y el testigo independientes estén conectados en
  una instalación real. No se ejecutó otra JVM QA por el espacio
  disponible en Chromebook.
- El operador debe mantener claves privadas fuera de Git y del servidor
  y aprobar el enrolamiento por otro canal; un TTY no demuestra
  identidad humana.
- Una prueba de sesión no sustituye permisos firmados de acción,
  autorización de cada paso, comprobación del mundo, protección de
  replay, revocación activa ni manejo del depósito incierto.

**Pendiente:** integrar este emisor en el arranque independiente
autenticado, realizar un ensayo con Fabric real ya autenticado,
y diseñar/verificar una vinculación demostrable con una identidad
oficial de cuenta de jugador. No habilitar en Teselia ni servidores
compartidos antes de esas verificaciones.
