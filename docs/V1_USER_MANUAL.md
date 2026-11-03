# GuiaIA V1 — Manual de Usuario Oficial

Bienvenido a **GuiaIA V1**, el agente inteligente autorizado y verificable para **Minecraft Java 1.21.1**.

Este manual está diseñado para jugadores y operadores reales. Explica paso a paso cómo instalar GuiaIA, conectarlo a tu servidor (Vanilla o Fabric), autenticarte, darle instrucciones comprensibles y mantener el control y la seguridad en todo momento.

---

## 1. Requisitos Previos

Para ejecutar GuiaIA en tu ordenador (Windows 11, Linux o macOS) necesitas:

1. **Minecraft Java Edition 1.21.1**:
   - Servidor Vanilla estándar, o
   - Servidor Fabric 1.21.1 (compatible con Cobblemon 1.8.2).
2. **Node.js**: Versión 22 o superior (descárgalo gratis en [nodejs.org](https://nodejs.org/)).
3. **Python**: Versión 3.10 o superior (opcional para el compañero Node, necesario para herramientas analíticas).

---

## 2. Instalación en un Paso

En tu ordenador con Windows (Durán):

1. Abre la carpeta del proyecto `GuiaIA`.
2. Haz clic derecho sobre [`setup.ps1`](file:///C:/Users/iagui/AI%20Projects/GuiaIA/setup.ps1) y selecciona **Ejecutar con PowerShell**, o abre una terminal PowerShell y escribe:
   ```powershell
   .\setup.ps1
   ```
3. El asistente verificará automáticamente tu entorno en 5 pasos:
   - ✔ Comprobación de Node.js (>= 22).
   - ✔ Comprobación de Python (>= 3.10).
   - ✔ Creación segura del almacenamiento de usuario en `%LOCALAPPDATA%\GuiaIA`.
   - ✔ Instalación limpia de dependencias (`npm ci`).
   - ✔ Validación de contratos e integridad.

---

## 3. Inicio Rápido

### En Windows
Haz doble clic sobre el archivo [`iniciar.bat`](file:///C:/Users/iagui/AI%20Projects/GuiaIA/iniciar.bat).

### Desde la Terminal
```bash
# Modo estándar interactivo (servidor local 127.0.0.1:25565)
node companion/src/cli_v1.js

# Conectar a una IP o puerto personalizado
node companion/src/cli_v1.js --host 192.168.1.100 --port 25565 --username GuiaBot
```

---

## 4. Autenticación y Emparejamiento

GuiaIA V1 cuenta con un modelo de seguridad Zero-Trust: nadie puede controlar al agente en el mundo a menos que esté debidamente autenticado.

### Opción A: Servidores Oficiales con Cuenta Microsoft
Si juegas en servidores que requieren autenticación oficial:
1. Inicia GuiaIA con `--auth microsoft`:
   ```bash
   node companion/src/cli_v1.js --auth microsoft --username tu_correo@outlook.com
   ```
2. La consola te mostrará un enlace y un código:
   - Visita: `https://microsoft.com/link`
   - Introduce el código mostrado en pantalla.
3. Tus credenciales se almacenan cifradas en `%LOCALAPPDATA%\GuiaIA\auth` y nunca se guardan en el repositorio Git.

### Opción B: Servidores LAN / Offline mediante PIN Efímero
Si juegas en una red local o en un servidor sin autenticación Microsoft:
1. Inicia GuiaIA de forma normal. Al conectarse al juego, la consola generará un **PIN de 6 dígitos** (válido por 3 minutos):
   ```
   ┌────────────────────────────────────────────────────────────┐
   │ PIN DE EMPAREJAMIENTO LAN / OFFLINE (Valido por 180s):     │
   │                      849201                                │
   │ Escribe en el chat de Minecraft:  /msg GuiaBot pair 849201 │
   └────────────────────────────────────────────────────────────┘
   ```
2. Entra al juego con tu personaje y escribe en el chat:
   ```
   /msg GuiaBot pair 849201
   ```
3. GuiaBot te responderá: *"Emparejamiento exitoso. Eres el operador autorizado."*
4. A partir de ese momento, tu sesión queda vinculada criptográficamente. Ningún otro jugador podrá suplantarte ni darle órdenes al agente.

---

## 5. Comandos e Instrucciones Comprensibles

En la consola de GuiaIA verás el indicador `GuiaIA> `. Puedes escribir instrucciones en lenguaje natural:

### Movimiento y Acompañamiento
- `sigue`: El agente activa la navegación acotada y te acompaña manteniendo una distancia segura (sin empujarte ni bloquear puertas).
- `estado` o `hud`: Muestra tu posición actual, vida (salud), nivel de comida y modo de trabajo.

### Recolección de Recursos en Lotes (Batch 1-16)
- `recoge 5 troncos de roble`
- `recoge 10 madera`
- `recoge 16 piedra en 10 64 10`
- `recoge 8 carbon`

> **Nota:** Por seguridad y para evitar griefing involuntario, cada orden está limitada a un máximo de 16 bloques consecutivos verificados mediante diario criptográfico.

### Depósito en Contenedores y Cofres
- `deposita 5 roble en cofre 10 64 10`
- `deposita 10 piedra en cofre` (si estás junto al cofre).

### Inventario y Recursos
- `inventario`: Muestra todos los objetos que lleva el bot y el número de slots libres de 36.

---

## 6. Parada de Emergencia P0 (Inmediata)

En cualquier momento, si el bot realiza un movimiento no deseado o se aproxima un peligro (lava, monstruos, caída):

- Presiona la tecla **`[ESC]`** o **`[q]`** en la consola, o
- Presiona **`Ctrl + C`**, o
- Escribe **`parar`** o **`stop`** y pulsa Enter.

En menos de **50 milisegundos**, GuiaIA cancelará todos los objetivos de pathfinding, detendrá la minería, cerrará cualquier contenedor abierto y pasará al estado de reposo seguro (`idle`).

---

## 7. Qué Hacer ante Caídas o Reinicios (Reconciliación de Diarios)

Si tu servidor de Minecraft o el proceso de GuiaIA se cierra inesperadamente en mitad de una tarea:

1. Vuelve a iniciar GuiaIA con `iniciar.bat`.
2. El sistema detectará automáticamente si había una acción a medio ejecutar y colocará el diario en estado de revisión segura (`needs_review`), impidiendo repeticiones accidentales o duplicación de acciones.
3. Dispones de tres opciones de reconciliación guiada:
   - **Reintentar (`retry`)**: Vuelve a intentar la acción desde el último paso confirmado.
   - **Marcar completado (`mark_step_completed`)**: Si viste en el juego que el bloque ya se minó o el ítem ya se depositó, el sistema guarda el recibo y avanza al siguiente paso.
   - **Cancelar (`cancel`)**: Anula la tarea pendiente sin alterar nada más.

---

## 8. Preguntas Frecuentes y Solución de Problemas

- **¿Puedo usarlo en servidores Fabric con Cobblemon?**  
  Sí. GuiaIA V1 detecta automáticamente si el servidor ejecuta Cobblemon y aplica la compatibilidad de red y recetas de Fabric 1.21.1 sin desconexiones.
- **¿Qué pasa si introduzco un PIN incorrecto 3 veces?**  
  El sistema se bloquea por seguridad para evitar ataques de fuerza bruta. Simplemente escribe `pin` en la consola de GuiaIA para generar un código nuevo.
- **¿Dónde se guardan mis tokens y registros?**  
  En `%LOCALAPPDATA%\GuiaIA\` (fuera del repositorio Git), protegiendo tus credenciales de posibles filtraciones accidentales.
