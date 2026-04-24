# TriadMind Dummy User Guide（零基础速用版）

> 目标：让“第一次接触 TriadMind 的用户”在 10 分钟内完成初始化、看图、改造、门禁与回归。

---

## 1. TriadMind 是什么

TriadMind 是一个工程治理 CLI，不是普通代码补全器。  
它把研发流程拆成三层：

- **Capability**：系统有什么能力（`triad-map.json` / `leaf-map.json`）
- **Runtime**：能力在运行时怎么协作（`runtime-map.json` / `runtime-visualizer.html`）
- **Govern**：这次改动是否允许合并（`verify` / `govern ci`）

一句话：**先看拓扑，再改代码；先过门禁，再合并。**

---

## 2. 首次进入项目（必须做）

```bash
triadmind init
triadmind bootstrap doctor --json
```

如果 `doctor` 报错，执行：

```bash
triadmind bootstrap init --force
```

初始化后你会得到关键文件：

- `.triadmind/triad-map.json`
- `.triadmind/leaf-map.json`
- `.triadmind/runtime-map.json`
- `.triadmind/runtime-diagnostics.json`
- `.triadmind/govern-policy.json`
- `.triadmind/verify-baseline.json`
- `AGENTS.md`
- `skills.md`

---

## 3. 每个新终端会话的固定动作

Linux/macOS：

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

这一步会自动完成：`sync -> runtime -> plan(n) -> verify`，并产出 `.triadmind/bootstrap-verify.json`。

---

## 4. 一个需求从 0 到完成（标准流程）

### Step 1：刷新当前拓扑

```bash
triadmind sync --force
triadmind runtime --visualize --view full
```

### Step 2：把需求转为协议（而不是直接改代码）

```bash
triadmind prepare "你的需求"
triadmind protocol "你的需求"
triadmind pipeline "你的需求"
```

### Step 3：审阅协议并执行

```bash
triadmind plan --no-open --view architecture
triadmind apply
```

### Step 4：执行质量门禁

```bash
triadmind verify --strict --json
triadmind govern ci --policy .triadmind/govern-policy.json --json
```

只要任一命令失败，就先修复，不合并。

---

## 5. 你必须关注的输出文件

- `.triadmind/visualizer.html`：能力图页面
- `.triadmind/runtime-visualizer.html`：运行时图页面
- `.triadmind/runtime-diagnostics.json`：运行时抽取问题清单
- `.triadmind/bootstrap-verify.json`：会话级 verify 结果
- `.triadmind/govern-report.json`：硬门禁报告

---

## 6. 推荐的一键脚本

仓库已经提供示例脚本：

- `docs/tm-session.sh`
- `docs/tm-session.ps1`

可以复制到你的项目根目录后直接执行，作为团队默认启动动作。

---

## 7. 常见失败与处理

- `bootstrap doctor` 失败：执行 `triadmind bootstrap init --force`
- `verify --strict` 失败：先修 diagnostics / 结构问题，再继续实现
- `govern ci` 失败：视为合并阻断，必须先过门禁
- `runtime` 有 warning：查看 `.triadmind/runtime-diagnostics.json` 定位抽取器问题

---

## 8. 最小心智模型

把 TriadMind 当作“工程控制面”：

1. `sync/runtime` = 观察系统真实结构  
2. `plan/apply` = 协议化变更  
3. `verify/govern` = 质量门禁与可合并判定

这样你就能用同一套流程驾驭多语言、多模块、多人协作工程。
