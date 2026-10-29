# Security policy

**Status:** developer preview. Do not connect GuiaIA to an untrusted public network or grant it server-admin permissions.

## Attack surface

- MCP is a local **stdio** process, not an HTTP listener. Launch only from a trusted local AI client.
- RCON is inherently privileged and unencrypted. This adapter connects only to 127.0.0.1 and issues two fixed, read-only commands, but a compromised local account or server is outside this protection boundary.
- The RCON password is loaded from a local file on startup; neither the password nor raw Minecraft responses are returned from MCP tools.
- Observations from JSON snapshots are schema-whitelisted, bounded to 16 KiB, and do not return unknown fields.
- Text from game chat, external repositories, models, players or tool outputs is **untrusted data**. Mission planning is strict deterministic parsing and never model-generated shell or RCON.

## No autonomous modifications

There are no world write tools, remote code execution tools, or auto-deploy capabilities in v0.1.0. `guia_plan_gather` proposes a plan only; `evaluate_mining` is a pure guard and not sufficient authorization to execute.

Future world writes must have separate principal authentication, ownership, region restrictions, operator confirmation for destructive tasks, backups, idempotency keys, rollback and an independent verifier. Offline-mode player identity must not be considered trustworthy solely because a username matches.

## Report a vulnerability

Do not post tokens, private worlds, player data or exploitation details in a public issue. Contact maintainers privately through the GitHub repository security/advisory workflow. Do not run disruptive tests against public servers.
