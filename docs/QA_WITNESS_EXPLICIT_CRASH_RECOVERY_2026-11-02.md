# GuiaIA — recuperación explícita de testigo tras `SIGKILL` (solo QA)

**Fecha:** 2026-11-02. **Entorno:** Chromebook, Node.js 22, Linux/procfs, directorios sintéticos aislados. **No es un servicio desplegado ni una recuperación de producción.** El ensayo real previo de Cobblemon + testigo físico Durán ya pasó (véase `QA_COBBLEMON_DURAN_PHYSICAL_WITNESS_PASS_2026-11-02.md`); esta fase añade pruebas de recuperación controlada del proceso local de testigo tras un cierre abrupto, sin encender ni reiniciar el servidor compartido Teselia.

## Problema original

`qa_checkpoint_witness.js` obtiene un bloqueo exclusivo `witness.lock` al arrancar. El cierre limpio con SIGTERM lo retira; `SIGKILL` deja el archivo, y un reinicio normal se niega a abrirlo. Los tests antiguos despejaban esa ruta manualmente; el archivo estaba vacío y no había forma de comprobar de quién era. **Borrar un bloqueo arbitrario no es un procedimiento seguro.**

## Implementación

- Nuevos bloqueos QA guardan **PID, inicio exacto del proceso de Linux (`/proc/<pid>/stat`, campo 22), identificador de arranque del kernel y versión**, en un archivo creado con exclusión `wx` y permisos `0600`; se sincronizan archivo y directorio. Un bloqueo antiguo vacío o corrupto **no es recuperable automáticamente**.
- Comando separado `companion/qa_witness_recover.js`: requiere `--qa-recover-crashed-lock <config-qa-privada> --acknowledge-operator-stopped`. Solo opera en Linux y en el árbol temporal QA `guiaia-remote-anchor-qa-*` con permisos `0700`, usando una configuración y claves aisladas validadas por `qa_witness.js`.
- Rechaza recuperación si falta la aprobación explícita, el testigo original sigue activo (mismo PID + inicio de proceso + arranque del SO), no puede comprobarse `/proc`, el bloqueo es antiguo/inválido/simbólico, el checkpoint no existe o su firma Ed25519 no valida con la clave del testigo y la huella del operador. **No sustituye una firma corrupta por otra ni reinicializa secuencias.**
- Una segunda exclusión `.recovery.lock` impide que dos recuperadores actúen a la vez. Antes de retirar `witness.lock` se comprueban de nuevo su identidad de fichero y la identidad del proceso antiguo. No se tocan el registro del principal, los diarios de acciones, los permisos gastados, los cofres ni el mundo. El comando termina después de retirar solo el bloqueo ya demostrado obsoleto. No arranca el testigo por sí mismo ni reenvía un avance CAS.
- Tras completar la recuperación, el operador puede **arrancar explícitamente** `qa_witness.js --qa-serve <config-qa-privada>` con las *mismas claves y el mismo directorio*. La carga vuelve a verificar el checkpoint firmado y conserva la secuencia monotónica. Los avances antiguos se deniegan.

## Pruebas ejecutadas

- Proceso real aislado `qa_witness.js` en un hijo Node, avance firmado secuencia `0 -> 1`, `SIGKILL`, rechazo de preflight mientras el testigo está caído, rechazo de un reinicio con lock viejo, recuperación explícita con prueba de PID muerto, reinicio, verificación de secuencia `1`, **rechazo de CAS antiguo** y cierre limpio.
- Negativas reales: sin confirmación del operador, bloqueo activo con PID correcto, checkpoint firmado alterado, bloqueo heredado vacío, registro malformado, bloqueo simbólico, falta de checkpoint inicial tras `SIGKILL` y segunda recuperación simultánea/duplicada. El bloqueo se conserva ante toda duda.
- Se añadieron **4 pruebas QA** a `qa_witness_standalone.test.js` y se sustituyó la eliminación manual del bloqueo en el ensayo Linux de `remote_checkpoint.test.js` por la recuperación con verificación firmada. La regresión completa **Node 380/380 PASS** y **Python 58/58 PASS**; pruebas focales **18/18 PASS**. Se mantienen las verificaciones Ed25519, fail-closed y el límite de 1.500 ms. **No hay ningún mecanismo automático de replay.**

## Límites y operación

**Esto solo recupera un bloqueo de un proceso de testigo muerto en un laboratorio de confianza.** No recupera una clave perdida, corrupción del propio almacén, rollback firmado cometido por quien controla disco y clave, apagón durante una escritura, caída de Durán completo o servidor multijugador productivo. Si el bloqueo es antiguo/incompleto o el checkpoint firmado no se puede demostrar, se requiere análisis humano; el comando **no elimina nada**. Un fallo que deje `.recovery.lock` activo también exige intervención humana controlada, no un reintento automático.

WSL2 puede reiniciarse y **borrar `/tmp`**; este mecanismo no hace persistente ese directorio. Para producción deben diseñarse custodia durable de clave/copia segura, anclaje externo antirrollback y control de acceso al servicio, antes de retirar el marcador `sandboxOnly`. Ninguna prueba de esta fase autoriza jugar o modificar Teselia, ni sustituye autenticación oficial de Microsoft/Minecraft.
