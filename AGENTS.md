<!-- TRIADMIND_RULES_START -->
# TriadMind Session Rules

- Bootstrap version: 1.0
- Before architecture decisions, read `.triadmind/triad-map.json` and `.triadmind/runtime-map.json`.
- Before coding, read `.triadmind/config.json`, `.triadmind/master-prompt.md`, and `.triadmind/runtime-diagnostics.json`.
- Run fail-closed: if `triadmind verify --strict` fails, stop implementation and fix topology quality first.
- Prefer the protocol lifecycle: `macro -> meso -> micro -> finalize -> plan -> apply -> handoff`.
- Prioritize operations in this order: `reuse > modify > create_child`.
- For runtime regressions, generate repair artifacts first (`triadmind heal`) before ad-hoc patching.
<!-- TRIADMIND_RULES_END -->
