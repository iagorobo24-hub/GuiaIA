# GuiaIA — Recuperación verificable de cofres (29-10-2026)

**Fase QA de laboratorio: completada con validación real de reinicios y fallo de cliente. No desplegada en Teselia.**

Repositorio `iagorobo24-hub/GuiaIA`, rama aislada `feature/companion-restart-reconciliation-qa`. Datos, cuentas y mundo de Minecraft creados temporalmente en GitHub Actions, sólo `127.0.0.1`, RCON desactivado, Minecraft Java 1.21.1 y Fabric. No se modificaron los servidores ni el repositorio privados de Teselia.

## Qué se implementó

- `companion/src/recovery.js`: `readDepositJournalPassive` inspecciona los bytes del diario **sin recuperarlo, reescribirlo, tomar bloqueo ni iniciar operaciones**. Rechaza rutas o archivos inseguros y verifica integridad de los recibos.
- `reconcileDepositSnapshot` compara recibos y saldos observados del jugador y cofre en una partida reabierta. Rechaza dueño o cofre incorrectos, datos incompletos, inconsistencias y estados sin confirmar. **Nunca autoriza repetición automática**, ni siquiera si coinciden las cantidades.
- 9 pruebas Node nuevas para lectura pasiva, diarios pendientes, discrepancias, modificación deliberada, entradas no fiables y autorización de operación.
- `qa_chest_restart_server.py` y el cliente read-only arrancan y cierran realmente el mismo mundo, sin destruir su carpeta entre los arranques; se compara el inventario del jugador y del cofre en cada nueva sesión.
- `qa_chest_inflight_server.py` termina **exclusivamente el cliente sintético** entre la transferencia real de un objeto y la escritura duradera del recibo. El servidor guarda el mundo, reinicia y una auditoría pasiva verifica la situación sin intervenir en el cofre ni recuperar el diario. El bloqueo del proceso interrumpido se conserva.

## Evidencia de integración

1. **Reinicio y persistencia**: [GitHub Actions 40859271349](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40859271349), **SUCCESS**.
   - Transferencia real de roble y abedul, inventario del jugador `0/0`, cofre `1/1`.
   - Reinicio normal del servidor y nuevo login: saldos y diario coincidentes.
   - Guardado explícito `save-all flush`, terminación forzada posterior, segundo reinicio: los saldos y recibos sobreviven.
   - Dos auditorías pasivas, ninguna con reintentos.
   - La interrupción forzada se produce **DESPUÉS del guardado**, no durante una transferencia.
2. **Interrupción del cliente justo entre transferencia y recibo**: [GitHub Actions 40860839434](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40860839434), **SUCCESS**.
   - Cliente recibe la confirmación de ambos deltas (`playerAfter=0`, `chestAfter=1`) y termina con código `77` antes de que `runNext` pueda guardar el resultado.
   - Diario real persistido: `phase=transferring`, `receipts=0`, bloqueo residual presente.
   - Tras guardar y reiniciar Minecraft: jugador `oak_log=0`, cofre `oak_log=1`.
   - Auditoría: `manual_review_required`, sin modificar bytes ni eliminar bloqueo, `automatic_replay=false`.
   - La prueba incluye la comprobación de conservación del objeto entre jugador y cofre. Ante pérdida o duplicación, falla.
3. **Batería local**: 66 pruebas Node y 50 Python, todas correctas; CI específica Node y Python también correcta en los commits de implementación. Las regresiones grandes de Fabric se ejecutan por separado en GitHub Actions.

## Hallazgo y decisión técnica

La primera versión del ensayo de caída exigía erróneamente que el mundo hubiese persistido siempre una transferencia después de matar el cliente. Eso es demasiado fuerte: la interfaz de Mineflayer puede reflejar movimientos de ranuras antes de que el estado del servidor esté garantizado. El ensayo se corrigió para registrar lo que **realmente contiene el mundo después del reinicio**, exigir conservación material y prohibir toda repetición cuando falte un recibo; no se alteraron los contratos de seguridad ni se simuló un recibo exitoso.

## Aún fuera de alcance

- **No** se ha demostrado recuperación ante corte eléctrico durante la escritura de jugador, cofre o diario, ni caída del proceso del servidor exactamente entre un click de transferencia y el guardado del mundo. No existe una transacción atómica compartida entre Minecraft y el diario; el bloqueo ante estado incierto es la política correcta.
- El nombre del dueño en el servidor `online-mode=false` del laboratorio **no demuestra identidad segura**. Faltan autenticación de dueño, permisos por cofre, autenticidad de las observaciones, control de acceso de amigos y validación en el modpack Cobblemon.
- No se ha autorizado ningún despliegue, fusión a `main`, acceso a Teselia ni uso de IA generativa para emitir órdenes de minería o almacenamiento.

**Cierre:** esta fase demuestra en un laboratorio Minecraft real persistencia entre reinicios y rechazo de reintentos tras una caída del cliente en el punto crítico. La siguiente fase debe abordar identidad/seguridad y, antes de producción, recuperación ante fallo del servidor durante la transferencia.
