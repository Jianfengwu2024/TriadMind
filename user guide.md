# TriadMind User Guide

## 1. 它是什么

TriadMind 是一个把“顶点三元法”嵌入工程开发流程的工具链。

它的目标不是让大模型直接写代码，而是先强制模型输出一份可审核、可校验、可落地的拓扑升级协议，再根据协议生成骨架代码，最后才进入实现。

核心链路：

```text
用户需求
-> Macro-Split
-> Meso-Split
-> Micro-Split
-> draft-protocol.json
-> visualizer.html 审核
-> apply 生成 / 更新骨架
-> implementation-handoff.md
-> AI 完成实现
```

---

## 2. 顶点三元法怎么理解

最小结构：

```text
顶点 = 一个可用功能
左分支 = 动态演化（动作 / 方法 / 执行逻辑）
右分支 = 静态稳定（属性 / 状态 / 配置 / 契约）
```

TriadMind 要求任何新功能都先做这层拆分：

1. 先找挂载点
2. 再拆成左分支和右分支
3. 再把子功能继续裂变为类、数据管道、接口
4. 再把类继续拆成属性和方法

协议层只允许三种动作：

- `reuse`：复用已有节点
- `modify`：升级已有节点的输入 / 输出
- `create_child`：在某个父节点下裂变新叶节点

默认原则：

```text
reuse 优先
modify 次之
create_child 最后
```

---

## 3. 目录结构

在目标项目中，TriadMind 会生成 `.triadmind/`：

- `triad.md`：方法论说明
- `config.json`：配置文件
- `triad-map.json`：当前项目拓扑图
- `draft-protocol.json`：待审核升级协议
- `visualizer.html`：知识图谱式审核页面
- `master-prompt.md`：统一总提示词
- `protocol-task.md`：协议生成提示词
- `multi-pass-pipeline.md`：多轮拆分提示词
- `implementation-prompt.md`：协议内嵌式实现提示词
- `implementation-handoff.md`：骨架生成后的实现提示词
- `healing-report.json`：运行时错误诊断报告
- `healing-prompt.md`：运行时修复提示词
- `cache/sync-manifest.json`：增量同步缓存
- `snapshots/`：本地安全快照

还会生成两类 Always-on 规则文件：

- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

---

## 4. 首次接入

### 4.1 安装依赖

在 `triadmind-core` 根目录：

```bash
npm install
```

在目标项目中，把脚本接入 `package.json`。如果你已经按示例接好了，可直接跳过。

### 4.2 初始化工作区

进入目标项目根目录，例如：

```bash
cd D:\TraidMind\microflow-ts
```

执行：

```bash
npm run triad:init
```

这一步会做几件事：

- 创建 `.triadmind/`
- 生成 `triad.md`
- 扫描源码生成 `triad-map.json`
- 生成 `master-prompt.md`
- 安装 `AGENTS.md` / Cursor 规则

---

## 5. 最小工作流

### 步骤 1：准备协议提示词

```bash
npm run triad:pipeline -- "在前端新增一个导出按钮，能把当前流体粒子状态保存为CSV。"
```

这会写出：

- `.triadmind/macro-split.md`
- `.triadmind/meso-split.md`
- `.triadmind/micro-split.md`
- `.triadmind/multi-pass-pipeline.md`
- `.triadmind/master-prompt.md`

### 步骤 2：把提示词交给当前对话中的大模型

最简单的做法是把：

```text
.triadmind/master-prompt.md
```

发给大模型，让它按顺序完成：

```text
Macro -> Meso -> Micro -> draft-protocol.json
```

然后把模型返回的严格 JSON 保存到：

```text
.triadmind/draft-protocol.json
```

### 步骤 3：审核协议

```bash
npm run triad:plan
```

这一步会：

- 校验协议是否合法
- 生成 `.triadmind/visualizer.html`
- 打开知识图谱页面供你审核

### 步骤 4：落地骨架

```bash
npm run triad:apply
```

或直接：

```bash
npm run triad:plan -- --apply
```

### 步骤 5：进入实现阶段

把下面这个文件交给 AI：

```text
.triadmind/implementation-handoff.md
```

它会基于：

- 原始需求
- 已批准协议
- 最新 `triad-map.json`
- 刚生成的骨架文件

继续补全实现。

---

## 6. 常用命令

### 初始化

```bash
npm run triad:init
```

### 生成多轮协议提示词

