# GuiaIA — prueba física Chromebook–Durán y cierres NTFS

Fecha: 2026-11-02. Alcance: validación QA aislada; sin tocar Teselia, AutoCAD ni repositorios existentes. Fuente local: commit 62aaa46, seguido de cambios de compatibilidad documentados en esta fase.

## Aceptación de segundo ordenador

Se transfirió exclusivamente el tar.gz de `git archive HEAD` desde el Chromebook a Durán con Tailscale Taildrop. SHA-256 idéntico en ambos equipos: `6e1c2e8e75c31ff6f66b66ed44cc2173bfc069b583a9e0a27688a54085fd7bff`. Se descomprimió únicamente en `%TEMP%\GuiaIA-QA-physical-62aaa46` y en `/home/iagui/.cache/guiaia-crosshost-qa-62aaa46` de Ubuntu WSL2 en Durán.

- Windows nativo, Node 24: `npm ci --offline --ignore-scripts` instala 92 paquetes; Python 58/58; Node 362/364 exitosas, 0 fallos, **2 omitidas por PTY Linux**. El ejecutable del testigo, la comprobación offline SSH y la ceremonia de claves deniegan en Windows nativo **antes de leer material privado** por no existir implementación comprobada de ACL NTFS. Es una restricción deliberada, **no soporte nativo para almacenar claves**.
- Ubuntu WSL2 en el equipo Durán, Node 22/Python 3.12: `npm ci --ignore-scripts` instala 92 paquetes, Node 364/364 y Python 58/58. Tres pruebas del testigo en proceso independiente pasan tras actualizar la protección nativa Windows.
- Chromebook: 19/19 pruebas focales de ceremonias, testigo y transporte local; los cambios usan el mismo código que pasó en Durán.

## Seguridad de las claves privadas

La inspección en Durán confirmó que las carpetas temporales Windows heredan permisos NTFS que no pueden acreditarse como equivalentes a POSIX 0700/0600. Se incorporaron rechazos explícitos a las tres entradas sensibles: `companion/qa_witness.js`, `companion/qa_witness_tunnel_check.js` y `companion/offline_principal_handoff.js`. Las pruebas Windows confirman la denegación segura y que no aparecen ficheros sensibles de salida. En Linux las pruebas anteriores siguen ejecutando los flujos criptográficos positivos y negativos. **No extrapolar estas protecciones al resto de entradas QA sin una auditoría específica de permisos NTFS.** La ruta recomendada para QA con claves es Linux/WSL2 hasta tener una política NTFS verificada.

## Testigo en un host físico distinto: parcial, no aprobado

La conectividad Tailscale y el intercambio de claves públicas por Taildrop sí funcionan. En el Ubuntu WSL2 de Durán se generó una clave testigo Ed25519 independiente, sin transferir su privada al Chromebook, y se arrancó `qa_witness.js` escuchando solo en loopback. El Chromebook recibió su pública y verificó su huella SHA-256: `f18ecfd8ba90fba278e9676afc42f4e2cc5ebb85918edcd826d4bedd65d0229d`. Durán publicó un proxy temporal Tailscale Serve **HTTPS tailnet-only**, sin Funnel, y respondió localmente con HTTP 403 a una solicitud deliberadamente no autenticada, coherente con el rechazo esperado. Sin embargo, desde el Chromebook `tailscale ping` devuelve pong (5–13 ms), mientras que la apertura TCP/443 **expira**. No se verificó TLS desde el Chromebook ni el protocolo remoto de checkpoints; no se autorizó ni aplicó una excepción de firewall. El servicio temporal se debe retirar antes de dar la sesión por cerrada.

Estos son **tres niveles distintos**: transferencia entre hosts verificada; instalación y tests en segundo ordenador verificados; transporte HTTPS y witness Ed25519 entre hosts **pendiente**.

## Limpieza y próximas pruebas

Conservar únicamente evidencias de test y documentación no secreta. Retirar servidores QA, configuraciones Tailscale Serve de esta prueba, claves Ed25519 desechables y copias temporales que no pertenezcan a otros agentes. Tres archivos ajenos recibidos accidentalmente por Taildrop fueron preservados sin abrir en `/home/iagui/tailscale-inbox-preserved-20261102`; no forman parte de GuiaIA y no deben borrarse sin autorización. El último bloqueo técnico a estudiar es el tráfico entrante HTTPS por Tailscale en Durán mediante diagnóstico **de solo lectura**, seguido de una prueba explícitamente acotada de checkpoint desde Chromebook. La autenticación Microsoft online, cliente multijugador y Cobblemon siguen pendientes.

## Actualización posterior del 02/11/2026

El bloqueo TCP/443 descrito anteriormente fue resuelto: el contenedor Linux del Chromebook no tenía una ruta de kernel por `tailscale0`; el puente local `socat` + `tailscale nc` utilizó la red de espacio de usuario de Tailscale con HTTPS y verificación de certificado. La prueba posterior **sí ha publicado y verificado un checkpoint Ed25519 firmado entre Chromebook y Durán**, además de confirmar denegación por firma falsificada, repetición, rollback y pérdida del enlace con recuperación. La evidencia y los límites actualizados están en [QA_SIGNED_WITNESS_PHYSICAL_HOST_2026-11-02.md](QA_SIGNED_WITNESS_PHYSICAL_HOST_2026-11-02.md). Este informe mantiene el resultado histórico de la prueba inicial para conservar trazabilidad; el estado actual del roadmap prevalece.
