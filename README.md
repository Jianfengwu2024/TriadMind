# TriadMind Core

TriadMind Core 是一个把“顶点三元法”落成工程工作流的核心引擎。

它的重点不是让用户去记 CLI，而是让 AI 助手理解：

```text
@triadmind = 一个可静默调用的架构工作流入口
```

---

## Parser Filtering Spec v0.2

TriadMind now ships a stricter default architecture filter so the main graph answers:

- what capabilities exist
- how capabilities collaborate
- where orchestration / service / adapter boundaries live

Default architecture / capability view now suppresses:

- magic methods and private symbols
- helper verbs such as `get_*`, `set_*`, `build_*`, `parse_*`, `format_*`, `normalize_*`, `sanitize_*`, `validate_*`
- extended helper verbs such as `ensure_*`, `create_*`, `load_*`, `save_*`, `list_*`, `collect_*`, `resolve_*`, `prepare_*`, `read_*`, `write_*`, `convert_*`, `sync_*`, `merge_*`, `filter_*`, `check_*`, `infer_*`, `guess_*`
- schema / model / entity / dto / vo / type artifacts under matching paths
- test artifacts and migrations
- generic contract edges such as `str`, `int`, `dict`, `Any`, `Request`, `Response`, `Path`

Default capability retention now favors:

- `execute`, `run`, `handle`, `process`, `dispatch`, `apply`, `invoke`, `plan`, `schedule`, `orchestrate`
- public API handlers
- workflow stage entrypoints
- execution / operator entrypoints
- adapter / gateway boundaries

Topology outputs are now split by default:

- `.triadmind/leaf-map.json` keeps the full leaf-level implementation map for drill-down/debugging.
- `.triadmind/triad-map.json` keeps the architecture/capability map consumed by plan/apply/visualizer.
- `.triadmind/runtime-map.json` keeps the runtime topology graph for request-flow / workflow / resource analysis.
- `.triadmind/runtime-diagnostics.json` records extractor warnings/errors without breaking the CLI.
- `.triadmind/runtime-visualizer.html` renders the runtime topology review graph.
- `triadmind sync --scan-mode leaf` can still explicitly generate a leaf main map for diagnostics.
- `triadmind sync --scan-mode capability` restores the default architecture map.

Reference: `parser-filtering-spec-v0.2.md`

## 核心理念

TriadMind 不鼓励“直接写代码”，而是要求先走：

```text
需求
-> Macro-Split
-> Meso-Split
-> Micro-Split
-> draft-protocol.json
-> visualizer.html
-> apply
-> implementation-handoff.md
```

Runtime topology is now a separate built-in pipeline:

```text
triadmind capability / triad-map
  -> 系统有哪些能力

triadmind runtime / runtime-map
  -> 能力在运行时如何协作

triadmind protocol / apply
  -> 如何安全修改系统
```

协议层只允许三种动作：

- `reuse`
- `modify`
- `create_child`

默认优先级永远是：

```text
reuse > modify > create_child
```

---

## 用户界面不是 CLI

TriadMind 的真实用户界面应该是 AI 助手里的这些指令：

```text
@triadmind init
@triadmind 你的需求
@triadmind macro
@triadmind meso
@triadmind micro
@triadmind finalize
@triadmind plan
@triadmind apply
@triadmind renormalize
@triadmind heal
@triadmind handoff
```

也就是说：

- CLI 是底层引擎
- `@triadmind` 才是用户操作面

---

## 现在推荐的使用方式

## 1. 最常用：一句话静默流

直接在 AI 助手里说：

```text
@triadmind 在前端新增一个导出按钮，能把当前状态保存为 CSV
```

理想流程是：

```text
读 triad-map
-> 自动拆 Macro / Meso / Micro
-> 自动生成协议
-> 自动生成 visualizer
-> 审核后 apply
-> 生成 handoff
```

---

## 2. 半自动审核流

如果你想自己控制收口和审核：

```text
@triadmind 在前端新增一个导出按钮，能把当前状态保存为 CSV
@triadmind finalize
@triadmind plan
@triadmind apply
```

