# GuiaIA — revocación externa durante QA

Fecha: 31/10/2026. Este desarrollo está restringido a Fabric 1.21.1 en un mundo de prueba local. No autentica cuentas oficiales Minecraft ni implementa una autoridad de producción.

El registro mantiene un bloqueo de escritura exclusivo. Un segundo proceso puede entregar una solicitud Ed25519 y un avance de checkpoint firmado mediante una bandeja local de un solo uso, sin adquirir ese bloqueo.

El operador verifica las firmas y el estado previsto, detiene las acciones antes de aplicar la revocación, actualiza el registro y exige confirmación del testigo. Los errores bloquean operaciones y conservan la solicitud para revisión; no hay reintento automático.

Archivos relevantes: `companion/src/qa_live_revocation.js`, `companion/qa_revoke.js` y `companion/qa_operator.js`.

Pendiente: validar la cancelación física de una misión en Fabric real, la continuidad de los tests y el cierre de Git. El testigo continúa en loopback.

## Verificación con JVM Fabric real — PASS

El 31/10/2026 se probó `scripts/qa_signed_delivery_real_server.py --standalone-live-revocation` con un mundo temporal, Fabric 1.21.1, dos clientes Mineflayer y el observador Java firmado.

Se completó primero una recolección física de roble. Mientras `qa_operator.js` conservaba el lock exclusivo del registro, un **segundo proceso Node** ejecutó `qa_revoke.js` con su clave firmante independiente. El operador aplicó la revocación, detuvo la misión y publicó el checkpoint del testigo en secuencia **2**.

Resultado observado: **1 recibo de recolección, 0 de depósito, 1 nonce consumido, cofre real con 0 robles, depósito duraderamente cancelado y nueva orden rechazada**. La terminal cerró con código 0; el runner completo terminó con código **0**. Ninguna acción se ejecutó en Teselia.

Log comprobable en el Chromebook: `/tmp/guiaia-hot-external-revocation-real-fabric-20261031.log`. El marcador es `GUIAIA_STANDALONE_OPERATOR_LIVE_REVOCATION_QA_EVIDENCE`.

Para el envío independiente se usa `node companion/qa_revoke.js --qa-submit <configuracion-privada>`. La configuración contiene `version`, `sandboxOnly`, `worldId`, `registryDirectory`, `principalId` y `operatorPrivateKeyFile`; todos los secretos permanecen fuera del repositorio. El operador solo posee la clave pública. La bandeja acepta una revocación por sesión y conserva los fallos para revisión manual.

**Limitaciones:** esto comprueba revocación entre pasos, no anulación retroactiva de paquetes ya enviados ni revocación durante la transferencia física exacta. El servidor usa offline-mode, testigo loopback e identidades sintéticas; no debe interpretarse como autenticación oficial, prueba entre hosts ni beta pública.
