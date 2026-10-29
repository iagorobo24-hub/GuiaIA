# GuiaIA — Compañero IA y herramientas para desarrollar Minecraft

**Versión 0.1.0: avance técnico.** La meta es tener un compañero que juegue contigo y un conjunto de agentes capaces de observar, diagnosticar y ayudar a mejorar tu mundo. La versión actual **no** es todavía un bot que juegue solo.

## Qué funciona

- Servidor local MCP (stdio), compatible con el flujo 2025-11-25 / 2025-06-18.
- Consultas limitadas de estado de Minecraft Java mediante RCON por `127.0.0.1`.
- Análisis orientativo de métricas tomadas de un archivo JSON de prueba o una exportación confiable.
- Propuestas de misiones sencillas de recolección **sin ejecutarlas**.
- Barreras de seguridad separadas de cualquier modelo de IA.
- Herramienta MCP adicional `guia_world_observe`: consume una muestra local reciente del [observador Fabric experimental](fabric-observer/README.md), si se configura; no modifica mundos.

## Cómo probarlo

Con Python 3.11 o posterior:

```sh
PYTHONPATH=src python3 -m guiaia.mcp --snapshot examples/synthetic_world.json
PYTHONPATH=src python3 -m unittest discover -s tests -v
```

El primer comando ofrece herramientas a un cliente MCP local, sin servidor web ni llamadas de pago. Consulta [la documentación del protocolo](docs/MCP_USAGE.md).

## Lo que falta

La integración real del bot autónomo, inspección de bloques y entidades con Fabric, capturas visuales, herramientas de desarrollo y pruebas de modificación segura en mundos aislados. Todo eso tendrá pruebas antes de anunciarse como disponible.

Lee también [README principal en inglés](README.md), [hoja de ruta](docs/ROADMAP.md) y [seguridad](SECURITY.md). No afiliado a Mojang, Microsoft ni Cobblemon.
