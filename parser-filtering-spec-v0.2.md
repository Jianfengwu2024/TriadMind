# TriadMind Parser Filtering Spec v0.2

## Purpose

- Define the default filtering policy for architecture-oriented topology generation.
- Keep the default graph focused on capability structure instead of raw implementation fragments.
- Preserve full leaf detail for drill-down and debug workflows.

## Default Classification

Every scanned symbol is treated as one of:

- `capability_candidate`
- `leaf_only`
- `suppressed`

## Mandatory Suppression Defaults

The default architecture/capability surface suppresses:

- magic methods matching `^__.*__$`
- private methods and classes matching `^_.*$`
- helper verbs such as `get_*`, `set_*`, `build_*`, `parse_*`, `format_*`, `normalize_*`, `sanitize_*`, `validate_*`
- extended helper verbs such as `ensure_*`, `create_*`, `load_*`, `save_*`, `list_*`, `collect_*`, `resolve_*`, `prepare_*`, `read_*`, `write_*`, `convert_*`, `sync_*`, `merge_*`, `filter_*`, `check_*`, `infer_*`, `guess_*`
- schema / model / entity / dto / vo / type artifacts under matching paths
- migration files and `upgrade` / `downgrade`
- test files and test symbols

## Capability Retention Defaults

When not otherwise suppressed, the default capability surface retains:

- `execute`
- `run`
- `handle`
- `process`
- `dispatch`
- `apply`
- `invoke`
- `plan`
- `schedule`
- `orchestrate`

It also favors public API handlers, CLI command handlers, workflow stages, execution entrypoints, and adapter / gateway boundaries.

## Folding Rule

- helper and leaf-only symbols attached to a retained capability are folded into the owning capability node
- folded metadata remains available for drill-down / leaf views

## Contract Edge Filtering

The default architecture view ignores low-semantic contracts such as:

- `str`, `string`, `int`, `number`, `bool`, `boolean`, `float`
- `dict`, `list`, `object`, `Any`, `unknown`
- `JSON`, `Request`, `Response`, `Path`
- `Dict[str,Any]`, `Optional[str]`, `Optional[int]`, `List[str]`, `List[Any]`

Only semantically meaningful domain or system contracts are used as primary architecture edges by default.

## Path Policy

Default path suppression applies to architecture/capability parsing, including:

- `tests`, `test`
- `schemas`, `schema`
- `models`, `model`
- `entities`, `entity`
- `dto`, `vo`
- `types`, `types.py`
- `migrations`, `alembic/versions`

## Default View Behavior

- default scan mode: `capability`
- default visualizer view: `architecture`
- isolated non-critical capability nodes are hidden by default
- `leaf` remains available explicitly for debug and deep inspection

## Output Separation

- `.triadmind/leaf-map.json` stores the full leaf implementation map.
- `.triadmind/triad-map.json` stores the promoted architecture/capability map.
- parser flow is `buildCandidate -> classifyCandidate -> suppress/fold/promote -> write map`.
- `sync --scan-mode leaf` is an explicit diagnostic override; default sync writes a capability main map.

## Current Implementation Mapping

This spec is implemented through:

- `config.ts`
- `.triadmind/config.json`
- `treeSitterParser.ts`
- `analyzer.ts`
- `visualizer.ts`
- `sync.ts`
- `cli.ts`

These defaults can still be overridden through project configuration when a repository needs narrower or broader visibility.
