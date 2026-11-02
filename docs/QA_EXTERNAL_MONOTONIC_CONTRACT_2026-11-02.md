# GuiaIA — contrato de anclaje externo de secuencia y prueba de rollback simultáneo

**Fecha:** 2026-11-02. **Base de partida:** commit local `da3fcf7`. **Entorno:** Chromebook Linux, Node.js, procesos de prueba independientes y claves Ed25519 sintéticas. **Ningún despliegue en Durán, ningún acceso a mundo compartido ni cambio en Teselia.**

## Problema resuelto en el laboratorio

Las fases anteriores probaron que restaurar **simultáneamente** un `head.json` antiguo firmado del testigo y un `floor.json` antiguo firmado del custodio produce dos afirmaciones antiguas perfectamente válidas. La comparación entre ambos no puede descubrir el rollback común.

Esta fase introduce una **tercera referencia lógica, con una cuarta clave Ed25519**, separada de las claves del operador, testigo y custodio. Mientras esta referencia conserva una secuencia reciente en un proceso separado que **no se restaura** junto con los otros dos ficheros, la comprobación detecta el retroceso de ambas autoridades.

**El servidor usado para la demostración es VOLÁTIL, NO DURABLE.** No constituye un anclaje monotónico real tras perder su propio estado. Su objetivo es definir un contrato, probar negativas y evitar presentar la doble firma en el mismo disco como prueba de integridad histórica.

## Contrato de lectura mínima

`companion/src/qa_high_water_client.js` acepta solamente un endpoint `http://127.0.0.1:<port>/` de QA y cuatro claves públicas Ed25519 **todas distintas**. La lectura `GET /high-water?nonce=<UUIDv4>` tiene un límite absoluto de 1.500 ms y exige una respuesta firmada con el esquema exacto:

```json
{
  "payload": {
    "aud": "guiaia:external-high-water-qa:v1",
    "worldId": "qa:...",
    "operatorFingerprint": "<SHA256 SPKI del operador>",
    "witnessFingerprint": "<SHA256 SPKI del testigo>",
    "custodianFingerprint": "<SHA256 SPKI del custodio>",
    "sequence": 1,
    "registrySha256": "<64 caracteres hexadecimales>",
    "nonce": "<UUIDv4 del GET>",
    "issuedAt": 0,
    "expiresAt": 3000
  },
  "signature": "<Ed25519 base64url>"
}
```

Los tiempos del ejemplo son **simbólicos**, no marcas válidas. Una respuesta real necesita `expiresAt-issuedAt=3000`, antigüedad de emisión máxima 1.500 ms, nonce coincidente, ámbito y todas las huellas coincidentes, secuencia no negativa y firma del cuarto custodio. El cliente es **solo lectura**: no hay `publish`, comandos de recuperación, reintentos de CAS ni autorización del bot.

`companion/src/qa_triple_authority_reconciler.js` encadena **cinco lecturas firmadas y recientes**: alto-mínimo A1, custodio F1, testigo W, custodio F2 y alto-mínimo A2. Si A1/A2 o F1/F2 cambian durante la lectura, la operación falla cerrada. Si W o F son inferiores al alto-mínimo, si el custodio supera al testigo o si un mismo número de secuencia tiene un hash incompatible, también falla. Solo devuelve `qa_three_authority_equal_observation` cuando las tres observaciones coinciden; los adelantos aún no anclados exigen revisión manual. Incluso la coincidencia declara `world_actions=false`, `production_ready=false`, `atomic_snapshot=false` y `external_monotonicity_verified=false`: **no es un protocolo linealizable**.

## Simulador de tercero independiente y pruebas

