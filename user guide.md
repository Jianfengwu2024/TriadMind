# TriadMind 用户指南（UTF-8）

本指南面向第一次接触 TriadMind 的开发者，目标是让你用最少命令，把工程从“凭感觉改代码”升级到“拓扑驱动 + 治理门禁”。

---

## 1. TriadMind 是什么

TriadMind 是一个工程协作副驾驶，不是无人驾驶系统。  
它帮助你回答三件事：

1. 系统有哪些能力（Capability / Leaf）
2. 这些能力在运行时如何协作（Runtime Topology）
3. 这次改动是否可治理、可合并（Verify / Govern）

一句话：

```text
先看图，再改代码；先过门禁，再合并。
```

---

## 2. 首次使用（推荐）

在项目根目录执行：

```bash
triadmind init
```

会自动准备：

- `.triadmind/triad-map.json`
- `.triadmind/leaf-map.json`
- `.triadmind/runtime-map.json`
- `.triadmind/runtime-diagnostics.json`
- `.triadmind/govern-policy.json`
- `.triadmind/verify-baseline.json`
- `AGENTS.md`
- `skills.md`
- `.triadmind/session-bootstrap.sh`
- `.triadmind/session-bootstrap.ps1`
- `.triadmind/session-bootstrap.cmd`

如需跳过会话脚手架：

```bash
triadmind init --skip-bootstrap
```

---

## 3. 日常开发最优路径（6 步）

### 第 1 步：同步拓扑

```bash
triadmind sync --force
```

### 第 2 步：看运行链路

```bash
triadmind runtime --visualize --view full
```

### 第 3 步：生成协议草案

```bash
triadmind plan --no-open --view architecture
```

### 第 4 步：按协议落地

```bash
triadmind apply
```

### 第 5 步：质量校验

```bash
triadmind verify --strict --json
```

### 第 6 步：硬门禁（CI 同款）

```bash
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 4. 关键命令速查

### 4.1 拓扑与可视化

```bash
triadmind sync --force
triadmind runtime --visualize --view full
triadmind runtime --visualize --view workflow
triadmind runtime --visualize --view resources
```

### 4.2 协议驱动

```bash
triadmind plan --no-open --view architecture
triadmind apply
triadmind handoff
```

### 4.3 校验与治理

```bash
triadmind verify --json
triadmind verify --strict --json
triadmind govern check --json
triadmind govern ci --json
```

### 4.4 Bootstrap

```bash
triadmind bootstrap init
triadmind bootstrap doctor --json
```

---

## 5. Runtime 命令常用参数

```bash
triadmind runtime --visualize
triadmind runtime --view full
triadmind runtime --view workflow
triadmind runtime --view request-flow
triadmind runtime --view resources
triadmind runtime --view events
triadmind runtime --view infra
```

可选增强：

```bash
triadmind runtime --include-frontend
triadmind runtime --include-infra
triadmind runtime --framework fastapi
triadmind runtime --layout leaf-force
triadmind runtime --trace-depth 2
triadmind runtime --hide-isolated
triadmind runtime --theme leaf-like
triadmind runtime --max-render-edges 500   # 显式截断时才使用
```

默认不截断边，渲染边数应与 `runtime-map.json` 一致。

---

## 6. Dream 机制（架构“做梦”治理）

Dream 是“提案生成器”，不是自动改代码器。  
它会利用现有拓扑与指标，发现风险并给出治理建议。

### 6.1 Dream 产物

- `.triadmind/dream-report.json`
- `.triadmind/dream-proposals.json`
- `.triadmind/dream-diagnostics.json`
- `.triadmind/dream-state.json`
- `.triadmind/dream-auto-state.json`
- `.triadmind/dream.lock`
- `.triadmind/dream-daemon.pid.json`
- `.triadmind/dream-daemon-state.json`
- `.triadmind/dream-daemon.log`
- `.triadmind/dream-visualizer.html`

### 6.2 Dream 命令

```bash
triadmind dream run
triadmind dream run --json
triadmind dream run --mode idle
triadmind dream run --mode idle --force
triadmind dream run --visualize
triadmind dream auto --trigger sync
triadmind dream auto --trigger manual --force
triadmind dream review --json
triadmind dream visualize --open
```

### 6.3 Dream Daemon（v3）

```bash
triadmind dream daemon start
triadmind dream daemon status
triadmind dream daemon stop
```

说明：

- `start`：后台循环触发 idle Dream
- `status`：查看 daemon 是否在线、tick 次数、最近状态
- `stop`：停止 daemon

---

## 7. 配置入口

核心配置文件：

```text
.triadmind/config.json
```

重点配置段：

- `parser`：能力图扫描策略
- `runtime`：运行时拓扑抽取策略
- `visualizer`：可视化性能与降级策略
- `protocol`：协议置信度阈值
- `dream`：Dream 自动触发、锁超时、daemon 参数

---

## 8. CI 推荐顺序

```bash
triadmind bootstrap doctor --json
triadmind sync --force
triadmind runtime --visualize --view full
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 9. 常见问题

### Q1：runtime 抽取失败会不会导致 sync 崩溃？

不会。runtime 采用 best-effort，错误会写入 `runtime-diagnostics.json`，主流程继续。

### Q2：为什么要先 plan 再 apply？

因为 `plan` 会先输出可审阅协议和拓扑影响，能显著降低“代码改对了但架构改坏了”的风险。

### Q3：Dream 会不会直接改我代码？

不会。Dream 只生成提案和可审阅 protocol draft，最终仍由你决定是否落地。

---

## 10. 一条命令的最小心智模型

如果你只记住一条命令链，建议用：

```bash
triadmind sync --force && triadmind runtime --visualize --view full && triadmind verify --strict --json && triadmind govern ci --json
```

这条链路可以快速判断：**当前工程是否可治理、可继续安全演进**。
