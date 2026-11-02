# GuiaIA — demostración QA de suelo externo firmado antirrollback

**Fecha:** 2026-11-02. **Base:** `main`, commit `729e9a9`. **Ámbito:** tests sintéticos del testigo en un proceso local, claves Ed25519 efímeras, sin servidor Minecraft, sin acciones de mundo, sin acceso a Durán y sin modificación de Teselia. **No es una solución antirrollback desplegada.**

## Amenaza que se prueba

Un atacante con capacidad de restaurar una copia coherente antigua de `head.json` puede hacer que el mismo testigo, usando su clave privada original, vuelva a firmar respuestas sobre una secuencia antigua. La verificación criptográfica y el CAS entre la versión almacenada y un avance posterior **no demuestran la historia monotónica** si solo existe una copia del almacenamiento. Esto ya estaba reflejado en `remote_checkpoint.test.js`: tras restaurar un viejo head auténtico, el propio testigo acepta el estado antiguo como válido.

## Prueba y módulo añadido

`companion/src/qa_independent_rollback_floor.js` expone **solo** `createQaIndependentRollbackVerifier`, que configura internamente el cliente QA original con el endpoint local restringido a `127.0.0.1`, firma Ed25519 del testigo pinneada y pruebas estrictas de nonce, caducidad y alcance. La nueva comprobación **solo lee** el último checkpoint del testigo (`GET`) y lo contrasta con un token que debe estar firmado por una **tercera clave Ed25519 distinta** de la del operador y la del testigo. Esa firma abarca el identificador del mundo, las huellas públicas de operador y testigo, la secuencia mínima y el SHA-256 del registro correspondiente. El módulo valida esquema exacto, firma, audiencia, mundo, claves y secuencias. Nunca firma avances, hace POST, modifica checkpoints, maneja journals o autoriza acciones.

La comparación rechaza si la secuencia remota es menor que el mínimo firmado o si el mismo número de secuencia tiene un hash distinto. Se permite una secuencia remota posterior únicamente como **comprobación del suelo mínimo**: no es una auditoría de toda la cadena de transiciones. El resultado favorable lleva `read_only=true`, `world_actions=false`, `production_ready=false`. El módulo no se integra en el camino de autorización del bot; ningún fallo de esta verificación concede permiso.

## Evidencia aislada

El test reproduce con archivos reales un arranque del testigo, un bootstrap firmado `seq=0`, un avance firmado `seq=1`, la conservación de la copia antigua firmada del head, el cierre limpio y la restauración del `head.json` de secuencia 0, seguida de un reinicio del mismo testigo con la misma clave. El cliente firmado **acepta** la secuencia 0, demostrando el riesgo real. Un suelo independiente conservado en `seq=1` **rechaza** ese rollback. Además se prueban firma de suelo falsificada, payload alterado, mundo incorrecto, clave equivocada, falta de estado, hash incompatible y claves de operador/testigo/tercera autoridad no separadas.

**Prueba negativa deliberada:** si también se entrega un suelo firmado antiguo (`seq=0`), el testigo restaurado `seq=0` lo satisface. Esto muestra por qué el token firmado por sí solo **no** evita rollback: el operador necesitará una fuente externa, durable y monotónica del valor más reciente; la copia del suelo no puede quedar bajo control del mismo atacante o en el mismo respaldo restaurable.

**Verificaciones locales finales:** nuevo fichero de pruebas de suelo independiente **4/4 PASS**, suite completa Node **390/390 PASS**, Python **58/58 PASS**, `node --check` y `git diff --check` correctos. No se han abierto conexiones hacia Durán, ni realizado despliegues.

## Límites y siguiente fase

- No existe aquí almacenamiento durable, servicio remoto ni un anclaje confiable real. Es una prueba de contraste offline con un suelo suministrado explícitamente, y no una garantía de integridad del historial completo. Queda sin validar la resistencia a pérdidas de energía, restauración de VHD, compromiso del firmante externo, falta de disponibilidad de un suelo reciente y ataques de rollback simultáneo de todas las copias.
- No se modifica el vencimiento estricto de 1.500 ms, la autorización Ed25519 de avances ni la denegación ante pérdida del testigo. El módulo no sustituye los mecanismos existentes.
- El acceso a Durán quedó bloqueado por los controles de seguridad en la fase anterior. No se intentó recuperar el acceso mediante medios alternativos en esta fase y no se reinició WSL2.
- Para una beta futura será imprescindible elegir un custodio separado para el suelo, una forma de **publicación atómica monotónica** que no admita reemplazar por un suelo firmado antiguo, recuperación fail-closed cuando esté indisponible y pruebas con almacenamiento realmente separado. Después habrá que verificar también el reinicio WSL2, almacenamiento de claves, identidad Minecraft oficial y consentimiento antes de usarlo con personas reales.