`companion/test/qa_high_water_memory_child.js` es un proceso hijo de laboratorio que guarda el alto-mínimo **exclusivamente en RAM** y sirve respuestas Ed25519 por HTTP loopback. El operador solo puede intentar avanzar ese proceso por IPC de prueba con un ticket Ed25519 válido y secuencia CAS siguiente. Antes de registrar un nuevo valor, el propio proceso consulta **dos** clientes firmados con nonce y caducidad: testigo y custodio deben concordar con el ticket. El CAS se repite al regresar de la espera asíncrona. **La vía IPC no está disponible como endpoint de producto** ni debe copiarse a un servidor público.

La suite `companion/test/qa_high_water_contract.test.js` comprueba:

1. Bootstrap y avance independiente, lectura firmada, cambio de estado a `requiresManualReview` hasta registrar el nuevo alto-mínimo, y rechazo de CAS repetido.
2. Restauración real en disco de **ambos** ficheros firmados `seq=0` mientras el proceso alto-mínimo sigue vivo en `seq=1`. La tercera autoridad detecta el rollback simultáneo.
3. Rechazo de avance si uno o ambos checkpoints firmados todavía no coinciden con el ticket.
4. Clave pública incorrecta, URL externa no autorizada, clave reutilizada y respuesta antigua con nonce de otra solicitud.
5. Caída del alto-mínimo y arranque de un nuevo simulador con la **misma clave** pero sin estado: las verificaciones **fallan cerradas**, nunca asumen el último valor desde los discos antiguos.
6. Firma de operador falsa, mundo incorrecto, duplicación, dos avances concurrentes sobre la misma secuencia y CAS anterior.
7. Cambio del alto-mínimo entre sus dos lecturas firmadas, que es rechazado; una inspección nueva del estado estable puede coincidir.

No se ha demostrado persistencia externa física, reinicio de máquina, integridad frente a un atacante que controle **también** la tercera fuente, ni resistencia a apagones. Un proceso de RAM y una cuarta firma no son un contador hardware monotónico ni una autoridad de consenso.

## Validación local y reproducibilidad

- `node --test companion/test/qa_high_water_contract.test.js`: **7/7 PASS**, incluidos los dos archivos de checkpoint antiguos restaurados, la retención de secuencia en un proceso hijo externo a esos archivos y la prueba de pérdida de su memoria que falla cerrada.
- `cd companion && npm test`: **412/412 PASS**, sin fallos, cancelaciones u omisiones. Los ensayos anteriores de permisos y misiones siguen verdes.
- `PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -q`: **58/58 PASS**.
- Sintaxis de los cuatro archivos JavaScript nuevos y `git diff --check`: PASS. Durante el ensayo se confirmó el proceso Java original de Teselia con PID 11085 y sin puertos temporales QA persistentes.

**Evidencia limitada:** las tres autoridades son procesos QA en el mismo Chromebook, no una fuente hardware/servicio físicamente independiente; la clave privada del firmante de alto-mínimo se pasa al hijo sintético por IPC. Esta validación no satisface el requisito pendiente de persistencia de producción.

## Requisitos previos para sustituir el simulador

Para producción hay que escoger una fuente durable **en un dominio de fallo/administración diferente** de los VHD, discos y copias del testigo y del custodio, con garantía de avance monotónico sin rollback, confirmaciones durables, autenticación por principal/ámbito, recuperación/revocación de claves, conservación de valores y pruebas de interrupción y restauración. Su API de escritura debe validar las dos fuentes firmadas, CAS y no permitir reinicializar una autoridad existente. En caso de pérdida del proveedor no se permite recrear el alto-mínimo desde las dos copias potencialmente restauradas: **fail-closed y revisión fuera de banda**. Habrá que diseñar confirmación en varias etapas, pérdida de ACK, coherencia temporal y operaciones de emergencia.

**Solo entonces** tendría sentido integrar el bloqueo obligatorio de nuevas acciones Minecraft mediante esta fuente, y auditar con pruebas reales WSL2 Durán y beta con identidad oficial. Esta fase deliberadamente **no** cambia las garantías de autorización ya desplegadas.
