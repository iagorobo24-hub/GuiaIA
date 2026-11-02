# GuiaIA — validación de testigo firmado entre Chromebook y Durán

**Fecha:** 2026-11-02. **Ámbito:** laboratorio QA entre dos ordenadores físicos, sin cuentas online-mode, sin mundo Minecraft y sin modificación de Teselia.

## Diagnóstico técnico del bloqueo

La instancia Linux del Chromebook ejecuta Tailscale sin interfaz de red de kernel `tailscale0` ni rutas del tailnet en su tabla principal. `tailscale ping 100.65.89.114` respondía, pero `curl` directo a 100.65.89.114:443 usaba el gateway ordinario y agotaba el tiempo. La solución QA fue un único puente local:

```bash
socat TCP-LISTEN:24119,bind=127.0.0.1,reuseaddr,fork \
  EXEC:'tailscale nc 100.65.89.114 443',pipes
```

Esto dirige las conexiones de prueba **a través del daemon Tailscale**, no por la ruta del kernel. No se añadieron rutas, reglas firewall, privilegios, servicios permanentes ni acceso público.

Durán utilizó Tailscale Serve con `--bg --https=443 http://127.0.0.1:24667`, **solo en el tailnet y sin Funnel**. El backend fue un adaptador HTTP vinculado exclusivamente a loopback, ubicado en Ubuntu WSL2, que tradujo el encabezado Host al exigido por el testigo `qa_witness.js` en su propio loopback. El adaptador no manejó claves. El cliente del Chromebook utilizó TLS hacia el nombre DNS de Durán, con `servername` y `rejectUnauthorized:true`, y validación adicional mediante `curl --connect-to` sin omitir la comprobación de certificado. Resultado inicial: **HTTP 403 esperado** para un nonce inválido y **`ssl_verify_result=0`**.

## Independencia de autoridades

- Chromebook: clave privada **Ed25519 del operador**, creada en una carpeta temporal privada `/tmp/guiaia-crosshost-operator-qa-*`. Se transfirió solamente la pública a la configuración del testigo.
- Durán: clave privada **Ed25519 del testigo**, generada dentro de Ubuntu WSL2 en `/tmp/guiaia-witness-config-qa-*`, con permisos POSIX de directorio 0700 y fichero 0600. El Chromebook recibió únicamente la pública y fijó la huella SHA-256 del certificado de clave DER: `76198f13695f4a91627cc96004f2970e4668fe9bab67105bde2423aa378ff3a5`.
- Huella SHA-256 de la clave pública del operador: `01db518667014fb4820ecb5bbd212628f12a8f519e3d5f511eeacae13fbebb7b`.
- Mundo: `qa:cross-host:20261102`. Solo estados sintéticos; ningún principal real ni servidor productivo.

El proceso independiente real de Durán ejecutó `companion/qa_witness.js`; el Chromebook utilizó el componente existente `createPinnedQaRemoteCheckpointClient`, cuyo endpoint HTTP quedó fijado al **puerto local** de un proxy de laboratorio. Ese proxy abrió HTTPS hacia Durán a través de un segundo puerto local `socat`, manteniendo la verificación del certificado y la firma Ed25519 de cada respuesta. Ningún componente confiaba en un estado remoto por mera conectividad.

## Pruebas observadas

| Prueba | Resultado |
| --- | --- |
| TLS entre ambos equipos con validación de certificado | PASS, `ssl_verify_result=0` |
| Arranque del witness físico con clave privada solo en Durán WSL2 | PASS |
| Bootstrap firmado del checkpoint secuencia 0 | PASS |
| Avance CAS firmado hasta secuencia 1 | PASS |
| Firma de avance falsificada, enviada al testigo | RECHAZADA, HTTP 403 |
| Clave pública de testigo falsa | RECHAZADA por firma |
| Repetición de un avance anterior | RECHAZADA |
| Verificación de checkpoint local atrasado | RECHAZADA |
| Desactivar Tailscale Serve de Durán e intentar verificar el head | FAIL-CLOSED, resultado de prueba PASS |
| Rehabilitar Tailscale Serve y verificar el head persistido secuencia 1 | PASS |

Marcadores observados:

```text
CROSS_HOST_CRYPTO_EVIDENCE={"result":"pass","phase":"bootstrap","real_two_devices":true,"tls_cert_verified":true,"witness_private_key_only_on_duran":true,"operator_private_key_only_on_chromebook":true,"signed_bootstrap_sequence":0,"signed_advance_sequence":1,"forged_operator_ticket_denied":true,"wrong_witness_key_denied":true,"replay_denied":true,"rollback_disagreement_denied":true}
CROSS_HOST_CRYPTO_EVIDENCE={"result":"pass","phase":"offline","fail_closed_on_disconnection":true}
CROSS_HOST_CRYPTO_EVIDENCE={"result":"pass","phase":"restore","recovered_signed_head_verified":true,"replay_safe_sequence":1}
```

## Limitaciones para la beta

**Se ha validado el protocolo de checkpoint firmado entre dos ordenadores, no una sesión Minecraft remota.** Se utilizó un adaptador temporal local y un reenvío HTTPS transportado por `tailscale nc`; no hay todavía un lanzador reproducible de producción ni una instalación permanente del testigo. No se ha validado un reinicio del proceso del testigo en este ensayo (sí existían pruebas de reinicio del testigo local en fases previas), ni se ha sometido la conexión a ataques de red adicionales, cambios de políticas del tailnet o failover entre hosts. Las identidades son sintéticas y las claves se destruyen tras la fase.

El siguiente trabajo antes de una beta controlada incluye: mecanismo de operación segura del witness en segundo host, integración completa con una sesión Fabric/Cobblemon real, autenticación Microsoft oficial online-mode y pruebas de usuario con permisos explícitos. Este ensayo no sustituye esas validaciones.

**Criterio de limpieza:** desactivar Tailscale Serve exclusivamente en Durán, cerrar los procesos `socat`, el testigo y su adaptador, eliminar claves, repositorios temporales y archivos de transferencia de esta fase. No alterar la configuración Tailscale Serve preexistente del Chromebook, la producción Teselia ni los archivos ajenos preservados de la bandeja Tailscale.
