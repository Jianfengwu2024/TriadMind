# TriadMind Core

TriadMind Core 是一个把“顶点三元法”落成工程工作流的核心引擎。

它的重点不是让用户去记 CLI，而是让 AI 助手理解：

```text
@triadmind = 一个可静默调用的架构工作流入口
```

---

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
