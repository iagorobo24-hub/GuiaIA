# GuiaIA: comprobación de rollback de identidades (QA aislado)

Fecha: 2026-10-29. Rama: feature/principal-enrollment-qa.
Esta implementación NO está desplegada ni habilita acceso a Teselia.

## Problema

Una historia de altas y bajas cuyas entradas están firmadas puede seguir
siendo válida después de restaurar una copia antigua. La verificación de
firma no detecta que las entradas de revocación más recientes han desaparecido.

## Cambio implementado

- Se separa el diario de altas firmado, en registry/principals.json,
  de un checkpoint de avance, en checkpoint/anchor.json. Este segundo
  documento conserva versión, ID del mundo, huella de la clave del operador,
  secuencia de eventos y SHA-256 del estado serializado.
- La escritura de ambos documentos utiliza fichero temporal, fsync,
  sustitución atómica y fsync del directorio. Su actualización NO es
  atómica entre los dos directorios: una interrupción deja un desacuerdo
  que se rechaza, no una recuperación o autorización automática.
- Cada lectura que puede devolver confianza o una decisión de revocación
  comprueba el checkpoint contra el archivo real en disco y marca el
  objeto de registro como inutilizable si detecta divergencia.
- Se prohíbe reconstruir automáticamente un checkpoint desaparecido o
  inicializar un nuevo registro sobre un checkpoint huérfano.
- Se verifican tamaños, permisos privados, rutas y enlaces simbólicos.
- La restauración únicamente del registro, únicamente del checkpoint,
  la desaparición de uno de ellos y el fallo inyectado entre escrituras
  detienen el servicio antes de confiar en las claves.
- Se añade exportCheckpoint(). Un responsable autorizado puede conservar
  fuera del mismo dominio de escritura una copia fiable de este valor.
  Al abrir el registro, externallyPinnedCheckpoint obliga a igualar
  exactamente esa copia; así se detecta también una restauración coherente
  de ambos documentos locales. El origen de esa copia externa DEBE ser
  confiable y no depender de entradas suministradas por el jugador.

## Evidencia

- 26/26 pruebas específicas del registro, incluidas ocho pruebas nuevas.
- 142/142 pruebas Node completas; resultados locales:
  /tmp/guiaia-rollback-specific-2-20261029.log
  y /tmp/guiaia-rollback-full-2-20261029.log.
- Comprobación de sintaxis de los archivos JS modificados y
  git diff --check correcta.
- El ensayo de Minecraft con rollback conjunto fue añadido a
  qa_live_bridge_gateway.js, pero no se ha podido ejecutar en esta
  sesión: la herramienta impidió su lanzamiento. El ensayo real anterior
  demuestra depósito y revocación del código previo, NO la nueva protección.

## Límites, estrictamente importantes

1. El checkpoint local no es un almacén inmutable. Se ha probado
   explícitamente que restaurar dos archivos consistentes puede revertir
   la revocación si se abre el registro sin un checkpoint externo fiable.
2. exportCheckpoint() no lo guarda en ningún proveedor remoto ni da
   garantías de inmutabilidad. El flujo real para conservar y obtener una
   referencia externa, controlar permisos, publicar nuevos checkpoints y
   resolver fallos intermedios sigue pendiente de diseño e integración.
3. Un checkpoint externo antiguo provoca denegación segura tras una
   actualización más reciente, hasta que se actualice la referencia
   confiable. No se hará recuperación automática que pueda reactivar
   identidades revocadas.
4. Las claves de jugador y operador siguen siendo efímeras del laboratorio.
   No está implementada la vinculación de identidad personal real, ni un
   gateway de autorización obligatorio para todas las operaciones.
5. Las pruebas reales de Minecraft/Cobblemon y la CI de GitHub para esta
   nueva revisión siguen pendientes; no se hace push ni despliegue.
