# TriadMind 用户指南

这份指南面向第一次接触 TriadMind 的开发者，目标很简单：

> 先看拓扑，再改代码；先过门禁，再合并实现。

TriadMind 不是“无人驾驶写码器”，而是一个多语言工程副驾驶。它帮助你把需求、结构、运行链路和治理门禁串成一条稳定流程。

支持语言：
- Python
- TypeScript
- JavaScript
- Rust
- Go
- Java
- C++

---

## 1. 它到底做什么

TriadMind 主要负责五件事：

1. 生成能力拓扑：`triad-map.json` / `leaf-map.json`
2. 生成运行时拓扑：`runtime-map.json` / `runtime-visualizer.html`
3. 在协议前先做三元化诊断：判断当前节点应做 `aggregate / split / renormalize`
4. 建立交叉映射：`view-map.json`
5. 执行质量门禁：`verify` / `govern ci`

如果你只想记住一条主线，请记这个：

```bash
triadmind sync --force
triadmind runtime --visualize --view full
triadmind triadize --confirm
triadmind plan --no-open --view architecture
triadmind apply
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 2. 首次进入项目

在项目根目录执行：

```bash
triadmind init
triadmind bootstrap doctor --json
```

初始化后会自动准备：

- `.triadmind/triad-map.json`
- `.triadmind/leaf-map.json`
- `.triadmind/runtime-map.json`
- `.triadmind/runtime-diagnostics.json`
- `.triadmind/view-map.json`
- `.triadmind/govern-policy.json`
- `.triadmind/verify-baseline.json`
- `.triadmind/profile.json`
- `AGENTS.md`
- `skills.md`
- `.triadmind/session-bootstrap.sh`
- `.triadmind/session-bootstrap.ps1`
- `.triadmind/session-bootstrap.cmd`

如果只想初始化工作区、暂时跳过会话脚手架：

```bash
triadmind init --skip-bootstrap
```

---

## 3. 每个新终端先做什么

推荐每次开新窗口先跑一次 bootstrap。

Linux / macOS：

```bash
bash .triadmind/session-bootstrap.sh
```

Windows PowerShell：

```powershell
.\.triadmind\session-bootstrap.ps1
```

Windows CMD：

```bat
.triadmind\session-bootstrap.cmd
```

它会自动执行：

1. `triadmind sync --force`
2. `triadmind runtime --visualize --view full`
3. `triadmind plan --no-open --view architecture`
4. `triadmind verify --strict --json`

结果会写入：

- `.triadmind/bootstrap-verify.json`

注意：

- Windows 如果只有 `bash.exe` 启动器、但没有可用的 WSL `/bin/bash`，请直接使用 `.ps1` 或 `.cmd`

---

## 4. 日常开发标准路径

### 第一步：同步结构

```bash
triadmind sync --force
triadmind runtime --visualize --view full
```

### 第二步：看覆盖率和映射

```bash
triadmind coverage --json
triadmind view-map --json
```

你主要看四件事：

- 哪些源码文件进入了 triad
- 哪些源码文件进入了 runtime
- `runtime -> capability -> leaf` 是否能追踪
- 是否出现 diagnostics / ghost / unmatched route

### 第三步：先做三元化诊断

```bash
triadmind triadize
# 或直接确认当前主提案
triadmind triadize --confirm
```

这一步的目标不是立刻写协议，而是先让 AI 助手明确指出：

- 现在是对哪个节点做顶点三元化
- 当前建议动作是 `aggregate`、`split` 还是 `renormalize`
- 为什么是这个动作，以及它会影响哪些节点

如果你跳过显式 `triadize`，`plan` / `apply` 也会自动先做这一步，并要求确认。

现在 `macro-split.json`、`meso-split.json`、`micro-split.json` 会显式写出：

- `triadizationFocus`
- `recommendedOperation`

这两个字段的意义是：

- `triadizationFocus`：本轮演进围绕的唯一顶点
- `recommendedOperation`：本轮只允许推进的唯一动作

也就是说，Macro / Meso / Micro 三轮拆分必须始终围绕同一个已确认焦点推进。

### 焦点门禁：系统为什么会拦你

在进入 `plan`、`apply`、`invoke --apply` 之前，TriadMind 会执行一层硬门禁。它会检查：

1. `draft-protocol.json` 和 `micro-split.json` 是否围绕同一个 `triadizationFocus`
2. 焦点类是否真的形成了“顶点 + 左支 + 右支”的闭环
3. 焦点方法是否真的落在该类的 `dynamicLeftBranch`

你会遇到三类典型结果：

- `protocol_focus_alignment`
  含义：协议焦点漂移了。通常是 `draft-protocol.json` 和 `micro-split.json` 指向了不同节点或不同动作。
  修复方式：先把所有产物重新对齐到同一个 `triadizationFocus -> recommendedOperation`。

- `triad_focus_closure`
  含义：焦点没有闭环。通常是焦点类缺少 `staticRightBranch`、缺少 `dynamicLeftBranch`，或焦点方法没有出现在左支里。
  修复方式：回到焦点类，把右支约束和左支动作补齐，再继续汇总协议。

- `mixed`
  含义：既漂移，又没闭环。
  修复方式：先统一焦点，再补类级闭环。不要同时横向扩散问题。

系统会同时给出：

- `summary`：一句话说明当前阻塞
- `repairTarget`：现在优先修哪个节点 / 类 / 方法
- `details`：具体漂移或闭环缺口

这意味着：

> 只要焦点门禁没过，就不要继续堆协议，不要继续堆实现。

### 第四步：生成协议

```bash
triadmind plan --no-open --view architecture
```

`plan` 会做三件事：

1. 校验 `draft-protocol.json` 结构是否合法
2. 校验焦点是否一致、是否闭环
3. 生成 `visualizer.html` 供你审核

只要焦点门禁失败，`plan` 会直接拒绝继续。

### 第五步：按协议落地

```bash
triadmind apply
```

`apply` 不会绕过焦点门禁。只要当前协议存在以下问题，它就会直接失败：

- 偷偷换了焦点节点
- 偷偷换了推荐动作
- 焦点类左右分支没闭环
- 焦点方法没有落在正确的类级左支里

### 第六步：严格校验

```bash
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

