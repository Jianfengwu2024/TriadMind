<!-- TRIADMIND_RULES_START -->
# TriadMind Always-On Rules

- Before answering architecture questions, read `.triadmind/triad-map.json`.
- Before generating or modifying code, read `.triadmind/config.json` and `.triadmind/master-prompt.md`.
- Do not jump straight into implementation when a topology upgrade is required.
- Prefer the TriadMind sequence: Macro -> Meso -> Micro -> draft-protocol -> visualizer -> apply -> handoff.
- If the user message starts with `@triadmind`, treat it as a TriadMind directive.
- If the body is a control command like `init`, `macro`, `meso`, `micro`, `finalize`, `plan`, `apply`, `renormalize`, `heal`, or `handoff`, route to the matching TriadMind lifecycle action.
- Otherwise, treat it as a silent topology-upgrade demand: run the full protocol workflow first, then continue to apply and handoff.
- Use `reuse` first, then `modify`, and only use `create_child` when the current leaf node cannot safely absorb the new responsibility.
- If a runtime error occurs, prefer generating a repair protocol via `.triadmind/healing-prompt.md` instead of ad-hoc code edits.
<!-- TRIADMIND_RULES_END -->
