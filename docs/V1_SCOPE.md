# GuiaIA V1 — Alcance y Criterios de Producto (V1_SCOPE)

> **Versión:** 1.0.0-dev  
> **Fecha de aprobación:** 2 de noviembre de 2026  
> **Estado:** Aprobado para desarrollo

---

## 1. Misión del Producto V1

Convertir GuiaIA en una aplicación real, instalable, segura, documentada y utilizable por personas en entornos reales de Minecraft Java 1.21.1 / Fabric, manteniendo la integridad criptográfica, la recuperación durable ante fallos y el control total en manos del operador humano.

---

## 2. Experiencia de Usuario Canónica (Las 12 Capacidades de V1)

Un usuario final debe ser capaz de:

1. **Instalación Sencilla**: Descargar e instalar GuiaIA mediante un asistente de configuración automatizado (`setup.ps1` / `setup.bat`) sin requerir conocimientos de ingeniería de bajo nivel.
2. **Conexión Parametrizada**: Conectar al bot a un servidor Minecraft compatible introduciendo host y puerto en caliente.
3. **Autenticación Dual**:
   - *Modo Offline / LAN*: Emparejamiento local mediante código PIN efímero de un solo uso generado al arrancar la consola.
   - *Modo Oficial Online*: Inicio de sesión legítimo con cuenta Microsoft / Mojang mediante OAuth2 Device Code Flow.
4. **Control Exclusivo de Operador**: Vincular al bot estrictamente con su propietario, denegando órdenes de terceros.
5. **Instrucciones en Lenguaje Natural**: Emitir comandos comprensibles en español e inglés ("sígueme", "recoge 3 troncos de roble", "deposita la madera en el cofre", "alto").
6. **Interpretación Segura y Tipada**: Garantizar que las intenciones se traduzcan a contratos tipados acotados (lotes de 1 a 16 ítems) sin ejecución arbitraria.
7. **Observabilidad del Progreso**: Visualizar el estado del bot (vida, comida, posición, inventario y fase de la misión) en una consola interactiva (TUI) rica en colores ANSI.
8. **Interacción con el Mundo**: Desplazamiento seguro con Mineflayer Pathfinder, recolección verificada de recursos básicos y depósito transaccional en cofres autorizados.
9. **Parada de Emergencia Absoluta (P0)**: Detención inmediata incondicional del movimiento y minado ante cualquier orden de parada o desconexión, sin exigir firmas ni nonces.
10. **Recibos Criptográficos Verificables**: Generación de recibos de auditoría de doble entrada (inventario del bot vs contenedor) por cada operación completada.
11. **Recuperación Robusta ante Fallos**: Reanudación segura o cancelación limpia tras caídas del cliente, caídas del servidor o reinicios sin duplicación de ítems.
12. **Diagnóstico y Soporte**: Consulta clara de errores, limitaciones de compatibilidad y bitácoras de depuración sanitizadas (sin exposición de claves ni tokens).

---

## 3. Delimitación de Versiones

### Dentro de V1 (Obligatorio)
- Minecraft Java 1.21.1.
- Servidores Fabric 1.21.1 y servidores Vanilla (soporte dual).
- Conectividad probada en servidores con mod Cobblemon 1.8.2 (sin crasheos por serializers de recetas).
- Recolección acotada de madera (roble, abedul), piedra y carbón (lotes de 1 a 16).
- Depósito en cofres con verificación de inventario doble.
- Autenticación dual (PIN local para offline; Device Code para Microsoft).
- Testigo monotónico local durable en disco de Durán.
- Consola de usuario unificada (TUI interactiva).
- Instalador y script de inicio para Windows.

### Para V1.1 (Siguiente iteración)
- Automatización avanzada de Pokémon en Cobblemon (detección de especies, batallas automáticas, capturas, interacción con PC Pokémon).
- Dashboard Web local interactivo (`http://127.0.0.1:8080`).
- Sistema de construcción autónoma de estructuras a partir de blueprints.
- Misiones multi-etapa complejas con herramientas compuestas.

### Fuera de Alcance Permanente
- Ejecución de código arbitrario o acceso RCE a través de chat o prompts.
- Comandos RCON destructivos o no auditados.
- Minado desatendido masivo (quarry / strip mining infinito) sin supervisión de distancia de operador.
- Conexión a servidores o mundos sin autorización explícita del propietario.
