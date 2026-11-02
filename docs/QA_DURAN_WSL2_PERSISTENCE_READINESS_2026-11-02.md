# GuiaIA — preparación de persistencia WSL2 Durán (sin despliegue)

**Fecha:** 2026-11-02. **Base de código:** `3d525e0`. **Estado:** comprobaciones locales QA y diseño; **NO se ha ejecutado un reinicio completo de WSL2 en Durán**, no se ha migrado ninguna clave y no se ha configurado un servicio permanente. Una inspección remota del equipo fue bloqueada por controles de la sesión; no se intentó eludirla. Teselia continúa intacto en el Chromebook.

## Evidencia y limitación actual

- El testigo `qa_witness.js` exige explícitamente `sandboxOnly:true` y una carpeta `guiaia-remote-anchor-qa-*` inmediatamente bajo `/tmp`. Esto es **intencional para QA**: no se ha ampliado el código para aceptar rutas de producción. La prueba física Cobblemon + Durán superó el escenario de corte del transporte y depósito denegado, pero no un apagón de Durán.
- `qa_witness_recover.js` restaura **solo un bloqueo huérfano** después de comprobar la identidad del proceso y la firma Ed25519 del checkpoint. Un `SIGKILL` antes de guardar `head.json` y una pérdida/rotación de claves son **fail-closed**; no se repara un estado corrupto ni se recrea una autoridad desde cero.
- En la documentación oficial de Microsoft, WSL2 almacena las distribuciones en un disco virtual `ext4.vhdx`; `wsl --shutdown` termina todas las distribuciones y la máquina virtual. `wsl --export` permite hacer copia de la distribución. Un servicio systemd **no mantiene la instancia WSL funcionando por sí mismo**. Fuentes:
  - https://learn.microsoft.com/en-us/windows/wsl/disk-space
  - https://learn.microsoft.com/en-us/windows/wsl/basic-commands
  - https://learn.microsoft.com/en-us/windows/wsl/systemd
  - https://learn.microsoft.com/en-us/windows/wsl/faq
- La conclusión de arquitectura **recomendada**, no verificada en Durán: una futura custodia durable debe vivir en un directorio privado del filesystem Linux nativo de la distribución (por ejemplo, bajo `$HOME/.local/state`), **no** en un `/tmp` de laboratorio ni en `/mnt/c`. Aun en ext4, el VHD puede perderse, ser copiado o restaurado a una versión antigua. Una firma válida prueba procedencia, **no** la ausencia de rollback tras restauración de disco. Es necesario un anclaje de secuencia externo, además de copias cifradas y ensayos de recuperación.

## Nueva auditoría de candidato: solo lectura

Archivo `companion/qa_witness_storage_audit.js`, con comando explícito:

```sh
node companion/qa_witness_storage_audit.js --qa-readonly-storage-candidate /home/USUARIO/.local/state/guiaia-witness-qa-IDENTIFICADOR
```

El ejemplo **no crea directorios ni es una instrucción de despliegue**. Requiere Linux, rutas absolutas canónicas, un nombre `guiaia-witness-qa-*` dentro del directorio de estado del usuario obtenido de la cuenta de Linux (`os.userInfo().homedir`, **nunca** un `HOME` arbitrario), y una cuenta con directorio propio directamente bajo `/home`. También exige rutas sin symlink, propiedad del usuario actual, directorios `state` y de candidato en modo `0700` y filesystem de tipo ext4 (`statfs`). Rechaza rutas Windows/DrvFS, tmpfs, carpetas inexistentes, permisos no privados, rutas fuera de ámbito y formatos alterados. No lee claves ni checkpoints, no crea carpetas, no cambia permisos y no toca ningún servicio. El resultado `candidate_pass` **solo indica idoneidad de ruta inicial**; las propiedades `production_ready=false`, `wsl_reboot_tested=false`, `backup_tested=false` y `external_rollback_anchor=false` son invariables incluso si todos los chequeos pasan. Una ruta inexistente devuelve `fail_closed` y código 2, sin crearla.

Pruebas en Chromebook: 5/5 para candidato privado simulado, tipos de filesystem inseguros simulados, symlink, permisos laxos, rutas fuera de alcance, intento de falsificar `HOME` y ejecución real del CLI que no altera los archivos. Además, un test separado verifica que, tras `SIGKILL`, cambiar la clave de operador o testigo impide recuperar el bloqueo; con las claves originales el checkpoint sigue verificándose. **Esto no equivale a pasar la auditoría en Durán.**

## Cierre de regresión local

Tras incorporar la auditoría, su comprobación de `HOME` y la negativa por sustitución de claves, la suite completa Node finalizó con **386/386 PASS** (0 fallos, 0 omisiones) y las **58/58 pruebas Python** también pasaron. Se verificó la sintaxis JavaScript, `git diff --check` y que no existen servicios temporales de testigo levantados. El alcance de estas cifras es **Chromebook Linux QA**, no ejecución remota de Durán.

## Plan de validación futura en Durán (no ejecutado)

1. **Inventario de solo lectura:** identificar con certeza la distribución WSL2, tipo de FS y ubicación del VHD; comprobar quién está usando esa distribución y si hay agentes/proyectos activos. No usar `wsl --shutdown` o `--terminate` mientras otras tareas dependan de WSL.
2. **Laboratorio separado y sin credenciales reales:** crear en el filesystem Linux nativo un directorio QA privado `0700` y un marcador sintético sin claves. Ejecutar la auditoría read-only, guardar evidencias de `statfs`, `stat` y hash del marcador antes y después. No reutilizar el fixture temporal de la misión Minecraft.
3. **Reinicio controlado solo con distribución identificada y autorización compatible con otros procesos:** detener primero el laboratorio; reiniciar solo la distribución autorizada cuando no haya procesos ajenos, y comprobar el marcador. **No** reiniciar Windows ni la distribución completa por rutina.
4. **Crash con estado firmado sintético:** volver a usar claves QA nuevas, guardar dos checkpoints firmados, provocar `SIGKILL` solo al testigo QA, comprobar `witness.lock` huérfano, denegar el arranque normal, permitir recuperación explícita previa validación de firma y proceso muerto, reiniciar con la misma clave QA y verificar secuencia monotónica y rechazo de CAS antiguo. Hacerlo primero sin Minecraft.
5. **Desastre y rollback:** simular únicamente con copias QA acotadas la pérdida de clave, pérdida de `head.json`, restauración de un `head.json` antiguo válido y restauración completa de una copia de disco. La recuperación sin prueba de un ancla externa más reciente **debe bloquearse**, nunca autorizar una misión por firma local sola.
6. **Respaldo y operación:** definir cifrado de respaldo, responsables, protección de claves ante acceso Windows y misma cuenta Linux, rotación segura, monitorización, restauración verificada, cuotas y apagado del servicio. La documentación Microsoft de exportación no demuestra por sí sola que un respaldo esté cifrado o restaurado correctamente.

## Criterios para cambiar el estado del roadmap

**Aún pendiente:** auditoría real de Durán, prueba de retención tras reinicio de su WSL2, custodia estable de clave/testigo sin relajar el modo QA, contraste de copia/restauración y ancla independiente antirrollback, autorización de cuentas online y beta. No marcar producción ni distribución pública como habilitadas.
