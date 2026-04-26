# TriadMind Core

TriadMind Core 是一个把“拓扑先行”落地到工程实践的 CLI。
它的目标不是替代编码，而是把需求 -> 设计 -> 变更 -> 验证这条链路变成可审计、可回归、可门禁的流程。
它是通用多语言工具，支持 Python / TypeScript / JavaScript / Rust / Go / Java / C++ 工程。

---

## 1. 你最该先记住的结论

- `triadmind sync`：刷新能力拓扑（capability/leaf）
- `triadmind runtime`：刷新运行时拓扑（API/Service/Worker/Resource）
- `triadmind plan`：生成可审阅协议（draft protocol）
- `triadmind apply`：按协议改代码（而不是自由发挥）
- `triadmind dream run`：空闲式“做梦”体检，输出治理建议
- `triadmind verify`：质量指标校验
- `triadmind govern ci`：硬门禁（fail-closed）

一句话：

```text
先看图，再改代码；先过门禁，再合并。
```

---

## 2. 最简最优使用方式（作为用户推荐）

这是我认为 **最省心、最稳、最工程化** 的日常流程。

### 2.1 初始化（项目首次）

```bash
triadmind init
```

默认会准备：

- `.triadmind/triad-map.json`
- `.triadmind/leaf-map.json`
- `.triadmind/runtime-map.json`
- `.triadmind/view-map.json`
- `.triadmind/runtime-diagnostics.json`
- `.triadmind/govern-policy.json`
- `.triadmind/verify-baseline.json`
- `.triadmind/profile.json`
- `AGENTS.md`（TriadMind managed rules 区块）
- `skills.md`（会话 SOP）
- `.triadmind/session-bootstrap.sh`
- `.triadmind/session-bootstrap.ps1`
- `.triadmind/session-bootstrap.cmd`

如果你只想初始化 triad 工作区而跳过会话脚手架：

```bash
triadmind init --skip-bootstrap
```

也可以单独执行：

```bash
triadmind bootstrap init
triadmind bootstrap doctor --json
```

### 2.2 每次需求开发（推荐 6 步）

1) **先同步现状图谱**

```bash
triadmind sync --force
```

2) **看运行链路（必要时）**

```bash
triadmind runtime --visualize --view full
```

3) **产出协议**

```bash
triadmind plan --no-open --view architecture
```

4) **执行协议改动**

```bash
triadmind apply
```

5) **质量校验**

```bash
triadmind verify --strict --json --max-execute-like-ratio 0.10 --max-ghost-ratio 0.40 --max-unmatched-routes 22
```

6) **最终硬门禁（CI 同款）**

```bash
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

> 这套流程的关键优势：
> - 开发者脑中模型和系统真实拓扑一致
> - 变更可追溯（协议驱动）
> - 回归可自动化（verify + govern）

---

## 3. 输出工件说明

### 3.1 架构/能力层

- `.triadmind/triad-map.json`：能力图（主审阅图）
- `.triadmind/leaf-map.json`：叶子实现图（细节钻取）
- `.triadmind/visualizer.html`：能力可视化页面

### 3.2 运行时层

- `.triadmind/runtime-map.json`：运行时拓扑图
- `.triadmind/runtime-diagnostics.json`：提取诊断
- `.triadmind/runtime-visualizer.html`：运行时可视化页面
- `.triadmind/view-map.json`：`runtime ↔ capability ↔ leaf` 交叉映射
- `.triadmind/view-map-diagnostics.json`：映射诊断与完整率摘要

### 3.3 治理层（Hard Gate）

- `.triadmind/govern-policy.json`：硬门禁策略
- `.triadmind/verify-baseline.json`：基线（用于相对阈值）
- `.triadmind/govern-report.json`：门禁结果
- `.triadmind/govern-audit.log`：审计日志
- `.triadmind/govern-fixes.patch`：fix 模式输出的修复补丁建议

### 3.4 Dream 层（空闲治理建议）

- `.triadmind/dream-report.json`：本次 Dream 分析总报告
- `.triadmind/dream-proposals.json`：建议清单（含可审阅 protocol draft）
- `.triadmind/dream-diagnostics.json`：Dream 执行诊断
- `.triadmind/dream-state.json`：Dream 运行状态（idle gate 使用）
- `.triadmind/dream-auto-state.json`：自动触发计数与门禁状态
- `.triadmind/dream.lock`：自动触发互斥锁（防并发）
- `.triadmind/dream-daemon.pid.json`：daemon 进程元数据
- `.triadmind/dream-daemon-state.json`：daemon 心跳/状态
- `.triadmind/dream-daemon.log`：daemon 日志
- `.triadmind/dream-visualizer.html`：Dream 治理面板

---

## 4. 关键命令速查

### 4.1 同步与可视化

```bash
triadmind sync --force
triadmind runtime --view full --visualize
triadmind runtime --view workflow --visualize
triadmind runtime --view resources --visualize
```

### 4.2 协议驱动改造

```bash
triadmind plan --no-open --view architecture
triadmind apply
```

### 4.3 质量校验

```bash
triadmind coverage --json
triadmind view-map --json
triadmind verify --json
triadmind verify --strict --json
```

### 4.4 Dream 建议生成

```bash
triadmind dream
triadmind dream --json
triadmind dream run
triadmind dream run --json
triadmind dream run --mode idle
triadmind dream run --visualize
triadmind dream auto --trigger sync
triadmind dream auto --trigger manual --force
triadmind dream review --json
triadmind dream visualize --open
triadmind dream daemon start
triadmind dream daemon status
triadmind dream daemon stop
```

默认行为（v2）：

- `triadmind dream` 等价于 `triadmind dream run`
- `triadmind dream --json` 等价于 `triadmind dream run --json`
- `init/sync/runtime/plan/apply/verify/govern/trend` 会自动记一次 Dream 活动
- 达到 `minEventsBetweenRuns` 且满足时间门禁后，会自动触发一次 idle Dream
- 使用 `dream.lock` 做互斥，旧锁超时会自动回收（stale lock recovery）
- `dream.lock` 在检查超时前会先做 PID 存活探测：锁进程已退出时立即回收，不再被 `lockTimeoutMinutes` 长时间阻塞
- idle Dream 在高开销图遍历阶段采用分批让出事件循环（event-loop yielding），降低对前台任务的阻塞风险
- Dream proposal 的 `category` 会基于 `sourcePath + config.categories` 自动校验并修正；无法映射时回退为 `unknown` 并记录到 `.triadmind/dream-diagnostics.json`

### 4.5 治理门禁

```bash
triadmind govern check --policy .triadmind/govern-policy.json --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
triadmind govern fix --policy .triadmind/govern-policy.json --llm <provider:model> --max-iterations 3 --dry-run
```

### 4.6 会话脚手架（Bootstrap）

```bash
triadmind bootstrap init
triadmind bootstrap init --force
triadmind bootstrap doctor --json
```

跨平台启动当前会话（建议每个新终端窗口执行一次）：

```bash
# Linux / macOS
bash .triadmind/session-bootstrap.sh

