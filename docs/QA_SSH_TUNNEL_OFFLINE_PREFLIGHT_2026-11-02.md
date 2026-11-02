# GuiaIA — preflight offline para un futuro testigo entre equipos

**Fecha:** 02/11/2026. **Ámbito:** laboratorio QA, sin conexiones remotas.

## Resultado y alcance

`companion/qa_witness_tunnel_check.js` incorpora una comprobación independiente de configuración para un eventual transporte cifrado mediante SSH hasta un testigo alojado en otro ordenador. Solo ofrece `--qa-check`: inspecciona los archivos y devuelve `connected:false`; **no inicia SSH, no conecta a ningún servidor ni abre puertos**.

El testigo firmado sigue siendo `companion/qa_witness.js` y el cliente de checkpoint mantiene su verificación Ed25519 de firma, mundo, nonce fresco y secuencia. El validador de transporte no sustituye esas comprobaciones.

El JSON de configuración QA contiene exactamente estos campos: `version`, `sandboxOnly`, `worldId`, `sshHost`, `sshPort`, `sshUser`, `identityFile`, `knownHostsFile`, `hostKeyFingerprint`, `localPort`, `remotePort`, `operatorPublicKeyFile` y `witnessPublicKeyFile`.

Se exige directorio temporal privado de laboratorio (0700), archivos 0600, sin enlaces simbólicos ni hardlinks, clave privada OpenSSH Ed25519 verificable offline, clave pública Ed25519 del operador y del testigo, nombre y puerto exactos en una sola entrada de host conocida, y huella SHA-256 coincidente. Se rechazan hosts malformados o locales, opciones inyectadas, configuraciones con campos extra, y puertos fuera de rango.

La construcción auditada del futuro reenvío aplica `BatchMode`, `StrictHostKeyChecking`, `IdentitiesOnly`, sin agente, contraseñas ni proxy; restringe origen y destino del reenvío a `127.0.0.1`. **La estructura de argumentos no ha sido ejecutada ni constituye una conexión verificada.** La huella real de host deberá comprobarse previamente por un canal independiente.

## Pruebas

`companion/test/qa_witness_tunnel_check.test.js` verifica cinco casos: configuración correcta; discrepancia de clave y nombre; archivos inseguros o identidad inválida; entrada malformada/inyección; y clave de host fijada a un puerto SSH distinto. Todos los casos se ejecutan sin comunicación de red.

Durán y Portatiltek estaban desconectados en la consulta del 02/11/2026. No hay evidencia de testigo en otro ordenador, túnel funcional, instalación limpia remota, sesiones Minecraft online ni prueba Cobblemon. El validador no pretende cubrir esas capacidades.

**Pendiente para cerrar el testigo remoto:** segundo equipo autorizado conectado; identidad y almacenamiento privados separados, clave de host verificada fuera de banda, prueba de reenvío cifrado, pérdidas de conexión, sustitución de claves, reinicio de testigo y validación con Fabric QA real. No exponer el endpoint HTTP de checkpoint a interfaces de red sin un transporte autenticado.