---

## 3. 严格三元拆分流

如果你想强制分阶段：

```text
@triadmind 需求：在前端新增一个导出按钮，能把当前状态保存为 CSV
@triadmind macro
@triadmind meso
@triadmind micro
@triadmind finalize
@triadmind plan
@triadmind apply
```

---

## 4. 旧代码治理流

如果你面对的是历史包袱、循环依赖、粘连模块：

```text
@triadmind renormalize
```

这一步现在不是“只分析”，而是会生成完整治理工具包：

- `renormalize-protocol.json`
- `renormalize-report.md`
- `renormalize-task.md`
- `renormalize-visualizer.html`

也就是说，**renormalization 已经工具化了**。

---

## 5. 运行时修复流

发生错误时：

```text
@triadmind heal
```

或者：

```text
@triadmind heal: TypeError: Cannot read properties of undefined ...
```

TriadMind 会把错误映射回拓扑节点，再生成修复协议或修复提示。

---

## 当前能力

- 严格协议校验：`zod` 守卫 `draft-protocol.json`
- 多轮拆分：`macro / meso / micro / finalize`
- 拓扑审核：`visualizer.html`
- 运行时拓扑：`runtime-map.json` + `runtime-visualizer.html`
- 多语言适配：TypeScript / JavaScript / Python / Go / Rust / C++ / Java
- 统一 AST 路径：默认走 Tree-sitter
- 功能代码扫描：默认只扫描前端 / 后端功能目录，避免测试、脚本、环境和第三方依赖污染拓扑图
- 强排除黑名单：数据库 / migrations / tests / scripts / env / vendor 永久不进入拓扑扫描
- Python `capability` 模式：优先抽取 service / node / workflow / handler 级能力节点，而不是把每个辅助方法都扫成叶子
- JavaScript `capability` 模式：优先抽取 service / controller / handler / workflow 级能力节点，并把类内 helper 折叠进主 pipeline
- TypeScript / Java `capability` 模式：同样支持主入口识别、helper 折叠和业务类型优先连边
- Go / Rust / C++ `capability` 模式：同样支持 receiver / impl / class 级能力聚合与 `*_pipeline` 折叠
- 通用类型降权：`str` / `int` / `dict` / `list` / `Any` 这类契约默认不再参与拓扑连边
- Ghost State Scanner：识别隐式依赖
- 纯 JSON 拓扑分析：blast radius / cycle / drift / renormalize
- Maya 指纹：Topology -> Young Partition -> Maya Sequence -> Maya-ID
- 运行时自愈：`heal`
- 安全快照：`snapshot / rollback`

---

## `.triadmind/` 里最重要的文件

- `triad-map.json`：当前项目拓扑图
- `draft-protocol.json`：待执行协议
- `last-approved-protocol.json`：最后一次成功执行的协议
- `visualizer.html`：拓扑审核图
- `runtime-map.json`：运行时拓扑图
- `runtime-diagnostics.json`：运行时提取诊断
- `runtime-visualizer.html`：运行时拓扑审核图
- `implementation-prompt.md`：AI 静默工作提示
- `implementation-handoff.md`：进入实现阶段的交接文件
- `renormalize-task.md`：旧代码重整化任务书
- `renormalize-visualizer.html`：旧代码重整化审核图

---

## 你现在最该记住的 6 句

```text
@triadmind init
@triadmind 你的需求
@triadmind finalize
@triadmind plan
@triadmind apply
@triadmind renormalize
```

`@triadmind init` now bootstraps both the capability map and the runtime topology map by default.
`@triadmind sync` now refreshes both maps by default as well.
Runtime extraction is best-effort during `init` / `sync`: permission-restricted or oversized paths become diagnostics instead of failing the whole command.

---

## 手册

更完整的用户视角说明见：

- `user guide.md`

---

## 一句话总结

TriadMind Core 现在的正确理解不是：

```text
一个命令行工具
```

而是：

```text
一个被 AI 助手通过 @triadmind 静默调用的拓扑架构引擎
```

---

## TODO: Recursive Renormalization