`verify` 现在会直接报出这些“三元不完整”问题：

- `left_only_vertices`：只有左支，没有右支
- `right_only_vertices`：只有右支，没有左支
- `empty_vertices`：顶点为空
- `scale_mixing_vertices`：同一顶点里混入编排尺度和 helper 尺度
- `triad_completeness`：总体三元完整性失败
- `protocol_focus_alignment`：协议焦点漂移
- `triad_focus_closure`：焦点类级闭环失败

规则只有一条：

> `verify` 或 `govern` 失败，就先停下修结构，不继续堆实现。

---

## 5. 关键工件怎么读

### 能力层

- `.triadmind/triad-map.json`：主能力图
- `.triadmind/leaf-map.json`：实现细节图
- `.triadmind/visualizer.html`：能力可视化

### 三元化诊断层

- `.triadmind/triadization-report.json`：当前轮次的三元化诊断报告
- `.triadmind/triadization-task.md`：待确认的三元化任务单
- `.triadmind/triadization-confirmation.json`：已确认的三元化演进方案
- `.triadmind/macro-split.json`：宏观挂载点与左右分支拆分
- `.triadmind/meso-split.json`：中观类与管道拆分
- `.triadmind/micro-split.json`：微观类级左右分支拆分
- `.triadmind/draft-protocol.json`：最终协议草案

重点关注：

- `triadizationFocus`
- `recommendedOperation`
- `repairTarget`
- `alignmentViolations`
- `closureViolations`

### 运行时层

- `.triadmind/runtime-map.json`：运行时节点与边
- `.triadmind/runtime-diagnostics.json`：运行时提取诊断
- `.triadmind/runtime-visualizer.html`：运行时可视化

### 交叉映射层

- `.triadmind/view-map.json`
- `.triadmind/view-map-diagnostics.json`

重点关注：

- `runtimeMatchRate`
- `capabilityLeafMatchRate`
- `endToEndTraceabilityRate`

### 治理层

- `.triadmind/govern-policy.json`
- `.triadmind/verify-baseline.json`
- `.triadmind/govern-report.json`
- `.triadmind/govern-audit.log`

---

## 6. `profile.json`：让 TriadMind 适配任何项目

TriadMind 的通用注入入口是：

```text
.triadmind/profile.json
```

你应该把“项目差异”写进这里，而不是改核心源码。

