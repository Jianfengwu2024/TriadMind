# TriadMind 用户指南

这份指南面向第一次接触 TriadMind 的开发者，目标很简单：

> 先看拓扑，再改代码；先过门禁，再合并。

TriadMind 不是“无人驾驶写码器”，而是一个多语言工程副驾驶，帮助你把需求、结构、运行链路和治理门禁串成一条稳定流程。

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

TriadMind 主要负责四件事：

1. 生成能力拓扑：`triad-map.json` / `leaf-map.json`
2. 生成运行时拓扑：`runtime-map.json` / `runtime-visualizer.html`
3. 建立交叉映射：`view-map.json`
4. 执行质量门禁：`verify` / `govern ci`

如果你只想记住一条主线，请记这个：

```bash
triadmind sync --force
triadmind runtime --visualize --view full
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

- Windows 如果只有 `bash.exe` 启动器、但没有可用 WSL `/bin/bash`，请直接使用 `.ps1` 或 `.cmd`

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
- `runtime -> capability -> leaf` 是否能追通
- 是否出现 diagnostics / ghost / unmatched route

### 第三步：生成协议

```bash
triadmind plan --no-open --view architecture
```

### 第四步：按协议落地

```bash
triadmind apply
```

### 第五步：严格校验

```bash
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

规则只有一条：

> `verify` 或 `govern` 失败，就先停下修结构，不继续堆实现。

---

## 5. 关键工件怎么看

### 能力层

- `.triadmind/triad-map.json`：主能力图
- `.triadmind/leaf-map.json`：实现细节图
- `.triadmind/visualizer.html`：能力可视化

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
- Phase-2 再纳入 `agent / cli / workflow / 其它域`
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

### Q1：为什么不是直接改代码？

因为 TriadMind 先确认能力结构、运行链路和影响范围，避免“代码改对了，架构改坏了”。

### Q2：`view-map` 有什么用？

它回答一个大问题：

> 运行时看到的节点，能不能稳定解释回 capability，再解释回 leaf？

这对多语言工程尤其重要。

### Q3：项目目录和示例不一样怎么办？

先改 `.triadmind/profile.json`，不要先改核心源码。

### Q4：`verify` 或 `govern` 失败怎么办？

先修 diagnostics、映射一致性、ghost 治理或 runtime 提取问题；不要一边失败一边继续开发。

---

## 10. 最小心智模型

把 TriadMind 当成三层系统：

1. `triad / leaf`：系统有什么能力
2. `runtime / view-map`：这些能力在运行时如何连接、能否解释到实现
3. `verify / govern`：这次改动是否达标

只要你稳定执行这条链路，TriadMind 就已经在帮助你驾驭工程：

```bash
triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```
