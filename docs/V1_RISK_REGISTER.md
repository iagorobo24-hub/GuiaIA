# GuiaIA V1 — Registro de Riesgos Técnicos y Mitigaciones (V1_RISK_REGISTER)

> **Versión:** 1.0.0-dev  
> **Fecha:** 2 de noviembre de 2026

---

## Registro de Riesgos

| ID | Riesgo Identificado | Severidad | Probabilidad | Estrategia de Mitigación | Estado |
|---|---|:---:|:---:|---|:---:|
| **RSK-01** | Complejidad excesiva de testigos criptográficos (anclaje en servicios cloud externos con costes y latencias) | Alta | Alta | Sustituir por testigo local durable append-only con claves Ed25519 en `%LOCALAPPDATA%/GuiaIA/` en Durán. | **Mitigado en diseño** |
| **RSK-02** | Bloqueo o crasheo del cliente Mineflayer ante servidores Fabric con mods complejos (Cobblemon) | Alta | Media | Aplicado parche upstream de serializers de recetas (PR #1291). Bounding estricto de paquetes de red. | **Verificado PASS** |
| **RSK-03** | Inconsistencia de rutas por NTFS Junctions en Windows (`C:\...` -> `D:\...`) | Media | Media | Uso sistemático de rutas canónicas resueltas (`fs.realpathSync` / `Path.resolve`). | **Activo** |
| **RSK-04** | Exposición accidental de tokens Microsoft OAuth en logs o en pantalla | Crítica | Baja | Filtrado y ofuscación estricta de tokens; almacenamiento cifrado local con permisos 0600. | **Activo** |
| **RSK-05** | Fallo de terminal PTY en CMD de Windows antiguo al renderizar la TUI | Baja | Media | Uso de Node `readline` estándar con códigos ANSI compatibles y degradación elegante a texto plano. | **Activo** |
| **RSK-06** | Modificación involuntaria del servidor Teselia en el Chromebook | Crítica | Baja | Prohibición absoluta por regla de sistema. Aislamiento estricto de pruebas en puertos y mundos efímeros. | **Controlado** |
