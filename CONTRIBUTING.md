# Contributing to GuiaIA

We welcome reproducible bug reports, code improvements and tested Minecraft integrations.

1. Check the roadmap and open an issue describing the problem, expected behavior and Minecraft/Fabric version.
2. Keep changes small and include tests for security boundaries.
3. Run `PYTHONPATH=src python3 -m unittest discover -s tests -v`.
4. Do not commit private server files, world saves, player UUIDs, game logs, passwords, RCON endpoints or unlicensed mod assets.
5. Distinguish simulated tests from actual game integration. Never claim a bot built or saw something if no real test proves it.
6. A contribution does not authorize deployments to any server. Use isolated test worlds for destructive/invasive tests.

New MCP tools must default to read-only. State-changing tools require a separate security design and approval.