# Windows PowerShell
.\.triadmind\session-bootstrap.ps1

# Windows CMD
.triadmind\session-bootstrap.cmd
```

仓库还提供可直接复用的会话脚本示例：

- `docs/tm-session.sh`
- `docs/tm-session.ps1`

### 4.7 Profile 注入（通用项目）

```text
.triadmind/profile.json
```

`profile.json` 是项目把“扫描域 / 分类 / 语言适配器 / 抽取器”注入 TriadMind 的主入口：

- `categories`：声明项目自己的分类与路径前缀
- `scanScopes`：声明 API / UI / CLI / agent / workflow 等抽象扫描语义
- `languageAdapters`：按语言覆盖默认 adapter
- `extractors`：挂接 parser/runtime 抽取扩展

推荐原则：

- 项目差异写进 `profile.json`
- 核心 CLI 只消费抽象接口，不写死仓库目录名
- 新项目优先复制并修改 `profile.json`，而不是改核心源码

`govern` 退出码：

- `0`: pass
- `2`: gate_fail
- `3`: policy_invalid
- `4`: artifact_missing
- `5`: metric_unavailable
- `6`: forbidden_change_detected
- `7`: llm_fix_failed_or_not_improved

---

## 5. Runtime 可视化建议

默认推荐：

```bash
triadmind runtime --visualize --view full --layout leaf-force --trace-depth 2
```

大图建议：

```bash
triadmind runtime --visualize --hide-isolated
```

仅在你明确想截断边时才使用：

```bash
triadmind runtime --visualize --max-render-edges 500
```

> 默认不截断边，保证页面边数与 `runtime-map.json` 一致。

---

## 6. 工程化最佳实践（团队协作）

### 6.1 分支策略

- 每个需求单独分支
- 每个分支至少一次 `sync -> plan -> apply -> verify -> govern ci`

### 6.2 门禁策略

CI 最小门禁建议：

```bash
triadmind bootstrap doctor --json
triadmind sync --force
triadmind runtime --visualize --view full
triadmind coverage --json
triadmind view-map --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

一键验收建议：

```bash
triadmind bootstrap doctor --json && triadmind sync --force && triadmind runtime --visualize --view full && triadmind coverage --json && triadmind view-map --json && triadmind verify --strict --json && triadmind govern ci --policy .triadmind/govern-policy.json --json
```

### 6.3 变更治理

- 不要在同一轮修复里“顺手放宽阈值”
- `govern-policy.json` 与 `verify-baseline.json` 建议仅通过 CODEOWNERS 审批更新

---

## 7. 常见问题

### Q1: runtime extractor 出错会不会拖垮 sync？

不会。runtime 是 best-effort，异常写入 `runtime-diagnostics.json`，主流程不崩溃。

### Q2: visualizer 卡住怎么办？

默认已走 fast fallback（非 strict fingerprint）。如遇大图，优先缩小 view 或开启 `--hide-isolated`。

### Q3: 为什么要 protocol/apply，而不是直接改？

因为协议是“可审阅变更计划”，可以显著降低大项目里“改对了代码但改错了结构”的风险。

---

## 8. 推荐的最小心智模型

把 TriadMind 当成三层系统：

- **Capability**：系统“有什么能力”
- **Runtime**：能力“如何在运行时协作”
- **Govern**：这次改动“是否达标可合并”

如果你只做一件事，请做：

```bash
triadmind sync --force && triadmind runtime --visualize --view full && triadmind govern ci --policy .triadmind/govern-policy.json --json
```

---

## 9. 相关文档

- `user guide.md`
- `docs/dummy-user-guide.md`
- `docs/tm-session.sh`
- `docs/tm-session.ps1`
- `docs/upgrade.md`
- `.github/workflows/triadmind-verify.yml`
- `.triadmind/govern-policy.json`

