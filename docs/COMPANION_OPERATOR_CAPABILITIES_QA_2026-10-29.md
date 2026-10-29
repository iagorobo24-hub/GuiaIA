# GuiaIA — capacidades de depósito firmadas por operador (2026-10-29)

## Resultado

**Verificado en laboratorio Minecraft Java 1.21.1; no certificado para producción multijugador ni para identificar jugadores en servidores offline.**

Rama `feature/companion-operator-capability-qa`. Sin fusión a `main` ni acceso o despliegue en Teselia.

El objetivo de esta fase es sustituir la confianza en nombres del chat por permisos explícitos que el jugador no pueda generar con solo su nombre. El prototipo mantiene el `ownerName` como etiqueta operativa para comprobaciones de proximidad; **no lo considera una identidad autenticada**.

## Contrato de autorización

`companion/src/operator_authorization.js` valida un permiso firmado con Ed25519 usando una clave pública fijada por un operador confiable, recibida fuera de Minecraft. La clave privada **no debe estar en el bot, el repositorio, el chat ni las respuestas de una IA**. Cada permiso autoriza únicamente una operación:

- Audiencia fija `guiaia:deposit-one:v1`; mundo, bot, nombre de referencia del propietario, cofre con coordenadas exactas, tipo `oak_log` o `birch_log` y cantidad de 1 a 2.
- Caducidad corta (como máximo cinco minutos), emisión dentro de límites, nonce aleatorio UUIDv4, firma digital verificable y validación estricta de campos permitidos.
- Contrato cerrado: no se aceptan órdenes, campos adicionales, otros materiales, cofres o cantidades, ni se puede cambiar el plan después de validar la firma.
- Firma y vigencia revalidadas **inmediatamente antes de ejecutar**. El permiso se consume de forma exclusiva en un directorio privado (`0700`, registros `0600`) y se sincroniza al disco **antes** de llamar al adaptador Mineflayer. La reserva persiste después de una caída del proceso; cualquier repetición queda bloqueada por `O_EXCL`. Un fallo antes de iniciar el depósito puede consumir el permiso y exigir uno nuevo del operador: elección deliberada para evitar duplicaciones.
- La transferencia física conserva los controles anteriores de salud, cercanía y doble prueba de inventario (decremento del jugador y aumento exacto en el cofre). El diario de depósitos sigue bloqueando un resultado ambiguo.

## Pruebas observadas

**Node 22:** 80 pruebas locales correctas, incluyendo 14 sobre el nuevo contrato: firma falsa o alterada, permiso sin firma, clave pública equivocada, mundo y bot diferentes, caducidad, cantidades y material no permitidos, ataques de reutilización y carrera, ruta simbólica, cambio del plan después de validación y vencimiento durante la espera.

**Minecraft 1.21.1 real, servidor desechable:** [GitHub Actions 40872948404](https://github.com/iagorobo24-hub/GuiaIA/actions/runs/40872948404), **SUCCESS**:

| Observación | Prueba |
| --- | --- |
| Nombre del jugador sin permiso | Rechazado, sin cambiar inventario |
| Intento con cofre no firmado | Rechazado |
| Autorizaciones correctas | Dos transferencias reales de roble y abedul |
| Repetición del mismo nonce | Rechazada |
| Inventario del bot | Roble 1→0, abedul 1→0 |
| Contenido del cofre tras reabrirlo | 1 roble y 1 abedul |
| Recibos de depósito | 2 |
| Reservas persistentes de autorización | 2 |

El ejemplo genera una pareja de claves **efímera dentro del laboratorio**. Esto prueba la comprobación criptográfica y el permiso de ámbito limitado, **no la distribución segura de claves ni una autoridad externa de identidad**.

## Límites y riesgo residual (P0 antes de producción)

1. **Suplantación en modo offline:** `online-mode=false` permite usar nombres ajenos. Ni el nick ni un UUID offline son prueba de identidad. No se ha integrado una fuente de identidad autenticada (por ejemplo, cuenta externa con vinculación validada, autenticación del proxy/servidor o una autorización externa de sesión confiable). Un jugador con el mismo nick no obtiene por sí solo un permiso Ed25519, pero aún puede falsear las observaciones de presencia si no existe una autoridad de identidad.
2. **Falta de cobertura global:** el viejo adaptador `createQaChestDeposit` y otros prototipos internos siguen disponibles **solo para QA** y no requieren esta nueva capa por sí solos; no existe un punto único que imponga autorizaciones a todas las funciones. Ninguna interfaz de chat o IA permite por ahora activarlos. Integrar cualquier interfaz futura sin cerrar esa vía sería inseguro.
3. **Distribución y custodia de claves:** falta un servicio operador separado con almacenamiento protegido, rotación/revocación, controles contra sustitución de la clave pública, trazabilidad por sesión y límites de tasa.
4. **Permisos de juego:** falta comprobar derechos de un usuario a acceder a cofres de jugadores distintos, proteger el contenedor contra cambios concurrentes de terceros y evaluar mods de protección/claims.
5. **Tolerancia ante fallos del servidor en mitad de la operación:** sigue sin demostrarse recuperación de corte eléctrico concurrente a la escritura del mundo; no existe transacción atómica conjunta entre el mundo de Minecraft y el diario externo.
6. **Compatibilidad:** no se ha certificado en Teselia/Cobblemon ni con amigos no premium.

## Siguiente fase recomendada

Diseñar una autoridad de identidad real adecuada a los amigos que no usan cuentas premium, sin confiar en el nombre offline. Vincular la identidad autenticada de esa autoridad a un permiso de sesión limitado y hacer obligatorio el verificador de permisos en el único punto de entrada de acciones del compañero. Hasta entonces, **no activar comandos públicos ni desplegar este código en Teselia**.