```bash
npm run triad:pipeline -- "你的需求"
```

### 只生成协议提示词

```bash
npm run triad:protocol -- "你的需求"
```

### 生成内嵌协议的实现提示词

```bash
npm run triad:auto -- "你的需求"
```

### 分别生成三轮拆分提示词

```bash
npm run triad:macro -- "你的需求"
npm run triad:meso
npm run triad:micro
```

### 协议审核

```bash
npm run triad:plan
```

### 审核但不自动打开浏览器

```bash
npm run triad:plan -- --no-open
```

### 审核后直接落地

```bash
npm run triad:plan -- --no-open --apply
```

### 直接应用协议

```bash
npm run triad:apply
```

### 生成实现交接提示词

```bash
npm run triad:handoff
```

### 重建统一总提示词

```bash
npm run triad:master
```

### TriadMind Core 自举

如果当前目录是 `triadmind-core`，执行：

```bash
npm run self
```

它会让 TriadMind 用自己的拓扑规则描述自己，并生成：

- `.triadmind/self-bootstrap.md`
- `.triadmind/self-bootstrap-protocol.json`
- `.triadmind/visualizer.html`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

---

## 7. 增量同步与实时监听

### 增量同步

```bash
npm run triad:sync
```

TriadMind 会比较源码哈希，只在源码变化时重建 `triad-map.json`。

强制全量重建：

```bash
npm run triad:sync -- --force
```

缓存文件位置：

```text
.triadmind/cache/sync-manifest.json
```

### Watch 模式

```bash
npm run triad:watch
```

它会持续监听源码变化，并自动同步拓扑图。

适合和你的开发服务器一起开着。

---

## 8. Always-on 规则

执行：

```bash
npm run triad:rules
```

会生成：

- `.triadmind/agent-rules.md`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

作用是让 AI 助手在改代码前，先看：

- `.triadmind/triad-map.json`
- `.triadmind/config.json`
- `.triadmind/master-prompt.md`

这样 TriadMind 从“手工提醒”变成“默认规则”。

---

## 9. `draft-protocol.json` 有什么硬约束

TriadMind 不会盲信 LLM。

在 `plan` / `apply` 之前，会先做 Schema 校验和拓扑规则校验。

### 必须满足

- `actions` 不能为空
- 只允许 `reuse` / `modify` / `create_child`
- `reuse.nodeId` 必须存在于当前 `triad-map.json`
- `modify.nodeId` 必须存在于当前 `triad-map.json`
- `modify` 不能偷偷篡改节点核心职责
- `create_child.parentNodeId` 必须存在
- `create_child.node.nodeId` 必须是新节点
- 重复目标节点、重复动作会被拦截

### 置信度守卫

配置在：

```text
.triadmind/config.json
```

例如：

```json
"protocol": {
  "minConfidence": 0.6,
  "requireConfidence": false
}
```

含义：

- `requireConfidence: true`：要求每个动作都必须带 `confidence`
- `minConfidence: 0.6`：低于 0.6 的动作直接拦截

动作示例：

```json
{
  "op": "create_child",
  "parentNodeId": "ParticleCanvas.render",
  "confidence": 0.82,
  "node": {
    "nodeId": "ParticleCsvExporter.exportCurrentState",
    "category": "frontend",
    "sourcePath": "src/frontend/ParticleCsvExporter.ts",
    "fission": {
      "problem": "导出当前粒子状态为CSV",
      "demand": ["SimState (currentState)"],
      "answer": ["void"]
    }
  }
}
```

---

## 10. `visualizer.html` 怎么看

现在的 `visualizer.html` 已改成知识图谱风格。

你会看到：

- 当前拓扑节点
- 父子依赖连线
- 新增叶节点高亮
- `create_child` 新增连线高亮
- 搜索框、侧边栏、节点详情

审核重点：

1. 挂载点是否正确
2. 新节点是不是只在必要时才创建
3. 新节点是不是叶节点
4. 左右分支职责是否清楚
5. 有没有破坏原有拓扑稳定性

---

## 11. 多语言路径

当前稳定支持的语言都默认走统一 Tree-sitter AST 路径：

- `typescript + tree-sitter`
- `javascript + tree-sitter`
- `python + tree-sitter`
- `go + tree-sitter`
- `rust + tree-sitter`
- `cpp + tree-sitter`
- `java + tree-sitter`

可在配置中切换：

