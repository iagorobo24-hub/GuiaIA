# GuiaIA — Cobblemon + testigo físico Durán: intento y bloqueo seguro

**Fecha:** 2026-11-02. **Rama:** `main`, HEAD de partida `d3e4e94`. **Resultado de misión:** NO VALIDADO (fallo seguro antes del login). **Alcance:** mundo de prueba Fabric 1.21.1 / Cobblemon 1.8.2, cuentas sintéticas offline, sin tocar Teselia.

## Preparación verificada

- Dos equipos accesibles por Remote Desktop Commander: Chromebook (`penguin`) y Durán (Windows + Ubuntu WSL2); servidor Teselia original permaneció activo. No había cambios en Git antes de la fase.
- Se transfirió a WSL **solo código fuente**, nunca claves: `qa_witness.js`, `qa_checkpoint_witness.js` y `remote_checkpoint.js`. Las primeras copias perdían el salto de línea final; se rechazaron por SHA-256. Las versiones corregidas coincidieron **exactamente** con los tres hashes del Chromebook antes de ejecutarse.
- Se detectó que WSL se apagaba entre invocaciones y limpiaba `/tmp`. Se mantuvo una sesión WSL activa para conservar los directorios privados mientras durase el ensayo.
- Clave de operador Ed25519 generada en el Chromebook; clave de testigo Ed25519 diferente generada en WSL. Se verificó la coincidencia del SHA-256 de la clave pública de operador entre ambos y los permisos 0700/0600. No se transfirió ninguna clave privada a otro equipo ni al sistema de archivos Windows.
- `qa_witness.js` quedó ligado a `127.0.0.1` en WSL. Tailscale Serve se activó temporalmente en Durán por HTTPS, **solo tailnet, sin Funnel**, y se usó `socat` + `tailscale nc` y el proxy QA con SNI y verificación TLS en el Chromebook. Comprobación real: `TLS_VERIFY=0` y `HTTP=403` esperado ante una consulta sin checkpoint firmado.

## Resultado del intento real

Se invocó `scripts/qa_signed_delivery_real_server.py --cobblemon ... --physical-witness-outage` con el fixture físico privado. El servidor desechable cargó Cobblemon, habilitó el puente de identidad de laboratorio, generó el terreno y preparó tronco y cofre con el marcador `GUIAIA_REAL_DELIVERY_WORLD_READY`.

**Antes de que entraran OwnerQA y GuiaIA_QA**, el controlador terminó con código no cero y `Standalone real Fabric QA failed: Independent signed checkpoint remains unconfirmed`. No se obtuvo marcador PASS de misión, ni recibos de extracción o depósito. La marca de interrupción en el proxy apareció durante la salida defensiva del driver: **no demuestra una caída de testigo después de una recolección**.

La inspección directa en WSL verificó que el almacenamiento del testigo **no contenía `head.json`** tras el fallo. No se observó checkpoint inicial persistido, a diferencia de un intento histórico anterior. El ensayo de dos hosts con Cobblemon **permanece pendiente**, aunque la misión Cobblemon con un testigo en un proceso local distinto ya había pasado anteriormente.

## Diagnóstico de transporte (sin cambios de autorización)

- GET y POST de prueba no autorizados respondieron `HTTP 403` a través del transporte HTTPS: aproximadamente 0,14–0,26 s en varias mediciones.
- Una sonda Node HTTP POST sin firma tardó **1.349 ms** en frío y después aproximadamente **63–72 ms**. Eso sitúa el arranque frío peligrosamente cerca de la fecha límite estricta de 1.500 ms, pero no demuestra por sí solo qué tramo ocasiona el fallo firmado.
- Una publicación sintética firmada de diagnóstico no llegó a confirmarse: el cliente devolvió `Remote checkpoint witness unavailable` a los **1.523 ms**. La reconciliación posterior de solo lectura tampoco encontró un checkpoint válido. Un intento adicional de diagnóstico quedó bloqueado por los controles de seguridad de la sesión y **no se eludió el bloqueo**.
- **Hipótesis pendiente:** latencia del establecimiento de conexión o diferencias entre petición HTTP Node y `curl`, agravadas por el arranque de WSL/servicios. No se puede afirmar todavía que Cobblemon sea la causa ni que calentar la conexión sea una solución suficiente. No se ha eliminado el plazo de 1.500 ms, debilitado verificaciones, reintentado a ciegas un CAS firmado ni autorizado acciones sobre el mundo.

## Limpieza y verificaciones

- Tailscale Serve Durán: **`No serve config`**, comprobado.
- Proxies TCP/HTTPS del Chromebook: detenidos; los puertos de QA `24119/24121/25593/25594` cerrados. Mundo Fabric desechable eliminado.
- Proceso de testigo WSL: detenido limpiamente, sin `head.json`; directorios efímeros de claves, checkpoint y código WSL limpiados. Claves efímeras del Chromebook eliminadas. Los archivos fuente temporales en Windows fueron eliminados y se cerró la sesión de mantenimiento WSL.
- Suite Python actual **58/58 PASS**; pruebas focales Node de testigo y túnel **17/17 PASS**. No se ha repetido la suite Node completa de 369 casos en esta fase, puesto que no hay cambios de código productivo.
- **Pendiente imprescindible:** aislar la latencia/semántica del POST firmado con instrumentación segura y reproducible en un laboratorio autorizado; validar arranque, publicación inicial y reconciliación sin ampliar plazos ni reenvío ciego; repetir después la misión Fabric+Cobblemon con el testigo físico, pérdida de ruta, cofre vacío, cancelación durable y recuperación sin replay. Solo entonces marcar la fase como PASS.

**Esta nota documenta un resultado negativo verificable, no un cierre funcional de la integración remota.**
