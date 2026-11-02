# GuiaIA — custodio de suelo firmado de QA en proceso independiente

**Fecha:** 2026-11-02. **Base:** commit `4c02ecd`. **Entorno ensayado:** Chromebook Linux, Node 22, secretos sintéticos y carpetas QA desechables en `/tmp`. **No** se configuró Durán ni se cambió la instalación Fabric de Teselia. No es un anclaje irreversible ni un despliegue de producción.

## Alcance real

El testigo Ed25519 de GuiaIA permite detectar un retroceso cuando existe un mínimo firmado fuera de su almacenamiento. Hasta ahora ese mínimo era un token inyectado en los tests. Esta fase introduce un **custodio separado por proceso y fichero** que firma, guarda, lee y compara un mínimo independiente mediante CAS, pero sin prometer persistencia externa de máquina/disco. Su directorio de estado sigue siendo temporal y deliberadamente desechable.

Componentes nuevos y modificados:

- `companion/src/qa_floor_custodian.js`: servidor HTTP **solo 127.0.0.1**, estado `floor.json` 0600 bajo una ruta obligatoriamente aislada `guiaia-independent-floor-qa-*` con permisos 0700, bloqueo exclusivo `floor.lock`, escritura mediante fichero temporal 0600 + `fsync` de fichero + `rename` + `fsync` de directorio. Antes de aceptar un avance CAS válido firmado por el operador, **el propio custodio consulta con el cliente existente al testigo**, comprueba su firma Ed25519, nonce, caducidad, mundo y hash. Vuelve a validar el CAS tras la espera asíncrona para rechazar carreras. No recibe jamás la clave privada del testigo.
- `companion/src/qa_floor_client.js`: cliente de lectura/avance de QA, con anclaje estricto a 127.0.0.1, firmas y huellas de las tres autoridades, nonce aleatorio y comprobación de frescura. Las lecturas tienen límite absoluto de 1.500 ms; el avance del custodio, que depende de una segunda consulta de 1.500 ms al testigo, tiene límite independiente de 3.500 ms. **Ninguno sustituye el deadline de autorización de misiones.**
- `companion/qa_floor_custodian.js`: ejecutable de proceso independiente (`--qa-serve <config-file>`), con `sandboxOnly:true`, esquema de configuración exacto, directorio privado de configuración en `/tmp/guiaia-floor-config-qa-*`, archivos y claves 0600 y sin symlinks; impide cargas de claves privadas desde otros directorios. Solo su propia clave privada de firma vive en ese proceso; importa las claves públicas del operador y del testigo. Deniega ejecución nativa de Windows. Se cierra con SIGTERM/SIGINT; tras SIGKILL conserva bloqueo y rehúsa reiniciar sin una revisión segura adicional (no hay herramienta automática de recuperación de `floor.lock`).
- `companion/src/qa_independent_rollback_floor.js`: suma `verifyLive()` con dos lecturas de fuentes distintas, ambas **frescas, firmadas y con nonce**: primero consulta el custodio, luego el testigo. El resultado solo acredita que el testigo no está por debajo del mínimo presentado. Sigue siendo `read_only=true`, `world_actions=false`, `production_ready=false`. El comparador previo con mínimo firmado estático se mantiene para el laboratorio de demostración.

## Pruebas negativas y límite descubierto

La suite `qa_floor_custodian.test.js` prueba nueve escenarios: secuencia 0/1 y reinicio del custodio en otro proceso sin pérdida de firma; rechazo de avance de suelo antes del checkpoint firmado; rechazo de duplicados y carreras same-parent; rollback real del `head.json` del testigo detectado por un custodio que conserva `seq=1`; estado del custodio manipulado; inyección de una respuesta de red antigua con nonce distinto; clave de custodio errónea; configuración y credenciales mal protegidas; caída abrupta de proceso con bloqueo exclusivo que impide reabrirlo silenciosamente. En las pruebas, los archivos privados y las claves de QA se generan localmente y se borran al finalizar; no se usan credenciales Microsoft ni claves reales del propietario.

**Contraejemplo imprescindible:** si se restaura **también** un `floor.json` antiguo legítimamente firmado, el custodio reiniciado puede emitir respuestas nuevas para esa secuencia antigua. Las firmas y los nonces no detectan la restauración completa de la historia de una autoridad. El test demuestra explícitamente esa debilidad. Por tanto, el custodio es una **segunda autoridad de comprobación**, pero no un almacén monotónico a prueba de rollback, y nunca debe utilizarse como única garantía de un servicio productivo.

## Evidencia de regresión final

La prueba focal del proceso custodio concluyó **9/9 PASS** (incluido el caso `SIGKILL`, el reinicio en un segundo proceso y la restauración de estados firmados). La suite completa Node `npm test` terminó con **399/399 PASS, 0 fallos, 0 omitidos** y el descubrimiento Python `PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -q` con **58/58 PASS**. Sintaxis Node y `git diff --check` correctos. El proceso original de Teselia continuó en PID 11085 y no quedaron puertos QA del escenario abiertos.

## Limitaciones y pasos posteriores

- Dos procesos que se ejecutan en **un mismo Chromebook** no equivalen a equipos físicamente independientes, ni a almacenes con resistencia a rollback. Si ambos ficheros y claves se respaldan/restauran juntos, el sistema pierde la evidencia histórica. Sigue pendiente desplegar un medio de anclaje durable, externo y monotónico, con clave propia, política operativa y garantías de disponibilidad.
- **No hay acoplamiento al flujo de autorizaciones del bot** ni ejecución de operaciones Minecraft. En un diseño final, la indisponibilidad del custodio deberá denegar las acciones relevantes y habrá que analizar el orden de commit de dos autoridades, pérdidas de ACK, recuperación de escrituras parciales y causalidad entre secuencias.
- No se han comprobado apagones reales del sistema anfitrión, restablecimiento del volumen WSL2, copia/restauración cifrada, custodia externa, reinicio de Durán, autenticación oficial online-mode ni beta multijugador. Tampoco se ha habilitado distribución pública.

**Criterio de cierre de esta fase:** proceso independiente reproducible, CAS y prueba firmada de origen contrastada, fallos y denegaciones verificados, regresiones completas y estado de Git consolidado; **no** declarar que la persistencia del suelo está resuelta.