当前 `@triadmind renormalize` 已经工具化，但暂未实现“单节点下游连接大于等于 3 时，自动做左右分支重划分”的递归治理能力。

- 当前已实现：环 / 强连通分量折叠为 macro node
- 当前未实现：高扇出节点的左右分支重整
- 当前占位入口：`@triadmind renormalize --deep` / `@triadmind converge` 会生成 `.triadmind/converge-task.md`
- 目标形态：从最外层到最内层逐层收敛，而不是一次性激进拆分
- 预期机制：每一轮只治理当前层级的过载节点，然后重新计算 `blast radius / cycles / drift`
- 最终目标：把旧代码的高扇出拓扑收敛成稳定的三元左右分支树

建议后续预留的命令入口：

```text
@triadmind renormalize --deep
```

或：

```text
@triadmind converge
```

---

## 2026-04 RHEOS Hardening

基于 `RHEOS` 项目的实测，TriadMind 现在新增了以下默认保护：

- 扫描容错内置化：递归扫描默认跳过 `node_modules`、`.next`、`venv`、`.venv`、`__pycache__`、`.pytest_cache`、`logs`、`uploads`、`fastgpt_data`，并对 `EACCES` / `EPERM` / `ENOENT` 直接 `skip`。
- 默认能力粒度：`parser.scanMode` 默认改为 `capability`，并补充支持 `module`。
- 通用类型降噪：新增 `parser.genericContractIgnoreList`，默认忽略 `str`、`string`、`int`、`bool`、`dict`、`any`、`Dict[str,Any]`、`Optional[str]` 这类低语义契约边。
- 可视化性能保护：新增 `visualizer.fastMode`、`visualizer.strictFingerprint`、`visualizer.maxFingerprintOwners`、`visualizer.maxFingerprintNodes`、`visualizer.fingerprintTimeoutMs`，默认跳过同步 per-owner 严格 Maya 指纹，避免大图生成卡死。
- 默认主视图：`visualizer.defaultView` 现在默认是 `architecture`，默认隐藏左右分支和非关键孤立 capability。
- 配置先于扫描：`.triadmind/config.json` 的排除和降噪配置，现在会在语言探测、manifest 构建、parser walk、polyglot walk 中统一生效。

推荐配置：

```json
{
  "parser": {
    "scanMode": "capability",
    "ignoreGenericContracts": true,
    "genericContractIgnoreList": [
      "str",
      "string",
      "int",
      "bool",
      "boolean",
      "dict",
      "any",
      "Dict[str,Any]",
      "Optional[str]",
      "Optional[int]",
      "Request",
      "Response",
      "Path"
    ]
  },
  "visualizer": {
    "defaultView": "architecture",
    "showIsolatedCapabilities": false,
    "maxPrimaryEdges": 1500,
    "maxContractEdges": 1200,
    "fastMode": true,
    "strictFingerprint": false,
    "fastFingerprintThreshold": 0,
    "fastMayaThreshold": 0,
    "maxFingerprintNodes": 8,
    "maxFingerprintOwners": 100,
    "fingerprintTimeoutMs": 50,
    "maxRenderNodes": 400
  }
}
```

Visualizer performance defaults:

- `fastMode: true` keeps HTML generation on the quick path.
- `strictFingerprint: false` skips expensive per-owner canonical Maya normalization by default.
- `maxFingerprintOwners` and `maxFingerprintNodes` cap local fragment work.
- Skipped feature fingerprints show a fast-mode message in the side panel instead of blocking HTML output.

---

## Capability Node Standard

TriadMind now treats a capability node as:

- a functional unit the system can call, evolve, test, monitor, retry, or replace
- not a raw function node, not a pure type node, and not a generic container class

Default scan policy:

- default mode is `capability`
- default visualizer view is `architecture`
- isolated non-critical capability nodes are hidden by default
- `leaf` is for local debugging only
- `module` is a real file/module aggregation view
- `domain` is a real bounded-context aggregation view

Default promotion signals:

