# GuiaIA — cierre de bypass de seguimiento en el ejecutable de QA

Fecha: 2026-10-29. Repositorio local aislado, rama feature/principal-enrollment-qa.
No es un despliegue en Teselia. No equivale a autenticación de jugadores reales.

## Hallazgo confirmado

El único comando ejecutable publicado por npm start era src/cli.js --qa-local-only.
El proceso aceptaba una orden de texto follow por stdin, configurando al
propietario solo por un nombre Minecraft offline. Esta orden no aportaba un
comprobante firmado de la conexión ni prueba del consentimiento de la persona
ni consulta al testigo externo de revocaciones.

Aunque el proceso está restringido al loopback del laboratorio, la operación
follow era una vía no autorizada de movimiento. Se ha eliminado esta vía en
el ejecutable, sin convertir un nickname en una identidad fiable.

## Corrección aplicada

- El ejecutable solo admite comandos de observación o parada: status, stop y
  quit. La orden follow se rechaza siempre con motivo
  signed_session_authorization_required, antes de invocar el controlador.
- Los comandos de parada de emergencia y salida funcionan también sin
  iniciar el controlador y no requieren prueba criptográfica.
- Las pruebas de política de imports del entrypoint verifican el grafo de
  módulos del CLI. Solo puede alcanzar cli.js, controller.js y
  qa_runtime_commands.js. Cualquier dependencia nueva requiere actualizar
  deliberadamente esta lista en la revisión de código.
- No se cambian las pruebas de seguimiento reales del laboratorio, que
  llaman explícitamente al controlador de movimiento con un servidor
  Minecraft desechable. Son pruebas, no una ruta autorizada del ejecutable.
- Se añade createQaStrictSessionActionGateway: la nueva interfaz de QA para
  depósitos exige tanto requireLivePresence=true como
  requireRemoteCheckpoint=true, y callbacks verificables antes de despachar.
  El adaptador QA heredado conserva su contrato para los ensayos existentes.
- Se han añadido pruebas negativas del nuevo gateway: controles ausentes,
  modificación posterior de la configuración, testigo discordante, rechazo
  sin apertura de cofre y sin reserva de nonce.

## Qué se ha validado y qué no

La batería Node prueba el ejecutor de comandos por unidades y comprueba
estáticamente el grafo de dependencias del ejecutable. La prueba del gateway
usa firmas reales Ed25519 sobre datos sintéticos y callbacks de laboratorio.

No se ha completado una ejecución end-to-end del CLI con Minecraft real tras
esta restricción, ni un seguimiento habilitado por autorización completa.
Tampoco se ha autenticado ningún jugador offline real, ni se ha desplegado
un testigo independiente de Penguin. Cualquier código del mismo proceso
que pueda importar directamente los módulos de QA puede invocar los
adaptadores experimentales; el grafo auditado aplica a npm start, no a todos
los posibles scripts de laboratorio ni a quien controla el código.

La creación de movimientos firmados deberá implementar su propia autorización
específica para la acción, límite de duración y revocación durante seguimiento,
y verificarse en un mundo desechable antes de introducirla en el CLI.

## Pruebas y alcance del cierre

- qa_runtime_commands.test.js: comando follow denegado, entradas no exactas,
  observación, parada y salida disponibles.
- qa_runtime_surface.test.js: grafo de dependencias e identidad del ejecutable.
- session_identity.test.js: gateway estricto con presencia y testigo
  independientes, sin reconfiguración después de construcción.
- La regresión final y los resultados se guardan en el archivo de evidencia
  PRINCIPAL_RUNTIME_SURFACE_QA_2026-10-29.json.
- Sin cambios de mundo real, Git remoto, otras ramas, PR o despliegue.

## Siguientes puertas de producción

1. Diseñar y validar un contrato de autorización para movimiento sostenido con
   revalidación y límite de duración; no reactivar follow desde stdin.
2. Aislar todos los adaptadores históricos solo para QA y decidir su
   ciclo de vida tras migrar ensayos al gateway estricto.
3. Mover el testigo a almacenamiento y dominio de confianza realmente
   separados. Actualmente un atacante con control de Penguin puede
   restaurar también el estado del testigo.
4. Probar el circuito completo en servidor Fabric desechable, luego
   probar identities reales/claims/compatibilidad Cobblemon antes de Teselia.
