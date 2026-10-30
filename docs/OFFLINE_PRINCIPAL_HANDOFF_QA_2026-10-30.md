# Handoff criptográfico independiente de propietario — GuiaIA QA (30/10/2026)

## Alcance y límite de confianza

Se implementa una **ceremonia offline** para preparar el alta de la
clave pública de un propietario en el registro QA ya existente.
No se generan claves automáticamente, no se acepta un nombre o UUID
offline de Minecraft como identidad y **no se permite ninguna acción
en un mundo ni la conexión de un bot**.

Hay tres acciones criptográficas distintas: (1) el propietario firma
una solicitud con su clave privada Ed25519; (2) el operador compara
**por un canal de confianza ajeno a la solicitud** el identificador y
la huella completa SHA-256 de la clave y firma un ticket de aprobación
con OTRA clave privada Ed25519; (3) el propietario verifica la clave
pública fijada del operador, comprueba su ticket y firma el consentimiento
final. Solo `openQaPrincipalRegistry.applySignedChange(ticket,consent)`
puede registrar la clave, y además exige el entorno QA restringido
y un checkpoint de integridad.

**Acredita posesión de claves, no identidad civil ni identidad Microsoft/
Minecraft online.** Un operador que copie la huella de la propia solicitud
sin verificar al usuario por otro canal NO ha autenticado al usuario.
El requisito de TTY reduce aprobaciones accidentales por pipe, pero
no demuestra presencia humana frente a alguien con control del equipo.
Un atacante con las claves privadas, el disco o el testigo puede
comprometer el modelo de laboratorio. No distribuir como sistema de
autenticación de producción.

## Interfaces y material de entrada

Desde `companion/`:

```text
npm run principal:offline-qa -- principal-request QA_WORLD PRINCIPAL_ID PRINCIPAL_PRIVATE_PEM REQUEST_JSON
npm run principal:offline-qa -- operator-review QA_WORLD OPERATOR_PRIVATE_PEM REQUEST_JSON TICKET_JSON
npm run principal:offline-qa -- principal-consent QA_WORLD PRINCIPAL_PRIVATE_PEM OPERATOR_PUBLIC_PEM TICKET_JSON HANDOFF_JSON
npm run principal:offline-qa -- verify QA_WORLD OPERATOR_PUBLIC_PEM HANDOFF_JSON
npm run principal:offline-qa -- operator-revoke QA_WORLD PRINCIPAL_ID OPERATOR_PRIVATE_PEM REVOCATION_JSON
npm run principal:offline-qa -- verify-revocation QA_WORLD OPERATOR_PUBLIC_PEM REVOCATION_JSON
```

- `QA_WORLD`: identificador explícito con prefijo `qa:` (por ejemplo,
  `qa:real-fabric:25593`); no acepta mundos de producción.
- Las claves privada y pública deben existir previamente en archivos PEM
  externos al repositorio. Cada actor conserva en su propio equipo su
  clave privada. No se exportan claves privadas como JSON ni se imprimen.
- Los directorios de trabajo deben existir y tener permisos `0700`;
  los archivos de entrada `0600`. Se deniegan symlinks de archivo,
  hardlinks, rutas no absolutas, directorios inseguros y rutas dentro
  del repositorio. Las salidas son `0600`, con creación exclusiva
  (`wx`), `fsync` y sin sobrescribir archivos existentes.
- `operator-review` requiere entrada y salida en un terminal TTY
  local y la confirmación textual completa `APROBAR <principalId>
  <huellaSHA256>`. El operador debe comprobar estos datos fuera de
  Minecraft y por un canal independiente antes de confirmar.
- Los archivos `request.json`, `ticket.json` y `handoff.json`
  contienen únicamente material público, pruebas de firma y nonces
  acotados, nunca claves privadas. Deben compartirse mediante un canal
  aprobado por las partes y verificarse contra la clave pública del
  operador fijada previamente. La solicitud tiene una ventana de unos
  2 minutos y el ticket de aprobación de un máximo de 60 segundos.
- `verify` no importa nada al registro; devuelve
  `registryEnrolled:false` y `worldActionsEnabled:false`.
- `operator-revoke` requiere un TTY local y la confirmación exacta
  `REVOCAR <principalId> <qaWorldId>`; emite un ticket Ed25519
  acotado a la identidad y al mundo. `verify-revocation` solo
  comprueba esa firma, devolviendo `registryRevoked:false`.
  La revocación efectiva se produce **solo** cuando el registro QA
  aplica el ticket mediante `applySignedChange(ticket)` y actualiza
  el checkpoint. La misma identidad no se puede registrar otra vez;
  se necesita un nuevo ID aprobado. Ninguna CLI altera directamente
  el registro ni el mundo.

Las pruebas usan claves Ed25519 efímeras, procesos CLI separados,
registro QA aislado en `/tmp`, intentos de suplantación, firmas
alteradas, permisos abiertos, enlaces y repetición del ticket.

## Estado verificado

**Validado en el Chromebook el 30/10/2026:** 11/11 pruebas
específicas de alta y revocación, 335/335 pruebas Node totales,
54/54 pruebas Python, sintaxis JavaScript y `git diff --check`.
Las pruebas utilizan claves de laboratorio y no conexiones de jugadores
reales.
El flujo de claves sirve como preparación de integración, no como
un sistema de inicio de sesión ni como autorización de follow/gather/deposit.
El antiguo `npm start` continúa negando esas acciones.

Pendiente para beta: un mecanismo real y seguro de relación entre
identidad de jugador autenticada, clave Ed25519 del propietario
y evento de conexión Fabric; una UI propia de operador con credenciales
y testigo fuera del equipo; instalación independiente, recuperación
operativa y validación sobre un servidor autorizado.
