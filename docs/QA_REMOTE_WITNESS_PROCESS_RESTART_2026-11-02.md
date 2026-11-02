# GuiaIA — reinicio real del testigo en otro ordenador, con pérdida de enlace

**Fecha:** 2026-11-02. **Repositorio base:** `main` en `a323849`. **Ámbito:** laboratorio criptográfico sintético en dos equipos físicos, **sin mundo Minecraft, sin cuentas Microsoft, sin cambios en Teselia y sin servicio permanente**.

## Separación de autoridades y transporte

- **Chromebook:** clave privada Ed25519 del operador en un directorio privado temporal (0700, fichero 0600). Solo su clave pública se envió a Durán. Huella SHA-256 SPKI del operador: `a944572d1925809cba788a2b049b0ae55ca6f833a386ea19ff946b5d677541d1`.
- **Durán, Ubuntu WSL2:** clave privada Ed25519 del testigo generada localmente, almacenada solo bajo un directorio temporal 0700/0600, con un `qa_witness.js` separado. Solo la clave pública del testigo se envió al Chromebook. Huella SHA-256 SPKI: `cd8419abeeb6cd9999a55f8cd92fc46a09610c94aabb42ea59bc3593d21883f2`.
- Código transferido a Durán: tar.gz mínimo (`qa_witness.js`, `remote_checkpoint.js`, `qa_checkpoint_witness.js`), SHA-256 `e531e2c37518e071661c0ec34285066c983ef5f9f88691a09d2fcd77f72760a8`. Se verificó la coincidencia en ambos equipos. No se transfirió material privado.
- Transporte: testigo HTTP vinculado a `127.0.0.1` dentro de WSL2, adaptador HTTP local de laboratorio para reescribir `Host`, y Tailscale Serve **HTTPS exclusivo del tailnet** en Durán (443, sin Funnel). El Chromebook utilizó `socat` + `tailscale nc` en espacio de usuario y un cliente HTTPS Node con SNI `durn.taild703f5.ts.net` y `rejectUnauthorized: true`. La validación externa con `curl --connect-to` arrojó `HTTP=403 TLS_VERIFY=0` antes del bootstrap, rechazo esperado de un checkpoint aún vacío.
- Identificador de mundo sintético: `qa:crosshost:restart:20261102`. No se utilizó un servidor Minecraft real.

## Evidencias observadas

| Escenario | Resultado |
| --- | --- |
| TLS de Durán y verificación de certificado | PASS |
| Testigo real en Durán y operador criptográfico en Chromebook | PASS |
| Bootstrap firmado, secuencia 0, y avance CAS firmado, secuencia 1 | PASS |
| Firma del operador falsificada y clave pública testigo errónea | RECHAZADAS |
| Reutilización de un avance anterior y checkpoint local atrasado | RECHAZADOS |
| Desactivar únicamente el Serve temporal en Durán y verificar el head | FAIL-CLOSED, PASS, 1566 ms |
| SIGTERM al proceso de testigo; comprobar lock liberado y head firmado persistido | PASS |
| Reiniciar `qa_witness.js` con el mismo estado, sin regenerar clave | PASS |
| Restablecer transporte HTTPS y verificar secuencia 1 | PASS |
| Intentar repetir el avance anterior tras el reinicio | RECHAZADO |

Marcadores: `PHYSICAL_WITNESS_EVIDENCE` de fases `bootstrap`, `offline` y `restore`, todos `result=pass`, con `tls_cert_verified=true` en las fases conectadas. El cliente de checkpoint utilizado es el del repositorio; la conexión HTTPS utilizó adaptadores desechables **no integrados en el producto**. Comprobación posterior sin dependencias externas: Node, **14/14 pruebas focales del testigo PASS**; Python, **58/58 unit tests PASS**. No se ha vuelto a ejecutar la suite Node completa de 366 casos ni las pruebas reales Fabric durante esta fase.

## Limpieza y límites

Al terminar, se desactivó Tailscale Serve en Durán y se verificó `No serve config`. Se detuvieron los procesos testigo, adaptador y puente `socat`, se verificó la liberación del lock, se eliminaron las carpetas temporales y claves sintéticas de ambos ordenadores, se detuvo el `sleep` dedicado a mantener WSL2 activo y se comprobó que los puertos temporales del Chromebook estaban libres. Los archivos ajenos al laboratorio y Teselia no se tocaron.

**Límite decisivo:** se ha validado **reinicio del proceso del testigo físico y pérdida del transporte**, no reinicio de Windows/WSL2 ni reanudación de una misión Fabric remota. En WSL2, `/tmp` puede borrarse al apagarse la distribución: un despliegue persistente deberá usar un almacén privado respaldado, con política de permisos y recuperación propia. El código actual del testigo limita deliberadamente su almacenamiento a directorios QA desechables y **no debe cambiarse para producción solo para pasar esta prueba**.

**Pendiente para beta:** integrar el testigo alojado en Durán dentro de un operador Fabric aislado con permisos y mundo sintético; comprobar la interrupción del enlace durante el depósito físico; definir persistencia/operación segura independiente, autenticación Minecraft online-mode y compatibilidad Cobblemon. No confundir esta prueba con una beta disponible.