常用字段：

- `categories`：你的业务分类和路径前缀
- `scanScopes`：API / UI / CLI / agent / workflow 等抽象扫描域
- `languageAdapters`：按语言覆盖 adapter
- `extractors`：扩展 parser/runtime 抽取器
- `governance.coverageGates`：按项目声明 coverage 门禁

示例：

```json
{
  "schemaVersion": "1.0",
  "categories": {
    "frontend": ["frontend"],
    "backend": ["backend"]
  },
  "scanScopes": [
    { "name": "api", "kind": "api", "match": { "pathSegments": ["api", "routes", "transport"] } },
    { "name": "ui", "kind": "ui", "match": { "pathSegments": ["app", "pages", "components"] } }
  ],
  "governance": {
    "coverageGates": [
      { "target": "backend", "scope": "category", "metric": "combined", "op": "gte", "value": 0.8, "mustPass": true, "phase": "phase-1" },
      { "target": "frontend", "scope": "category", "metric": "combined", "op": "gte", "value": 0.6, "mustPass": true, "phase": "phase-1" }
    ]
  }
}
```

原则：

- Phase-1 先聚焦 `frontend + backend`
- Phase-2 再纳入 `agent / cli / workflow / 其他域`
- 核心 CLI 只消费抽象声明，不写死仓库目录名

---

## 7. 常用命令速查

### 同步与观察

```bash
triadmind sync --force
triadmind runtime --visualize --view full
triadmind coverage --json
triadmind view-map --json
```

### 协议驱动

```bash
triadmind triadize
triadmind triadize --confirm
triadmind plan --no-open --view architecture
triadmind apply
triadmind handoff
```

### Dream

```bash
triadmind dream
triadmind dream --json
triadmind dream review --json
triadmind dream visualize --open
```

默认行为：

- `triadmind dream` 等价于 `triadmind dream run`
- `triadmind dream --json` 等价于 `triadmind dream run --json`

### 门禁

```bash
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

### Bootstrap

```bash
triadmind bootstrap init
triadmind bootstrap init --force
triadmind bootstrap doctor --json
```

---

## 8. CI 最小推荐链路

```bash
triadmind bootstrap doctor --json
triadmind sync --force
triadmind runtime --visualize --view full
triadmind coverage --json
triadmind view-map --json
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

如果你只想记住一条一键验收命令：

```bash
triadmind bootstrap doctor --json && triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 9. 常见问题

### Q1：为什么不是直接改代码

因为 TriadMind 先确认能力结构、运行链路和影响范围，避免“代码改对了，架构改坏了”。

### Q2：`view-map` 有什么用

它回答一个大问题：

> 运行时看到的节点，能不能稳定解释回 capability，再解释回 leaf？

这对多语言工程尤其重要。

### Q3：项目目录和示例不一样怎么办

先改 `.triadmind/profile.json`，不要先改核心源码。

### Q4：`plan` / `apply` 被焦点门禁拦住怎么办

先看三件事：

1. `failureKind`
2. `summary`
3. `repairTarget`

然后按类型修：

- `protocol_focus_alignment`
  先统一 `draft-protocol.json`、`macro/meso/micro-split.json` 的 `triadizationFocus` 和 `recommendedOperation`

- `triad_focus_closure`
  回到焦点类，把 `staticRightBranch`、`dynamicLeftBranch` 和焦点方法补齐

- `mixed`
  先统一焦点，再补闭环，不要两边一起乱改

### Q5：`verify` 或 `govern` 失败怎么办

先修 diagnostics、映射一致性、ghost 治理、runtime 提取问题或三元闭环问题；不要一边失败一边继续开发。

---

## 10. 最小心智模型

把 TriadMind 当成三层系统：

1. `triad / leaf`：系统有什么能力
2. `runtime / view-map`：这些能力在运行时如何连接、能否解释到实现
3. `verify / govern`：这次改动是否达标

而在进入 `plan` / `apply` 之前，再记住一条更核心的前置原则：

> 先确认当前是对哪个顶点做三元化，以及它应做 `aggregate / split / renormalize` 中的哪一种；所有拆分和协议都必须围绕这个唯一焦点推进。

只要你稳定执行这条链路，TriadMind 就已经在帮助你驾驭工程：

```bash
triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```
