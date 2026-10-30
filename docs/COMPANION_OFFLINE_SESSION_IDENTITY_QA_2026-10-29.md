# GuiaIA — Identidad de sesión para servidores Minecraft offline (29-10-2026)

**Estado: contrato de identidad y autorización por sesión verificado en QA. La autenticación real de jugadores offline SIGUE PENDIENTE. No desplegar.**

Rama: feature/companion-offline-session-identity-qa. Desarrollada de forma independiente; sin fusionar main, modificar Teselia o conectar chat/IA.

## Qué implementa

En online-mode=false el nombre o UUID offline no demuestra quién está conectado. La nueva pasarela companion/src/session_identity.js exige TRES pruebas Ed25519 independientes para cada depósito:

1. **Puente confiable del servidor**: conexión observada desde el servidor, mundo, conexión aleatoria, etiqueta del jugador, desafío y caducidad. Requiere comprobar que la conexión exacta SIGUE activa mediante una autoridad independiente del cliente.
2. **Jugador previamente inscrito**: prueba de posesión de la clave que el operador registró previamente, firmando la misma conexión y desafío. La clave de un usuario no se acepta de una petición nueva.
3. **Operador confiable**: permiso firmado restringido a esa identidad y sesión, a un cofre concreto, un material, una cantidad y un nonce de un solo uso.

Se utilizan audiencias diferentes, claves públicas fijadas, tiempo de vida breve, rechazo de sesiones revocadas, y nueva verificación en el instante del despacho. Se reserva el nonce antes de modificar el mundo. Se copia la configuración firmada para impedir modificaciones posteriores.

El nuevo createQaSessionActionGateway solo expone createDeposit; no proporciona ejecutar comandos arbitrarios, minería o chat. **No equivale a un control global:** los adaptadores históricos se mantienen disponibles para pruebas y el CLI admite órdenes locales por stdin. Ninguno debe publicarse como interfaz para jugadores.

## Evidencia reproducible

- 20 pruebas dirigidas de identidad: firma falsa, clave desconocida, sesión con mismo nombre y distinta conexión, desafíos cruzados, usuario revocado, sesión desconectada, caducidad tras preparar una operación, permiso para otro mundo/material/cofre, reutilización simultánea de nonce, mutación de claims, ausencia del puente y sustitución de claves/callbacks.
- Minecraft Java 1.21.1 real: [GitHub Actions 40878801233](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40878801233), **SUCCESS**. Denegados: operación sin atestación del puente, mismo nombre sobre otra conexión, cofre alterado e identidad revocada. Aceptados: dos depósitos independientes firmados; inventario final bot roble/abedul 0/0, cofre reabierto 1/1, dos recibos duraderos, sin repetición.
- El servidor y los movimientos de inventario SÍ son reales. **Los firmantes del puente y del usuario son sintéticos y efímeros, creados por el propio laboratorio**; el servidor Fabric real aún no emite esas atestaciones. No se ha demostrado identificación de amigos en un mundo offline real.

## Bloqueos antes de usarlo en Teselia

1. Construir en Fabric o en un proxy de confianza el **puente servidor real**, capaz de observar conexiones/desconexiones, emitir desafíos, vincular la entidad exacta a un ID de conexión y emitir pruebas firmadas desde claves protegidas.
2. Crear un proceso real de inscripción para amigos no premium mediante un canal independiente autenticado, con prueba de posesión de claves, recuperación de cuenta, revocación, protección contra retransmisión y sin depender del nombre.
3. Hacer obligatorio el verificador en el único punto de entrada de todas las acciones con efectos en el mundo. El uso directo de adaptadores QA no puede quedar expuesto en una API pública.
4. Proteger/rotar las claves, mantener permisos de cofres/claims, controlar recursos y tasas, y ensayar la compatibilidad real con Cobblemon.
5. Probar la caída del servidor **durante** una transferencia o escritura, no solo caída del cliente y reinicio después de guardar.

**Cierre:** identidad por sesión verificable en laboratorio, no autoridad Fabric ni enrolamiento multiplayer real. Mantener la rama aislada y la integración en Teselia desactivada.
