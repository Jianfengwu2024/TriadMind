# TriadMind Capability Topology Spec v0.1

## Background

Current TriadMind output can still drift toward a method-leaf graph instead of an architecture-capability graph.

Typical issues:

- nodes are too fine-grained
- `problem` semantics degrade into `execute xxx flow`
- `__repr__`, schema hooks, migrations, and helpers pollute the main graph
- many peripheral isolated points do not help architecture understanding
- generic contracts create false hubs

## Goal

- generate a capability-topology graph by default, not a function/method graph
- make the main graph serve architecture understanding, reuse analysis, and capability-collaboration analysis
- support drill-down from capability graph to leaf implementation graph
- keep the default topology of large projects within a readable scale

## Non-Goals

- not a full call graph
- not a full import graph
- not a 100% runtime-binding reconstruction
- not a complete leaf-detail display in the main graph

## Core Concepts

### Leaf Node

Function / method / low-level implementation unit.

### Capability Node

A functional unit that can be independently understood, called, evolved, tested, monitored, retried, or replaced.

### Architecture View

Shows capability nodes and high-value relations only.

### Leaf View

Shows leaf nodes for debugging and troubleshooting.

### Projection

The process of projecting/aggregating a leaf collection into a capability collection.

## Capability Node Definition

A candidate unit should satisfy at least two of the following:

- provides a clear external function
- has stable input/output contracts
- is called by multiple upstreams or lies on a workflow-critical path
- can fail, audit, replace, retry, or monitor independently
- owns orchestration, domain decision, resource access, or external interaction responsibilities

## Default Capability Node Types

- Interface Capability: API endpoint / CLI command / RPC handler / event consumer
- Service Capability: application service / domain service / use-case action
- Workflow Capability: workflow stage / orchestration step / pipeline stage
- Execution Capability: node / tool / worker / operator / kernel entry
- Adapter Capability: DB / storage / queue / model / filesystem / network gateway
- Policy Capability: rule decision / planner / permission check / route selector

## Default Non-Capability Nodes

- test functions and test classes
- private helpers
- `build_*`, `parse_*`, `format_*`, `normalize_*`, `sanitize_*`, `validate_*`
- getters / setters / path builders / cache-key builders
- pure DTO / Schema / Model / Type / Enum
- migration `upgrade` / `downgrade`
- magic methods like `__repr__`, `__getattr__`, `__enter__`
- framework-internal hooks such as pydantic schema hooks

## View Requirements

- default view must be `architecture`
- leaf view must be explicit
- hide by default in the main graph:
  - isolated leaf nodes
  - weak relations driven only by generic contracts
  - pure technical noise nodes
- support drill-down from a capability to its aggregated leaf set

## Scan Modes

- `leaf`: existing fine-grained mode
- `capability`: new default mode
- `module`: module-level projection
- `domain`: domain-level projection

## Capability Recognition Rules

Prefer:

- public API handlers
- service primary methods
- workflow/task orchestration entries
- `execute` / `run` / `handle` / `process` / `apply` / `dispatch`
- external system gateway entries

Fold helpers into the owning capability:

- `_build_*`
- `_parse_*`
- `_validate_*`
- `_format_*`
- `_load_*`
- `_save_*`
- `_resolve_*`
- `_collect_*`

These helper leaves remain internal implementation details and do not appear independently in the main graph.

## Naming Rules

`problem` must not always degrade into `execute xxx flow`.

Prefer deriving `problem` from:

- route / command / event name
- class responsibility
- docstring
- decorators / annotations
- directory semantics
- primary method semantics

If no strong semantic label can be found, fallback is allowed but should be explicitly marked as `low_semantic_name`.

## Edge Rules

Main graph keeps only high-value relations:

- capability calls capability
- capability orchestrates capability
- capability consumes capability output
- capability accesses adapter capability
- workflow predecessor / successor dependencies
- policy decision target relations

Ignore or down-rank generic contracts by default:

- `str`
- `int`
- `bool`
- `float`
- `dict`
- `list`
- `Any`
- `object`
- `Dict[str, Any]`
- `Optional[str]`
- `JSON`
- `Response`
- `Request`

## Isolated Capability Policy

- isolated leaves may exist
- architecture view hides isolated capabilities by default unless:
  - it is an external entrypoint
  - it is an important adapter
  - it is explicitly marked as critical

Default:

```json
{
  "visualizer": {
    "showIsolatedCapabilities": false
  }
}
```

## Config Draft

```json
{
  "parser": {
    "scanMode": "capability",
    "capabilityThreshold": 4,
    "entryMethodNames": [
      "execute", "run", "handle", "process", "dispatch", "apply", "invoke", "plan"
    ],
    "excludeNodeNamePatterns": [
      "^test_",
      "^_",
      "^(get|set|build|parse|format|normalize|sanitize|validate)_",
      "^__.*__$",
      "^(upgrade|downgrade)$"
    ],
    "excludePathPatterns": [
      "tests",
      "test",
      "schemas",
      "models",
      "migrations",
      "alembic/versions",
      "node_modules",
      "venv",
      ".venv",
      ".next",
      "__pycache__"
    ],
    "genericContractIgnoreList": [
      "str", "string", "int", "number", "bool", "boolean",
      "float", "dict", "object", "list", "array", "Any",
      "Dict[str,Any]", "Optional[str]", "JSON", "Request", "Response"
    ]
  },
  "visualizer": {
    "defaultView": "architecture",
    "showIsolatedCapabilities": false,
    "maxPrimaryEdges": 1500,
    "fastFingerprintThreshold": 8
  }
}
```

## Output Model Draft

- `leafNodes`
- `capabilityNodes`
- `capabilityEdges`
- `capabilityToLeafMap`
- `suppressedLeaves`
- `suppressedEdges`
- `viewMetadata`

## Algorithm Draft

1. scan leaf nodes
2. filter noisy leaves
3. identify capability candidates from entry/responsibility rules
4. fold helper leaves into capabilities
5. project leaf-level edges into capability-level edges
6. filter weak edges and generic-contract edges
7. output architecture view by default

## Backward Compatibility

- keep existing `leaf` mode
- existing commands remain unchanged
- default behavior changes:
  - `triadmind init/sync/plan` should generate capability topology by default
- new switches:
  - `--view leaf`
  - `--scan-mode leaf`
  - `--show-isolated`
  - `--full-contract-edges`

## Acceptance Criteria

- for medium/large repositories, default main-graph node count should be significantly lower than leaf-graph count
- main graph should not show:
  - `__repr__`
  - `__getattr__`
  - schema hooks
  - migration `upgrade` / `downgrade`
  - large volumes of `build_` / `parse_` / `format_` / `validate_`
- `problem` should be responsibility-readable by default
- the main graph should clearly show system entry, core service, orchestration, execution, and adapter layers

## Priority

### P0

- noise-node filtering
- default architecture view
- generic-contract down-ranking
- hidden isolated capabilities

### P1

- capability aggregation
- improved capability naming
- drill-down leaf view

### P2

- domain/module projection
- configurable aggregation policies
- language/framework-specific recognizers

## One-Line Summary

TriadMind should answer “what capabilities exist in the system, and how they collaborate”, not merely “what methods exist in the repository”.
