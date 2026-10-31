# GuiaIA — testigo QA en proceso independiente

Fecha: 31/10/2026.

## Objetivo

Separar el testigo del runtime del operador, manteniendo la clave privada Ed25519 del testigo en un proceso independiente y aceptando únicamente avances de checkpoint con firma del operador aprobado.

La nueva entrada `companion/qa_witness.js` inicia el componente ya existente `createQaCheckpointWitness` sin ejecutar código Minecraft, usar Mineflayer ni necesitar dependencias de terceros. Solo escucha en 127.0.0.1. No abre un puerto público ni implementa TLS.

## Contrato

`node companion/qa_witness.js --qa-serve RUTA_CONFIG_PRIVADA`

El fichero JSON privado incluye exactamente `version=1`, `sandboxOnly=true`, `worldId`, `directory`, `operatorPublicKeyFile` y `witnessPrivateKeyFile`. Debe estar bajo una carpeta privada `/tmp/guiaia-witness-config-qa-*`; sus archivos son 0600 y la carpeta 0700. Los archivos de estado del testigo quedan en un `/tmp/guiaia-remote-anchor-qa-*` propio, fuera de la carpeta del operador. El proceso del testigo recibe **solo** la clave pública del operador y la **privada del testigo**, nunca la clave privada de revocación del operador ni la clave privada del propietario.

Cuando arranca correctamente, emite `qa_witness_ready` con URL local y mundo QA; un fallo termina con código 2 sin imprimir secretos ni rutas privadas. SIGTERM/SIGINT detiene el listener y libera el lock; si cae inesperadamente, un lock obsoleto debe revisarse antes de permitir reinicio.

El protocolo vigente `/checkpoint` y `/advance` verifica firma Ed25519, fingerprint, desafío, vigencia, secuencia creciente y CAS sobre el hash anterior. Un nuevo proceso puede reabrir el mismo estado **solo si existe el head firmado**; no se rebootstrappea silenciosamente el almacenamiento perdido.

## Evidencia verificada

Pruebas `companion/test/qa_witness_standalone.test.js`:

- Nuevo proceso Node, creación del head firmado, avance a secuencia 1, cierre y reinicio con el mismo estado.
- Rechazo de firma falsa, intento de retroceso y cliente que fija una clave pública de testigo incorrecta.
- Bloqueo exclusivo durante ejecución concurrente; rechazo de inicio si falta un head previamente usado.
- Rechazo de fichero con permisos demasiado amplios, configuración con campos adicionales, mundo no QA y enlace simbólico.

El ensayo `qa_standalone_operator_real_fabric.js` admite `GUIAIA_QA_STANDALONE_WITNESS=1` para probar en Fabric real que el testigo vive en un proceso aparte. Este modo de prueba **no significa un ordenador aparte**: el firmante y el testigo todavía se provisionan sintéticamente en el mismo Chromebook de laboratorio.

## Bloqueos y límites

No se ha realizado prueba en Durán ni Portatiltek: ambos equipos figuran desconectados. Para una prueba entre hosts, cada lado debe usar su propia configuración y almacenamiento; el testigo debe seguir vinculado a su loopback, y cualquier acceso entre equipos debe ir por un túnel cifrado explícitamente autorizado (p. ej., SSH forwarding). No se deben exponer los endpoints HTTP sin autenticar a una LAN ni internet. El uso de un túnel remoto todavía no está probado.

Esto tampoco demuestra autenticación oficial Microsoft, resistencia a un host físico comprometido, anti-rollback frente a un administrador del almacén del testigo, instalación limpia en otro ordenador ni compatibilidad Cobblemon. Continúa siendo una herramienta QA, no una beta.

## Validación adicional con Minecraft Fabric real — PASS

En el Chromebook se ejecutó el runner real `--standalone-operator` con `GUIAIA_QA_STANDALONE_WITNESS=1`. Se observó `qa_witness.js` activo en un proceso Node distinto del `qa_operator.js`, con su propio fichero de clave Ed25519 privada y configuración 0600, y el testigo solo vinculado a 127.0.0.1.

La prueba terminó con **código 0** y marcador `GUIAIA_STANDALONE_OPERATOR_REAL_FABRIC_QA_EVIDENCE` incluyendo `standalone_witness_process=true`, un roble depositado físicamente, **1 recibo de recolección y 1 de depósito**, 2 nonces consumidos, revocación Ed25519 durable, secuencia de testigo 2, rechazo de nuevo preflight con código 2, y cofre y diarios inalterados tras el rechazo.

La JVM de laboratorio, el operador y el testigo se apagaron limpiamente, y los puertos locales 25593/25594 quedaron libres. Log local: `/tmp/guiaia-separate-witness-real-fabric-20261031.log`.

Esta evidencia corresponde a **procesos separados en el mismo Chromebook**, no a dos hosts físicos. Los archivos de firma del testigo fueron provisionados por el controlador QA que generó las autoridades sintéticas: no es una demostración de aislamiento físico de secretos ni de producción multijugador.
