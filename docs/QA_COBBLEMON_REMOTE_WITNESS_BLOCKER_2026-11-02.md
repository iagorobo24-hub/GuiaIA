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

## Continuación: preflight seguro y trazabilidad (2026-11-02)

Se añadió el programa **únicamente QA** `companion/qa_physical_witness_preflight.js`, activado solo mediante `--qa-readonly-preflight` y un directorio privado `guiaia-crosshost-fabric-qa-*` verificado. Antes de iniciar los clientes del ensayo «physical-witness-outage», el runner efectúa **hasta seis consultas GET de solo lectura** a `127.0.0.1:24121/checkpoint` con nonces UUID nuevos. **Solo** una respuesta HTTP `403` (head todavía sin inicializar) puede contar como sonda válida; para avanzar exige **tres respuestas consecutivas inferiores a 750 ms**. Cada consulta tiene un límite de **3 segundos exclusivamente de diagnóstico** para no confundir arranque en frío con autorización. Ese límite **no cambia** el plazo de **1.500 ms** del cliente de checkpoint, el de **1.250 ms** del proxy HTTPS ni sus validaciones Ed25519/CAS. Si el transporte no se estabiliza, falta el fixture o cambia el estado del testigo, el controlador **rechaza antes del login**.

Pruebas locales: únicamente GET, conteo de arranque lento no aceptado como estable, rechazo de `200`/`302`/`502`, respuesta que nunca llega, parámetros fuera de límite y fixture inseguro; **5/5 PASS**. Este preflight puede descartar una parte de los fallos de calentamiento pero **no garantiza** que el POST firmado se complete, y tampoco verifica por sí mismo la identidad del testigo: las firmas originales y el TLS autenticado siguen siendo imprescindibles.

Se añadió además trazabilidad **opcional** al proxy físico, activada solo con `GUIAIA_QA_TRANSPORT_DIAGNOSTICS=1`: método GET/POST, etapa (cabeceras/respuesta terminada/timeout/error), estado HTTP y tiempo redondeado. Nunca registra URL, cuerpo, firmas, claves, UUID, cabeceras o datos del jugador. Su objetivo es distinguir retraso TCP/TLS de respuesta HTTP incompleta sin alterar las decisiones de autorización.

**Resultado de esta continuación:** avance local de diagnóstico/infraestructura; la misión con testigo físico Durán **sigue pendiente** hasta una nueva ejecución end-to-end con prueba POST Ed25519 completa y el ensayo fail-closed de Cobblemon.
