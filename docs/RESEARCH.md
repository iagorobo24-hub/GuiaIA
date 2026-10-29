# Open-source references (2026-10-29)

| Project | What to study | Caution |
| --- | --- | --- |
| https://github.com/mindcraft-bots/mindcraft | LLM+Mineflayer agents, profiles, tasks, multi-agent design | warns about model-written code and prompt injection |
| https://github.com/SomExE/minecraft-ai-companion | tool-based MCP bridge, read-only observation, explicit world actions | early alpha; missing camera and general autonomous planner |
| https://github.com/NiharP43/minecraft-ai-companion | closed action schema, owner-gating, permission checks, independent validator | assess maturity and tests before reuse |
| https://github.com/MineDojo/Voyager | skill memory, iterative self-verification, learning curriculum | experimental research; do not treat as production ready |
| https://github.com/PrismarineJS/mineflayer | entity, world, inventory and action API of a bot player | only chunks known to the bot are visible |
| https://github.com/chapmanjw/minecraft-java-fabric-claude-plugin | world inspection, blueprint/build/verify workflow, Fabric-backed MCP tooling | documented target mod versions do not include Teselia's Java 1.21.1 |
| https://github.com/embeddedt/mcdev-mcp | Minecraft mod development and code inspection | OSL-3.0 license; keep separately unless reviewed |

**Decision:** build an original GuiaIA product, borrowing *patterns* from these projects instead of cloning their code. Distinguish the co-playing assistant from a developer agent with privileged world/server access.
