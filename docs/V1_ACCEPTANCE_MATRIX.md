# GuiaIA V1 — Matriz de Aceptación y Pruebas Multinivel (V1_ACCEPTANCE_MATRIX)

> **Versión:** 1.0.0-dev  
> **Fecha:** 2 de noviembre de 2026

---

## Niveles de Verificación Obligatorios

Cada funcionalidad desarrollada debe demostrar su validez en cuatro niveles consecutivos antes de considerarse terminada:

- **Nivel A (Código y Sintaxis)**: Tipado estricto, análisis estático, pruebas unitarias aisladas sin dependencias de red.
- **Nivel B (Integración de Componentes)**: Interacción entre módulos (diarios durables, controlador, libro de nonces y Mineflayer mocks).
- **Nivel C (Sistema Real Minecraft)**: Prueba en servidor Minecraft Java 1.21.1 / Fabric real en loopback o sobre Tailscale.
- **Nivel D (Producto / Experiencia de Usuario)**: Ejecución completa a través de la TUI/CLI por un usuario sin invocar scripts internos de test.

---

## Matriz de Criterios de Aceptación

| Hito | Criterio de Aceptación Objetivo | Nivel A (Unitario) | Nivel B (Integración) | Nivel C (Minecraft Real) | Nivel D (Producto) |
|---|---|:---:|:---:|:---:|:---:|
| **Conexión y Autenticación** | Conexión limpia con cuenta Microsoft oficial o PIN offline | ✅ | ✅ | ✅ | ✅ |
| **Emparejamiento de Dueño** | Bloqueo categórico de órdenes emitidas por otros jugadores | ✅ | ✅ | ✅ | ✅ |
| **Misión de Recolección (Lotes)** | Tala de 1 a 16 bloques con verificación física de inventario | ✅ | ✅ | ✅ | ✅ |
| **Depósito en Cofre** | Contabilidad doble: delta bot = -N y delta cofre = +N | ✅ | ✅ | ✅ | ✅ |
| **Parada de Emergencia (P0)** | Detención en seco en <100 ms ante tecla de STOP | ✅ | ✅ | ✅ | ✅ |
| **Recuperación ante Crash** | Retorno a estado seguro sin duplicación de ítems | ✅ | ✅ | ✅ | ✅ |
| **Testigo Monotónico Durable** | Detección y bloqueo ante cualquier intento de rollback en disco | ✅ | ✅ | ✅ | ✅ |
| **Instalación en Windows** | `setup.ps1` deja la app 100% lista para iniciar en <3 min | N/A | ✅ | ✅ | ✅ |