- external entrypoints such as API handlers, CLI commands, RPC/message consumers
- service / workflow / handler / controller / adapter / tool style containers
- primary methods such as `execute`, `run`, `handle`, `process`, `dispatch`, `apply`, `invoke`, `plan`, `schedule`, `orchestrate`
- candidates with meaningful non-generic contracts
- candidates with observable ghost/external dependency access

Default suppression signals:

- helper-style names matched by `parser.excludeNodeNamePatterns`
- tests and private helpers
- pure generic contracts like `str`, `int`, `dict`, `Any`, `Optional[str]`, `Optional[int]`, `Request`, `Response`, `Path`

The default configuration now exposes:

```json
{
  "parser": {
    "scanMode": "capability",
    "capabilityThreshold": 4,
    "entryMethodNames": [
      "execute",
      "run",
      "handle",
      "process",
      "dispatch",
      "apply",
      "invoke",
      "plan",
      "schedule",
      "orchestrate"
    ],
    "excludeNodeNamePatterns": [
      "^(__.*__|_(?!_).*)$",
      "^(test_.+)$",
      "^(get|set|build|parse|format|normalize|sanitize|validate|ensure|create|load|save|list|collect|resolve|prepare|read|write|convert|sync|merge|filter|check|infer|guess)_.+$",
      "^__.*__$",
      "^(upgrade|downgrade)$"
    ],
    "excludePathPatterns": [
      "tests",
      "test",
      "schema",
      "schemas",
      "model",
      "models",
      "entity",
      "entities",
      "dto",
      "vo",
      "types",
      "types.py",
      "migrations",
      "alembic/versions",
      "__pycache__",
      "node_modules",
      "venv",
      ".venv",
      ".next",
      "dist",
      "build"
    ]
  },
  "visualizer": {
    "defaultView": "architecture",
    "showIsolatedCapabilities": false,
    "maxPrimaryEdges": 1500,
    "fastMode": true,
    "strictFingerprint": false,
    "fastFingerprintThreshold": 0,
    "maxFingerprintNodes": 8,
    "maxFingerprintOwners": 100,
    "fingerprintTimeoutMs": 50
  }
}
```

The formal default-behavior specs are tracked in `capability-topology-spec.md` and `parser-filtering-spec-v0.2.md`.

Architecture view behavior:

- hides `left_branch` / `right_branch` nodes by default
- hides isolated non-critical capability nodes by default
- keeps producer-consumer and protocol edges between visible capabilities
- still allows drill-down into capability internals via node detail and focused inspection

Reviewer controls:

- `triadmind plan --view leaf` starts the review graph in leaf view
- `triadmind plan --show-isolated` keeps isolated capabilities visible
- `triadmind plan --full-contract-edges` disables contract-edge capping for deep inspection
- `triadmind runtime --view workflow --visualize` generates a workflow-focused runtime graph
- `triadmind runtime --view resources --visualize` focuses on DB/cache/object-store/tool dependencies
- `triadmind runtime --include-frontend --include-infra` enables frontend/API and infra extraction when needed
- `triadmind runtime --visualize --layout dagre --trace-depth 2` enables v2 interactive runtime graph defaults
- `triadmind runtime --visualize --layout leaf-force --hide-isolated` focuses on dense main paths in large graphs
- `triadmind runtime --visualize --theme leaf-like` aligns runtime visual style with leaf visualizer defaults
- capability visualizer now defaults to fast fallback unless strict fingerprint is explicitly requested
- the generated `visualizer.html` now includes `Architecture` / `Leaf` view toggle buttons in the UI

Semantic naming:

- low-signal defaults like `execute xxx capability` are now normalized into capability-oriented labels
- naming now prefers owner/module semantics, source-path context, method intent, and contract hints
- only unresolved generic cases fall back to `[low_semantic_name] ...`

Aggregation behavior:

- `capability`: emits concrete capability nodes
- `module`: first extracts capability nodes, then folds them into `Module.*` nodes by source file/module boundary
- `domain`: first extracts capability nodes, then folds them into `Domain.*` nodes by category root + first bounded-context segment

For very flat repositories with most code at project root, `domain` may intentionally collapse into a small number of high-level domains.
