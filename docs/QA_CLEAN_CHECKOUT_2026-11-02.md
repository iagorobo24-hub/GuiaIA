# GuiaIA — aceptación de instalación en checkout limpio local

**Fecha:** 02/11/2026. **Equipo:** Chromebook `penguin`. **Alcance:** laboratorio sin servidores de juego, sin Docker, sin GitHub y sin acceso al registro npm.

## Qué se comprobó directamente

Se exportó el árbol **seguido por Git** del commit `3bea3a1` a un directorio desechable `/tmp/guiaia-clean-install-qa-*`, sin copiar archivos ignorados, `node_modules`, pruebas de mundos ni configuraciones de secretos.

Desde el nuevo árbol se ejecutó `npm ci --offline --ignore-scripts --no-audit --no-fund`: se instalaron **92 paquetes**, sin descargas de red, con paquete Mineflayer 4.39.0; se revisó adicionalmente que el lockfile no marca dependencias con `hasInstallScript`. Después se ejecutaron **364/364 pruebas Node** y **54/54 Python** y se verificó que la CLI rechaza el arranque sin `GUIAIA_QA_OWNER` con código **2**. No hubo conexión a un Minecraft real durante esa aceptación.

Como siguiente paso se introdujeron `scripts/qa_clean_checkout.py` y `tests/test_qa_clean_checkout.py` para repetirlo con una sola invocación desde la raíz del repo. El script comprueba el Git worktree limpio, exporta `HEAD` con `git archive` y valida que la extracción contiene exclusivamente archivos normales y directorios seguros (sin enlaces ni rutas de escape). La instalación se hace con npm offline y scripts desactivados, se ejecutan ambas baterías completas, se deniega el arranque sin propietario y se devuelve un marcador JSON `GUIAIA_CLEAN_CHECKOUT_QA_EVIDENCE` solo después de pasar todas las etapas. El directorio temporal se borra automáticamente incluso si alguna etapa falla.

Los tests de Python verifican exportación válida, rechazo de traversal `../`, rutas absolutas y enlaces simbólicos. Se añaden cuatro pruebas al conjunto Python, que pasa de 54 a **58**.

## Cómo reproducirlo en un laboratorio

Desde un clon local de GuiaIA con Git limpio, Node >=22, Python >=3.11 y npm cache local completa:

```bash
python3 scripts/qa_clean_checkout.py
```

El script no instala ni modifica archivos en el repositorio original. La caché npm debe contener previamente todas las dependencias: en otra máquina sin caché, **el modo offline fallará**, lo que es un resultado esperado, no una instalación completa. El script tampoco compila el JAR Fabric, no inicia Minecraft y no prueba autenticación Microsoft.

## Límites

- Se ha demostrado instalación nueva en un **directorio independiente del mismo Chromebook**, no instalación en un sistema operativo u ordenador distinto.
- La comprobación utiliza `npm ci --ignore-scripts` y por diseño **no ejecuta hooks de dependencias de terceros**.
- Las pruebas de Fabric real, revocación y cofre están documentadas en fases previas; esta aceptación es una prueba de empaquetado, dependencias y runtime de test sin mundo.
- El GitHub remoto sigue sin recibir los commits locales; no se ha abierto PR ni realizado despliegue.
- **No están cerrados:** instalación fresca con una segunda persona/equipo, identidad oficial de Minecraft, witness remoto entre máquinas y compatibilidad Cobblemon.

## Criterio de cierre

El marcador debe incluir `result=pass`, `npm_offline=true`, `node_tests` y `python_tests` coherentes, `missing_owner_denied=true`, `separate_physical_computer=false`, `production_touched=false` y `temporary_checkout_removed_on_exit=true`. La ausencia de marcadores o fallos de alguno de los comandos invalida la aceptación.
