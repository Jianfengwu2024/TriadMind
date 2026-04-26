# TriadMind 用户指南

这份指南面向第一次接触 TriadMind 的开发者，目标是让你用最少命令，把工程从“凭感觉改代码”升级到“先看拓扑、再做变更、最后过门禁”。

---

## 1. TriadMind 是什么

TriadMind 不是自动驾驶式编程器，而是一个**工程副驾驶**：

1. 帮你看清系统有哪些能力：`triad-map.json` / `leaf-map.json`
2. 帮你看清运行时如何协作：`runtime-map.json` / `runtime-visualizer.html`
3. 帮你判断这次改动能不能安全合并：`verify` / `govern ci`

一句话：

```text
先看图，再改代码；先过门禁，再合并。
```

---

## 2. 首次进入项目

在项目根目录执行：

```bash
triadmind init
triadmind bootstrap doctor --json
```

初始化后会得到这些核心文件：

- `.triadmind/triad-map.json`
- `.triadmind/leaf-map.json`
- `.triadmind/runtime-map.json`
- `.triadmind/runtime-diagnostics.json`
- `.triadmind/view-map.json`
- `.triadmind/view-map-diagnostics.json`
- `.triadmind/govern-policy.json`
- `.triadmind/verify-baseline.json`
- `.triadmind/profile.json`
- `AGENTS.md`
- `skills.md`

如果你只想初始化工作区、暂时不生成会话脚手架：

```bash
triadmind init --skip-bootstrap
```

---

## 3. 每个新终端窗口先做什么

推荐每开一个新窗口就执行一次 bootstrap。

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

这一步会自动完成：

- `triadmind sync --force`
- `triadmind runtime --visualize --view full`
- `triadmind plan --no-open --view architecture`
- `triadmind verify --strict --json`

结果会写到：

- `.triadmind/bootstrap-verify.json`

---

## 4. 日常开发的标准路径

### 第 1 步：刷新当前拓扑

```bash
triadmind sync --force
triadmind runtime --visualize --view full
```

### 第 2 步：补充覆盖率和交叉映射观察

```bash
triadmind coverage --json
triadmind view-map --json
```

这两步分别回答：

- `coverage`：源码文件里，哪些已经进入 triad / runtime / combined 视图
- `view-map`：运行时节点能否追到 capability，再追到 leaf

### 第 3 步：生成协议

```bash
triadmind plan --no-open --view architecture
```

### 第 4 步：按协议落地

```bash
triadmind apply
```

### 第 5 步：严格校验

```bash
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

只要 `verify` 或 `govern` 失败，就先修结构和诊断，不继续实现。

---

## 5. 你需要理解的几个核心工件

### 5.1 Capability / Leaf

- `.triadmind/triad-map.json`：主能力图
- `.triadmind/leaf-map.json`：实现细节图
- `.triadmind/visualizer.html`：主能力可视化页面

### 5.2 Runtime

- `.triadmind/runtime-map.json`：运行时节点与边
- `.triadmind/runtime-diagnostics.json`：运行时提取告警/信息
- `.triadmind/runtime-visualizer.html`：运行时图页面

### 5.3 Cross View

- `.triadmind/view-map.json`：`runtime ↔ capability ↔ leaf` 映射
- `.triadmind/view-map-diagnostics.json`：映射告警与完整率摘要

`view-map` 里你重点看三件事：

- `runtimeMatchRate`
- `capabilityLeafMatchRate`
- `endToEndTraceabilityRate`

### 5.4 Govern

- `.triadmind/govern-policy.json`：硬门禁策略
- `.triadmind/verify-baseline.json`：相对阈值基线
- `.triadmind/govern-report.json`：门禁结果
- `.triadmind/govern-audit.log`：审计轨迹

---

## 6. profile.json：项目如何注入自己的结构

TriadMind 的通用化入口是：

```text
.triadmind/profile.json
```

它解决的是“不同项目目录结构不同，但核心逻辑不应该写死”。

推荐这样理解：

- `categories`：你的业务分类和路径前缀
- `scanScopes`：你的 API / UI / CLI / agent / workflow 等抽象扫描语义
- `languageAdapters`：语言适配器覆盖
- `extractors`：额外 parser/runtime 抽取器

示意：

```json
{
  "schemaVersion": "1.0",
  "categories": {
    "dialogue_core": ["flows/dialogue"],
    "surface_web": ["surface/http"],
    "terminal_lane": ["ops/cli"]
  },
  "scanScopes": [
    { "name": "dialogue", "kind": "agent", "match": { "pathPrefixes": ["flows/dialogue"] } },
    { "name": "surface", "kind": "api", "match": { "pathPrefixes": ["surface/http"] } },
    { "name": "terminal", "kind": "cli", "match": { "pathPrefixes": ["ops/cli"] } }
  ]
}
```

原则只有一个：

> 项目差异写到 profile，核心只消费抽象接口。

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

如果你只想记住一条“一键验收命令”，就用：

```bash
triadmind bootstrap doctor --json && triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 9. 常见问题

### Q1：为什么不是直接改代码？

因为 TriadMind 要先确认能力结构、运行链路和影响范围，避免“代码改对了，架构改坏了”。

### Q2：view-map 有什么用？

它能回答一个大问题：

> 运行时看到的节点，能不能解释到 capability，再解释到 leaf？

这对多语言工程尤其重要。

### Q3：项目目录和示例不同怎么办？

不要改核心代码，先改 `.triadmind/profile.json`。

### Q4：verify 或 govern 失败怎么办？

失败即停止实现，先修 diagnostics、映射一致性、ghost 治理或 runtime 提取问题。

---

## 10. 最小心智模型

把 TriadMind 当成三层系统：

1. `triad / leaf`：系统有什么能力
2. `runtime / view-map`：这些能力在运行时如何连接、能否解释到底
3. `verify / govern`：这次改动是否达标

如果你能稳定执行下面这条链路，TriadMind 就已经在帮你驾驭工程了：

```bash
triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```