```json
"architecture": {
  "language": "python",
  "parserEngine": "tree-sitter",
  "adapter": "@triadmind/plugin-python"
}
```

查看当前适配器状态：

```bash
npm run triad:adapters
```

当前架构已经把“协议”与“语言实现”解耦：

```text
代码 -> Tree-sitter AST -> Triad-IR -> protocol -> adapter -> 骨架
```

`javascript / go / rust / cpp / java` 同理可把 `language` 改成 `javascript`、`go`、`rust`、`cpp`、`java`。如果不手动配置，`init` 会根据项目源码扩展名自动识别。

当前边界：

- `typescript / javascript / python / go / rust / cpp / java` 已支持 `init / sync / apply / invoke --apply`
- `native` 仅保留为旧项目兼容或调试回退路径，新项目不建议使用
- 解析侧已统一为 Tree-sitter AST；骨架生成仍由各语言 adapter 按目标语言语法落盘

---

## 12. 运行时自愈怎么用

如果运行时报错，不要直接让 AI 乱改代码。

### 方式 1：直接传错误文本

```bash
npm run triad:heal -- --message "TypeError: Cannot read properties of undefined (reading 'velocity')"
```

### 方式 2：先保存错误日志

把报错写到：

```text
.triadmind/runtime-error.log
```

再执行：

```bash
npm run triad:heal
```

这一步会生成：

- `.triadmind/runtime-error.log`
- `.triadmind/healing-report.json`
- `.triadmind/healing-prompt.md`

修复流程：

```text
运行错误
-> 定位 triad node
-> 判断 left_branch / right_branch / contract / topology
-> 估算 blast radius
-> 输出 healing-prompt.md
-> 让模型生成 repair draft-protocol.json
-> 再走 triad:plan / triad:apply
```

---

## 13. 安全快照与回滚

手动创建快照：

```bash
npm run triad:snapshot -- "before-risky-change"
```

查看快照：

```bash
npm run triad:snapshots
```

回滚：

```bash
npm run triad:rollback -- "<snapshot-id>"
```

快照存在：

```text
.triadmind/snapshots/
```

建议在高风险 `apply` 或自愈修复前做一次。

---

## 14. 推荐的人机协作方式

最稳妥的协作顺序：

1. 你提出需求
2. TriadMind 生成总提示词
3. 模型输出协议
4. 你审核知识图谱
5. TriadMind 落地骨架
6. 模型补全实现
7. 运行时报错时，再走自愈协议

也就是说：

```text
先协议，后代码
先拓扑，后实现
先约束，后生成
```

---

## 15. 推荐配置

初期建议：

```json
{
  "architecture": {
    "language": "typescript",
    "parserEngine": "tree-sitter",
    "adapter": "@triadmind/plugin-ts"
  },
  "protocol": {
    "minConfidence": 0.6,
    "requireConfidence": false
  },
  "runtimeHealing": {
    "enabled": true,
    "maxAutoRetries": 3,
    "requireHumanApprovalForContractChanges": true,
    "snapshotStrategy": "manual"
  }
}
```

如果旧项目确实需要回退兼容解析，可临时切到：

```json
"parserEngine": "native"
```

---

## 16. 故障排查

### `triad-map.json` 没更新

先执行：

```bash
npm run triad:sync -- --force
```

再检查：

```text
.triadmind/cache/sync-manifest.json
```

### `visualizer.html` 看不到新增节点

先确认：

- `draft-protocol.json` 里确实存在 `create_child`
- `parentNodeId` 指向现有节点
- 新 `nodeId` 没和旧节点冲突

然后重新执行：

```bash
npm run triad:plan -- --no-open
```

### AI 还是直接改代码，不看协议

重新执行：

```bash
npm run triad:rules
```

并确认这些文件存在：

- `.triadmind/agent-rules.md`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

### 协议被拒绝

优先检查：

- `nodeId` 是否真实存在
- `modify` 是否改了节点职责
- `create_child` 是否挂在有效父节点下
- `confidence` 是否低于最小阈值

---

## 17. 一句话总结

TriadMind 的正确用法不是：

```text
让 AI 直接写代码
```

而是：

```text
让 AI 先按照顶点三元法产出协议，
再由工具链做校验、可视化、骨架落地与自愈闭环。
```

如果你要把它集成进新的项目，先做三件事：

1. `npm run triad:init`
2. `npm run triad:rules`
3. `npm run triad:pipeline -- "你的需求"`
