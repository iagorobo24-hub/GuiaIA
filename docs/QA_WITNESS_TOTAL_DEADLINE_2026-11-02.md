# GuiaIA — límite temporal absoluto del checkpoint remoto (QA)

**Fecha:** 2026-11-02. **Rama y base inspeccionadas:** `main`, HEAD inicial `7762519`. **Ámbito:** cliente HTTP de checkpoint y servidor testigo de laboratorio; no cambia la autenticación, el transporte Tailscale, ni el mundo Minecraft.

## Problema reproducido

Los límites `setTimeout(1500)` existentes medían inactividad del socket, no duración total de una autorización. Un intermediario que entregara o recibiera un byte cada 150 ms mantenía abierta la solicitud mientras no se alcanzaran los límites de tamaño. Dos pruebas nuevas fallaron antes de modificar la implementación: el cliente esperaba aproximadamente 3,44 s y el servidor 3,64 s, superiores a 2,7 s de aceptación; el cliente terminó rechazando JSON incompleto, no un plazo real.

## Cambio aplicado

- `companion/src/remote_checkpoint.js`: una segunda barrera independiente limita a **1500 ms totales** las solicitudes `latest`, `verifyLocal` y `publish`. En caso de vencer el plazo, se destruye la solicitud y falla cerrada. El temporizador se cancela al cerrar la solicitud.
- `companion/src/qa_checkpoint_witness.js`: cada petición del testigo dispone de **1500 ms totales** hasta el cierre de la respuesta. Una solicitud POST incompleta que envía datos lentamente se desconecta; no se crea ningún checkpoint. El testigo continúa vinculado solo a 127.0.0.1.
- Pruebas negativas: `companion/test/remote_checkpoint.test.js` y `companion/test/qa_witness_standalone.test.js`. Se utiliza un servidor falso y una raíz privada desechable; el mundo real no interviene.

## Evidencia observada

Las 14/14 pruebas focales pasaron con la corrección. La petición lenta al cliente se cortó en ~1,52 s y la petición incompleta al testigo se cortó en ~1,81 s, incluyendo el tiempo de creación y cierre del proceso de prueba. Regresión Python `PYTHONPATH=src python3 -m unittest discover -s tests -p 'test_*.py' -q`: **58/58 PASS**. Regresión Node `npm test`: **366/366 PASS**, sin saltos, código de salida 0 (84,8 s).

## Limitaciones y siguiente paso

No se ha ejecutado una nueva misión Minecraft contra Durán con este commit. La prueba física HTTPS/Ed25519 anterior está documentada en `QA_SIGNED_WITNESS_PHYSICAL_HOST_2026-11-02.md`, pero precede a esta corrección. Un enlace de red legítimamente lento también se rechazará por diseño (fail-closed); antes de una beta real corresponde observar los tiempos y definir una política explícita de latencia, sin eliminar el límite absoluto.

**Pendiente de validación adicional:** conexión remota y reinicio de testigo dentro de una misión Fabric QA, autenticación Minecraft online-mode y prueba aislada con Cobblemon. No tocar Teselia ni exponer HTTP en una interfaz externa.
