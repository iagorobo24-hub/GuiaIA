# Public-source publication safeguards

## Developer preview gates

- [x] Public product lives in an independent repository, not the production Teselia Git history.
- [x] Only new, generic-source Python code and synthetic JSON fixtures are selected for release.
- [x] No world save, MC region, Cobblemon player storage, runtime SQLite or JAR included.
- [x] Local code and docs reviewed for likely private paths, key/token formats, IPs and unlicensed third-party copy; re-check exact release tree immediately before push.
- [x] Explicit MIT LICENSE, contribution rules and security policy provided.
- [x] Tool boundary denies arbitrary RCON, shell and world mutation.
- [x] Unit tests and actual protocol smoke pass locally.
- [ ] GitHub hosted CI has run and passed on Python 3.11–3.13.
- [ ] Fresh independent machine has installed and exercised the preview.

## Stable/gameplay release gates (not met)

- [ ] Confirm public Fabric module APIs and version-compatible client/server install.
- [ ] Verify companion follows/mines/builds *in an actual Minecraft world* with safe rollback.
- [ ] Verify player authentication, world read/privacy restrictions, resource budgets and concurrency.
- [ ] Validate real Cobblemon interactions and saved data (if supported).
- [ ] Implement client screenshots with explicit privacy permission (if offered).
- [ ] Complete third-party licensing inventory before importing code or assets.
- [ ] Publish a representative unedited video showing actual measured gameplay.
- [ ] Collect external beta user reports.

**Scope:** publication of this v0.1 developer preview does not imply the safety or readiness of the companion or autonomous engineering agent.
