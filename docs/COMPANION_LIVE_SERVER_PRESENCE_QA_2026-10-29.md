# GuiaIA — presencia de conexión activa: consulta firmada contra el JVM real (2026-10-29)

**Estado:** rama local feature/principal-enrollment-qa, sin despliegue ni fusión con main. Fabric 1.21.1 exclusivamente en un mundo de QA desechable. Teselia no se modifica.

## Problema que aborda este experimento

Un registro de eventos JOIN/DISCONNECT firmado en disco no demuestra que el servidor esté ejecutándose. Un cierre súbito puede dejar durante hasta 45 segundos un JOIN válido sin DISCONNECT. Los mecanismos anteriores no eran suficientes para autorizar operaciones durante ese intervalo.

## Diseño limitado al laboratorio

- GuiaLiveSessionQuery.java: consulta de presencia solo en 127.0.0.1:25594, iniciada exclusivamente cuando las opciones QA aisladas han pasado sus comprobaciones. No escucha fuera del loopback. No acepta comandos de mundo ni escribe inventarios.
- Solicitud de conexión UUID y nonce aleatorio de 128 bits. El JVM responde con datos de esa conexión, booleano de presencia y ventana de 3 segundos, firmados Ed25519. La sesión proviene de handlers reales JOIN/DISCONNECT.
- live_presence.js verifica firma con clave pública fijada externamente, ámbitos, UUID, nonce exacto, esquema JSON, ventana breve y límite de tamaño/timeout. No se aceptan respuestas de consultas anteriores.
- session_identity.js: cuando requireLivePresence=true, el depósito solicita una prueba fresca antes de reservar el permiso de uso único. Después de esperar la respuesta revalida autorización y revocación y solo entonces puede depositar. La denegación no abre cofres ni consume nonces.
- Los adaptadores de QA antiguos siguen existiendo; esta comprobación no es una política global obligatoria para todas las acciones ni apta para producción.
- El arranque QA verifica que el puerto permanece cerrado si falta la configuración.
- El ensayo extendido termina solo el proceso Java desechable mediante SIGKILL cuando hay un cliente offline real conectado. Comprueba el JOIN antiguo en disco y que la consulta en vivo rechaza la operación sin tocar inventarios.

## Comprobaciones locales

- Ocho pruebas dirigidas de live_presence.test.js superadas (firma, nonce, falsificación, reproducción, caducidad, caída, timeout y configuración).
- Prueba de puerta de acciones ante consulta inaccesible, prueba antigua y revocación durante la espera, sin acceso al mundo ni reserva de nonce.
- npm test: **134/134**, correcto.
- Fabric Observer: BUILD SUCCESSFUL con JDK 21 y Gradle 8.10.2; nuevo servicio de presencia observado en 127.0.0.1:25594 solo cuando se habilita QA.
- Prueba real completa: PASS con cinco marcadores verificables en docs/evidence/LIVE_PRESENCE_FABRIC_QA_2026-10-29.json, extraídos del log de ejecución. La prueba confirmó el comportamiento fail-closed por defecto, firmas y logins, reinicio, depósito con presencia firmada y revocación.
- SIGKILL real de solo ese proceso Minecraft desechable: tras la muerte del JVM persistía un JOIN firmado aparentemente activo, pero el desafío fresco falló; puerta cerrada, 0 operaciones de mundo, ningún nonce reservado. Este resultado no equivale a prueba de corte de energía física ni a seguridad de producción.
- Comprobación posterior: el puerto de QA quedó cerrado y el mundo temporal fue eliminado por el harness.

## Limitaciones

1. Este canal responde sobre presencia en el instante de la consulta; el servidor podría morir después de responder y antes de ejecutar la operación. La atomicidad autoritativa requeriría validar y operar desde el servidor junto con conciliación tras reinicio.
2. Claves personales y operador del ensayo aún son sintéticos. No hay autenticación real del titular del nombre offline.
3. Puerto QA fijo y clave de laboratorio no constituyen una arquitectura de producción. Faltan diseño de amenazas, custodia y rotación de claves, concurrencia y gateway único.
4. Pendientes rollback de revocaciones, claims y compatibilidad Cobblemon.
5. Sin Teselia, push, PR, merge ni despliegue.
