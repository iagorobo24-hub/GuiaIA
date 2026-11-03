# GuiaIA V1 — Arquitectura de Software y Topología (V1_ARCHITECTURE)

> **Versión:** 1.0.0-dev  
> **Fecha:** 2 de noviembre de 2026

---

## 1. Topología de Despliegue de V1

GuiaIA V1 se ejecuta **completamente en local** en la máquina del usuario (Durán) y se conecta a través del protocolo Minecraft estándar (TCP) hacia el servidor objetivo (ya sea en loopback, LAN o a través de Internet / Tailscale).

```text
+-------------------------------------------------------------------------+
|                              ORDENADOR DURÁN                            |
|                                                                         |
|  +-------------------------------------------------------------------+  |
|  |                 INTERFAZ DE USUARIO V1 (TUI / CLI)                |  |
|  |  * Menú interactivo de conexión y configuración                    |  |
|  |  * Entrada en lenguaje natural / parser tipado                    |  |
|  |  * Cuadrícula visual de inventario (36 slots)                      |  |
|  |  * Parada de emergencia P0 (Tecla dedicada / comando STOP)        |  |
|  +---------------------------------+---------------------------------+  |
|                                    |                                    |
|                                    v                                    |
|  +-------------------------------------------------------------------+  |
|  |              RUNTIME DE ACOMPAÑANTE AUTÓNOMO (Node.js)             |  |
|  |                                                                   |  |
|  |  [Controlador Seguro] <-----> [Diarios Durables (fsync/O_EXCL)]  |  |
|  |          |                                                        |  |
|  |          +---> [Verificador de Autorización y Nonces]             |  |
|  |          |                                                        |  |
|  |          v                                                        |  |
|  |  [Mineflayer Client 4.39.0 + Pathfinder 2.4.5]                    |  |
|  +---------------------------------+---------------------------------+  |
|                                    |                                    |
|  +---------------------------------+---------------------------------+  |
|  |             TESTIGO MONOTÓNICO LOCAL DURABLE (Disco Durán)         |  |
|  |  * Clave Ed25519 local                                             |  |
|  |  * Bitácora append-only de secuencias CAS                           |  |
|  |  * Protección contra rollback simultáneo de diarios locales       |  |
|  +-------------------------------------------------------------------+  |
+------------------------------------+------------------------------------+
                                     |
                                     | Conexión Minecraft TCP (Puerto 25565)
                                     v
+-------------------------------------------------------------------------+
|                  SERVIDOR MINECRAFT JAVA 1.21.1                         |
|                                                                         |
|  [Modo A: Servidor Fabric con Mod GuiaIA]                               |
|    - GuiaIdentityBridge (Firma eventos JOIN/DISCONNECT con Ed25519)     |
|    - GuiaLiveSessionQuery (Desafío de presencia HTTP 25594)             |
|    - GuiaWorldObserver (Snapshot acotado de 1 chunk anonimizado)        |
|                                                                         |
|  [Modo B: Servidor Vanilla / Sin Mod]                                   |
|    - Protocolo Minecraft puro                                           |
|    - Autorización por emparejamiento local (PIN de propietario)         |
+-------------------------------------------------------------------------+
```

---

## 2. Invariantes de Seguridad y Modelo Zero-Trust

1. **Parada de Emergencia Absoluta (Prioridad 0)**:
   - Se ejecuta de manera síncrona ante `"¡Alto!"`, `"Stop"`, `"Detente"` o cierre del canal stdin.
   - Cancela metas de `pathfinder.setGoal(null)`, detiene el minado con `bot.stopDigging()` y limpia estados de control.
   - **No exige nonces, firmas, sesiones activas ni testigos.**

2. **Puerta de Ejecución de Dos Niveles**:
   - Ninguna acción que modifique el mundo (cavar bloques o transferir ítems a contenedores) puede ser disparada por texto arbitrario o alucinaciones de modelos de IA.
   - Toda intención debe traducirse a un contrato fuertemente tipado:
     - `kind`: `gather` | `deposit` | `follow` | `stop` | `inventory`
     - `resource`: Restringido a lista blanca (`oak_log`, `birch_log`, `stone`, `coal`)
     - `count`: Acotado rígidamente a lotes de 1 a 16 unidades.
     - `target` / `chest`: Coordenadas finitas validadas dentro de los límites del mundo (`<= 30.000.000`).

3. **Garantía Anti-Replay (Un Solo Uso por Acción)**:
   - Toda mutación del mundo consume un nonce de 10 segundos de caducidad en el libro mayor local antes de comenzar la acción física.
   - Si el proceso se cae a mitad de operación, el nonce queda quemado y el diario entra en `needs_review`, impidiendo reintentos automáticos peligrosos.

4. **Contabilidad de Inventario de Doble Entrada**:
   - Todo depósito en cofre exige verificar que `inventario_bot_delta == -count` y simultáneamente `inventario_cofre_delta == +count`. Si una de las dos condiciones no se cumple, la transacción se marca como fallida y se activa la cuarentena.
