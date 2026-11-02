# GuiaIA — caída y recuperación del testigo en Fabric real (QA)

**Fecha:** 2026-11-02. **Base:** commit `06e56e1`, rama `main`. **Alcance:** misión en Minecraft Fabric 1.21.1 **desechable**, cuentas sintéticas offline, servidor y autoridades vinculados a loopback del Chromebook. Sin conexión al mundo Teselia ni a un testigo remoto físico.

## Escenario nuevo

El runner `scripts/qa_signed_delivery_real_server.py --standalone-witness-outage` activa `GUIAIA_QA_WITNESS_OUTAGE=1` y `GUIAIA_QA_STANDALONE_WITNESS=1` exclusivamente para su proceso hijo. Preparó un mundo temporal, una sesión firmada Ed25519 y dos permisos de un solo uso, con `qa_witness.js` ejecutándose en un proceso Node independiente. El operador interactuó desde una terminal real.

Secuencia comprobada:

1. El bot recogió físicamente un tronco de roble; quedó un recibo de recolección duradero.
2. Se cerró correctamente **solo el testigo QA** antes del siguiente paso y se comprobó que el cliente rechazaba la verificación del head.
3. El operador intentó el depósito. El resultado fue `authorization_unavailable`: cero transferencias y cero recibos de depósito; diario e inventario del cofre intactos; solo un nonce consumido.
4. El operador se cerró y persistió la cancelación del depósito, sin ejecución automática posterior.
5. El mismo testigo sintético se reinició con su almacenamiento firmado anterior (secuencia 1). La verificación del head y el nuevo `--qa-preflight` terminaron correctamente (código 0) usando la nueva URL local, **sin reanudar una acción mutadora**.
6. El controlador comprobó el marcador completo y salió con código **0**. La JVM temporal y los procesos QA finalizaron; el directorio del mundo desechable se retiró.

Marcadores principales: `real_fabric=true`, `real_gather_receipts=1`, `real_deposit_receipts=0`, `physical_chest_oak_log=0`, `witness_disconnection_denied=true`, `deposit_authorization_denied=true`, `journals_unchanged_during_outage=true`, `spent_nonces=1`, `durable_deposit_cancellation=true`, `persisted_signed_sequence=1`, `restarted_witness_verified=true`, `recovery_preflight_exit=0`, `no_automatic_world_action_replay=true`.

## Reproducción y límites

Ejecutar únicamente en un laboratorio autorizado, con Node >=22, Python >=3.11, Java 21, Fabric 1.21.1 y el mod de observación compilado. El lanzador de laboratorio requiere `--launcher`, `--fabric-api`, `--mod`; verifica que los puertos locales 25593/25594 estén libres y genera un mundo temporal independiente. El ensayo utilizó un JAR del módulo previamente compilado en el Chromebook (SHA-256: `3db9091b7bcbe768b4dddfed503b1985ccc3bc1ecef4bfbbbae31583d49973b6`); **no supone un build del mod a partir de código actual**. El arranque necesitó cargar/reconstruir dependencias Fabric y registró inicialmente timeouts de Maven, sin invalidar el resultado final.

**No demuestra** caída de un enlace HTTPS entre Chromebook y Durán durante una misión, autenticación Microsoft/online-mode, presencia de Cobblemon, reinicio del proceso del operador con reanudación aprobada, ni despliegue permanente. En especial, la recuperación de identidad no implica reejecutar automáticamente acciones físicas inconclusas.

**Regresión posterior:** Node `npm test` **366/366 PASS**, sin omitidas (código 0); Python `PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -q` **58/58 PASS**. La prueba end-to-end de Fabric terminó con **código 0**. No se ha lanzado GitHub Actions ni una verificación Windows de este nuevo escenario.

**Próximo paso:** ensayar la misma barrera con testigo remoto real y Fabric aislado, autenticación oficial y Cobblemon, conservando aislamiento del mundo, permisos explícitos y protección de claves.
