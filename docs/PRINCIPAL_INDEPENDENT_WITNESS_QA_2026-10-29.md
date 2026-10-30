# GuiaIA — testigo criptográfico para el checkpoint externo de identidades

**Fecha:** 29/10/2026. **Ámbito:** QA local aislada, sin desplegar en Teselia.
**Rama:** feature/principal-enrollment-qa. No se ha hecho push, merge ni PR.

## Misión y alcance

El checkpoint anterior estaba guardado junto a los archivos de identidades y
el parámetro externallyPinnedCheckpoint exigía que otra entidad entregara una
referencia de confianza. Esta fase construye y prueba el protocolo de esa
entidad, pero todavía no le concede un dominio de seguridad independiente real.

### Contrato implementado

- Testigo HTTP **solo en 127.0.0.1** y puerto efímero de laboratorio. Solo
  arranca en un directorio temporal con prefijo QA validado.
- La creación del primer checkpoint requiere un ticket firmado por la clave
  **Ed25519 del operador**. El servicio no aprende el hash inicial desde el
  registro ni lo elige por defecto.
- Los avances requieren una firma nueva del operador, ámbito de mundo, huella
  del operador, nonce, caducidad, revisión anterior exacta, hash anterior,
  revisión posterior estrictamente consecutiva y SHA-256 nuevo.
- Comprobación de comparación-y-canje (CAS): dos avances simultáneos con la
  misma versión anterior no pueden aceptarse ambos.
- El estado local del testigo se escribe de forma duradera mediante fichero
  privado 0600, renombrado atómico, fsync de fichero y directorio, además de
  firma propia con la clave del testigo; se verifica al reabrir.
- La consulta genera un nonce único y exige una respuesta breve Ed25519
  firmada por un testigo cuya clave pública está fijada externamente.
  No se admiten redirecciones, claves RSA, URLs remotas arbitrarias, cambios
  de ámbito ni respuestas antiguas.
- Una consulta cada vez es obligatoria antes de utilizar el permiso de un
  solo uso cuando el gateway QA tiene requireRemoteCheckpoint=true. Se compara
  el testigo con el checkpoint local **leído de nuevo del registro** y se
  reevalúa la revocación después de cualquier latencia de red.
- La caída del testigo o la discrepancia de versión bloquea el depósito antes
  de reservar el nonce y antes de acceder al mundo.

Archivos nuevos: companion/src/remote_checkpoint.js,
companion/src/qa_checkpoint_witness.js,
companion/test/remote_checkpoint.test.js,
companion/test/qa_checkpoint_witness_process.js.
Se ha actualizado companion/src/session_identity.js y las pruebas
de integración de matrícula y puerta de acciones.

## Límite de seguridad que se ha probado, no ocultado

Este servicio se ha ejecutado como **proceso independiente** de Node en
Penguin, pero sigue compartiendo equipo, usuario y permisos de disco con el
laboratorio. Por tanto NO es todavía una autoridad independiente segura.

Una prueba reproduce expresamente el ataque: restaurar una copia anterior
del propio head.json firmado del testigo, detener y volver a iniciar el
servicio con la misma clave. La restauración sigue siendo válida.
**El testigo tampoco puede demostrar monotonicidad frente a rollback total de
sus propios archivos sin un segundo dominio de confianza fuera del equipo.**

Para producción se necesita un almacén remoto administrado independientemente,
sin permisos de restauración para el compañero, con control de acceso,
almacenamiento de incremento monotónico, copias y auditoría; claves en
custodia separada, autorización de operadores reales, rotación y recuperación
manual auditada. El protocolo QA no cumple por sí solo esos requisitos.

Los fallos a mitad de una actualización entre diario local, checkpoint local
y testigo remoto causan denegación segura; la reconciliación autoritativa
no está implementada. Una consulta a un testigo con estado antiguo también
deniega en vez de permitir continuar automáticamente.

## Evidencias y condiciones de cierre

- Pruebas de firmas, comparación CAS, escrituras inválidas, reinicio,
  alteración de archivo, indisponibilidad, cliente mal fijado y proceso
  separado con caída deliberada.
- Pruebas de gateway con registro local antiguo y un testigo actualizado,
  incluyendo cofre no abierto y nonce no consumido.
- Regresión de Node completa y comprobación final de Git: registrar solo
  los resultados realmente observados.
- Pendiente: ejercicio de esta nueva función contra Fabric real, prueba de
  recuperación tras corte abrupto de operaciones, protección fuera del equipo,
  publicación en GitHub y CI. No se debe activar en Teselia.


## Resultado de esta ejecución

- Testigo y registro, pruebas dirigidas: **37/37 PASS**.
- Regresión Node del compañero: **153/153 PASS**.
- Sintaxis de seis archivos JS y git diff --check: **PASS**.
- JSON local de evidencia: docs/evidence/PRINCIPAL_INDEPENDENT_WITNESS_QA_2026-10-29.json.
- Prueba Minecraft real de este testigo: **NO EJECUTADA**.
- CI remota de este commit local: **NO EJECUTADA**.
