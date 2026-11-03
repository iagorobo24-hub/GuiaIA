# GuiaIA V1 — Roadmap Maestro y Descomposición de Fases (V1_MASTER_ROADMAP)

> **Versión:** 1.0.0-dev  
> **Aprobado:** 2 de noviembre de 2026

---

## Resumen de Fases y Dependencias

```text
[Fase 1: Alcance y Contratos] ---> [Fase 2: Misiones y Lotes] ---> [Fase 6: Consola TUI]
               |                                   |                         |
               v                                   v                         v
[Fase 3: Autenticación e Identidad] ---> [Fase 5: Testigo Durable] ---> [Fase 7: Instalador]
               |                                                             |
               +-----------------------+-------------------------------------+
                                       v
                             [Fase 8: QA y Estrés]
                                       v
                             [Fase 9: Beta Controlada]
                                       v
                             [Fase 10: Publicación V1]
```

---

## Desglose de Fases

### Fase 1: Alcance y Arquitectura Definitiva
- **TASK-1.1-CONTRACTS (P1)**: Unificación de esquemas canónicos JSON en `schemas/v1/`.
- **TASK-1.2-COMPAT-MODES (P0)**: Modo Dual (Fabric endurecido vs Vanilla con emparejamiento).

### Fase 2: Ejecución Integrada de Misiones
- **TASK-2.1-MULTI-RESOURCE (P1)**: Lotes acotados de 1 a 16 unidades de madera, piedra y carbón.
- **TASK-2.2-JOURNAL-RECONCILE (P1)**: Asistente interactivo para reconciliar diarios en `needs_review`.

### Fase 3: Identidad y Acceso a Servidores
- **TASK-3.1-OFFICIAL-AUTH (P0)**: Autenticación Microsoft Device Code Flow con almacenamiento seguro de tokens.
- **TASK-3.2-OWNER-PAIRING (P0)**: Emparejamiento seguro por PIN para servidores LAN / offline.

### Fase 4: Persistencia y Recuperación
- **TASK-4.1-DURABLE-STORAGE (P1)**: Grabación atómica con respaldo `.bak` e integridad SHA-256 en NTFS.

### Fase 5: Seguridad y Testigos Independientes
- **TASK-5.1-DURABLE-WITNESS (P1)**: Sustituir el simulador volátil en RAM por un testigo local durable en disco de Durán.

### Fase 6: Experiencia de Usuario
- **TASK-6.1-UNIFIED-CLI (P0)**: Consola TUI interactiva con colores ANSI, menú de conexión y parada P0.
- **TASK-6.2-LOCAL-DASHBOARD (P2)**: Mini-dashboard web local opcional para visualización en navegador.

### Fase 7: Instalación y Distribución
- **TASK-7.1-SETUP-WIZARD (P0)**: Script `setup.ps1` e `iniciar.bat` para Windows.
- **TASK-7.2-RELEASE-AUTOMATION (P1)**: Pipeline de empaquetado del mod JAR y release ZIP reproducible.

### Fase 8: QA Integral y Endurecimiento
- **TASK-8.1-STRESS-RESILIENCE (P0)**: 50 misiones continuadas con inyección de lag y fallos inducidos.

### Fase 9: Beta Controlada
- **TASK-9.1-BETA-TRIAL (P1)**: Ensayo en servidor aislado con 2-3 jugadores autorizados.

### Fase 10: Publicación V1
- **TASK-10.1-V1-RELEASE (P0)**: Verificación de puertas de publicación, Git tag `v1.0.0` y entrega.
