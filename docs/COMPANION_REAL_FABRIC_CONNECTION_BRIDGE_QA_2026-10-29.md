# GuiaIA — atestación real de conexiones Fabric 1.21.1 (2026-10-29)

**Estado: puente servidor real de JOIN/DISCONNECT verificado en Minecraft desechable. NO es autenticación del jugador y NO está desplegado.**

Rama: feature/fabric-connection-attestation-qa. Separada de Teselia y main.

## Implementación

El mod aislado fabric-observer incluye la entrada GuiaIdentityBridge, independiente del observador de bloques y **desactivada por defecto**. Solo se activa con configuración habilitada y qa_only=true en directorios temporales de QA autorizados. Nunca abre puertos de administración, ejecuta órdenes, cambia bloques o modifica inventarios.

Usa ServerPlayConnectionEvents.JOIN y DISCONNECT: vincula la conexión con el objeto de red del servidor, no con el nombre ni con el UUID offline. Cada conexión obtiene UUIDv4 y desafío nuevo de 24 bytes. Los eventos se firman con Ed25519 en el servidor. La clave privada PKCS#8 se suministra desde fuera del repositorio, con permisos 0600 obligatorios. El log se guarda con permisos 0600 en carpeta 0700, tamaño limitado y sincronización de disco. Tras reiniciar se borra el log temporal anterior. Si falta configuración, permiso o clave válida, no se activa.

El nuevo companion/src/fabric_bridge_reader.js consume evidencias con una **clave pública fijada por separado**, comprueba cada firma y audiencia, la secuencia de JOIN/DISCONNECT, el ámbito, el límite temporal y los permisos de archivo. Rechaza falsificaciones, archivos truncados, enlaces simbólicos, eventos duplicados o incompatibles. El verificador de sesiones ahora solicita el ID específico de conexión.

## Evidencia

[GitHub Actions 40881777326](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40881777326) — **SUCCESS**: dos conexiones auténticas de Minecraft 1.21.1 con el mismo nombre offline, dos JOIN y dos DISCONNECT firmados por el servidor real; IDs y desafíos distintos; ninguna sesión permanece activa tras desconectarse. Firma o datos manipulados rechazados. Sin configuración no se crearon eventos. Tras reiniciar el servidor habilitado y sin jugadores, no quedó una sesión antigua.

Ocho pruebas unitarias del lector de eventos pasaron localmente. La segunda CI integra el lector en la verificación del registro real. Todos los secretos y mundos utilizados en las pruebas son temporales y no forman parte del repositorio.

## Riesgos pendientes antes de producción

1. **No autentica todavía al jugador offline.** La firma del servidor demuestra la conexión, no la titularidad del nombre. Falta enrolamiento seguro de una clave personal por canal independiente y respuesta firmada al desafío del servidor.
2. **No sustituye una consulta de presencia en vivo.** Si falla la escritura de DISCONNECT o el servidor se detiene inesperadamente, el log puede quedar atrasado. Una caducidad de 45 segundos limita, pero no elimina ese riesgo. Este lector solo es válido en QA, no constituye autorización de producción.
3. **No hay una puerta global obligatoria** para todas las acciones ni rotación de claves, sesiones multijugador definitivas, claims o permisos de cofres. Las funciones antiguas de QA permanecen internas.
4. **No se ha instalado en Teselia ni validado con Cobblemon**, ni se han realizado pruebas de corte eléctrico durante una transacción real.

Siguiente fase: enrolamiento de jugadores no premium por un canal confiable, comprobación firmada y fresca de sesiones activas dentro de Fabric y enlace de esa prueba al único punto autorizado de operaciones. No activar aún el bot para amigos.
