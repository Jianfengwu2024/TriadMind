# TriadMind Core

TriadMind Core 是把“顶点三元法”落地为工程工具链的核心引擎。

它不要求模型直接写代码，而是强制先完成：

```text
需求
-> Macro-Split（挂载点 + 左右分支）
-> Meso-Split（子功能 / 类 / 数据管道）
-> Micro-Split（属性 / 状态 / 方法 / 契约）
-> draft-protocol.json
-> visualizer.html 审核
-> apply 骨架落地
-> implementation-handoff.md 二阶段实现
```

## Core Principles

- `顶点`：一个可用功能，是左右分支的逻辑封装
- `左分支`：动态演化，动作、方法、流程、子功能执行
- `右分支`：静态稳定，属性、状态、配置、契约、编排
- `reuse -> modify -> create_child`：永远先复用，再最小修改，最后才裂变新叶节点

## Current Capabilities

- 严格协议校验：基于 `zod` 校验 `draft-protocol.json`
- 置信度守卫：支持 `protocol.minConfidence` / `protocol.requireConfidence`
- 图谱式审核：`visualizer.html` 已改为知识图谱风格，突出新叶节点和新增连线
- 增量同步：基于文件哈希缓存，只在源码变化时重建 `triad-map.json`
- 持续监听：`watch` 模式持续同步拓扑
- Always-on 规则：自动写入 `.triadmind/agent-rules.md`、`AGENTS.md`、`.cursor/rules/triadmind.mdc`
- 运行时自愈脚手架：运行错误 -> 节点映射 -> 三元诊断 -> 修复协议提示词
- 安全快照：`apply` 前后可做本地回滚保护
- 适配器架构：已抽出 `adapter` / `Triad-IR`，为多语言泛化预留路径
- Tree-sitter 路径：TypeScript 已支持 `native` 与 `tree-sitter` 两种解析路径

## Minimal Workflow

在目标项目根目录执行：

```bash
npm run triad:init
npm run triad:pipeline -- "你的需求"
npm run triad:plan
npm run triad:apply
npm run triad:handoff
```

推荐把 `.triadmind/master-prompt.md` 发给当前对话中的大模型，让它先完成协议规划，再进入实现。

## Generated Files

TriadMind 会在目标项目生成 `.triadmind/` 工作区：

- `triad.md`：顶点三元法规范
- `config.json`：架构、解析器、协议、运行时自愈配置
- `triad-map.json`：当前项目拓扑图
- `draft-protocol.json`：待审核拓扑升级协议
- `visualizer.html`：知识图谱式审核页面
- `master-prompt.md`：统一总提示词
- `protocol-task.md`：协议子任务提示词
- `multi-pass-pipeline.md`：多轮推演提示词
- `implementation-prompt.md`：实现前总提示词
- `implementation-handoff.md`：骨架落地后的实现提示词
- `healing-report.json`：运行时错误诊断报告
- `healing-prompt.md`：运行时自愈提示词
- `cache/sync-manifest.json`：增量同步缓存
- `snapshots/`：安全快照

## Commands

在 `triadmind-core` 仓库中：

```bash
npm run init
npm run pipeline -- "你的需求"
npm run protocol -- "你的需求"
npm run auto -- "你的需求"
npm run plan
npm run apply
npm run handoff
npm run sync
npm run watch
npm run rules
npm run self
npm run heal -- --message "TypeError: ..."
npm run adapters
npm run snapshot -- "before-change"
npm run snapshots
npm run rollback -- "<snapshot-id>"
```

在接入项目中，命令通常带 `triad:` 前缀，例如：

```bash
npm run triad:init
npm run triad:sync -- --force
npm run triad:watch
npm run triad:rules
npm run triad:heal -- --message "TypeError: ..."
```

## Protocol Hard Constraints

TriadMind 会在 `plan` / `apply` 前拦截非法协议：

- `actions` 不能为空
- 只允许 `reuse` / `modify` / `create_child`
- `reuse.nodeId` 必须已存在
- `modify.nodeId` 必须已存在
- `modify` 只能升级 `demand` / `answer`，不能篡改节点核心职责
- `create_child.parentNodeId` 必须已存在
- `create_child.node.nodeId` 必须是全新节点
- 重复目标节点或重复动作会被拦截
- 如启用置信度守卫，低于阈值的动作会被拒绝

## Config Example

`.triadmind/config.json`：

```json
{
  "schemaVersion": "1.1",
  "architecture": {
    "language": "typescript",
    "parserEngine": "native",
    "adapter": "@triadmind/plugin-ts"
  },
  "parser": {
    "excludePatterns": ["node_modules", ".triadmind"],
    "includeUntaggedExports": true,
    "jsDocTags": {
      "triadNode": "TriadNode",
      "leftBranch": "LeftBranch",
      "rightBranch": "RightBranch"
    }
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

## Cross-Language Direction

当前稳定适配器：

- `typescript` + `native`
- `typescript` + `tree-sitter`

当前代码边界：

- `languageAdapter.ts`：定义跨语言 `LanguageAdapter` 契约
- `adapterRegistry.ts`：维护适配器注册表，并按 `.triadmind/config.json` 动态路由
- `typescriptAdapter.ts`：封装 TypeScript 的拓扑解析与协议落地能力
- `typescriptParser.ts`：TypeScript 原生 AST 拓扑抽取实现
- `typescriptGenerator.ts`：TypeScript 骨架代码生成实现
- `parser.ts` / `generator.ts`：纯调度器，不再直接绑定 `ts-morph`

已预留方向：

- `python`
- `go`
- `rust`

多语言泛化的思路是：

```text
语言代码 -> 解析器 / Tree-sitter -> Triad-IR -> protocol -> 适配器生成骨架
```

## Runtime Self-Healing

运行时报错后：

```bash
npm run triad:heal -- --message "TypeError: Cannot read properties of undefined"
```

或把错误写入 `.triadmind/runtime-error.log` 后执行：

```bash
npm run triad:heal
```

当前自愈链路：

```text
错误日志
-> Trace-to-Node 节点映射
-> left/right/contract/topology 归因
-> blast radius 分析
-> healing-prompt.md
-> LLM 生成 repair protocol
-> plan / apply
```

## Always-On Rules

执行：

```bash
npm run triad:rules
```

会自动生成：

- `.triadmind/agent-rules.md`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

这样 AI 助手在实现前会先读取拓扑图、配置和总提示词，而不是直接跳进代码。

## Self Bootstrap

TriadMind Core 可以用自己的规则描述自己：

```bash
cd triadmind-core
npm run self
```

该命令会生成：

- `.triadmind/self-bootstrap.md`
- `.triadmind/self-bootstrap-protocol.json`
- `.triadmind/draft-protocol.json`
- `.triadmind/visualizer.html`
- `AGENTS.md`
- `.cursor/rules/triadmind.mdc`

这表示 TriadMind 自身也被纳入同一套 `triad-map -> protocol -> visualizer -> rules` 闭环。

## Validation

开发时推荐至少验证：

```bash
cd triadmind-core && npm run typecheck
cd ../microflow-ts && npm run triad:sync -- --force
cd ../microflow-ts && npm run triad:rules
```

## Verified Regression

在完成自举重构后，TriadMind Core 已做过一轮功能回归验证，确认“能自举”且“原功能未失效”。

### Core Commands

在 `triadmind-core` 根目录已验证通过：

```bash
npm run typecheck
npm run adapters
npm run self
npm run sync
npm run rules
npm run heal -- --message "TypeError: Cannot read properties of undefined at runParser (...)"
npm run plan -- --no-open --apply
```

验证结果：

- `typecheck` 通过
- `self` 可重新生成 `.triadmind/self-bootstrap.md`
- `sync` 可增量同步 `triad-map.json`
- `rules` 可重新生成 `AGENTS.md` 与 Cursor 规则
- `heal` 可生成 `healing-report.json` 与 `healing-prompt.md`
- `plan --apply` 可走完整审核与协议执行流程

### E2E Apply Test

还使用一个最小 TypeScript 临时项目做了真实 E2E 验证：

1. 先运行 `init`
2. 写入一个 `create_child` 协议
3. 执行 `plan --no-open --apply`
4. 确认新骨架文件被生成
5. 再写入一个 `modify` 协议
6. 再次执行 `plan --no-open --apply`
7. 确认函数签名被更新

实际验证到的行为：

- `create_child` 能新增 `CsvExporter.exportState`
- `modify` 能更新已存在节点的参数签名
- 当 `modify` 试图改变节点核心职责 `problem` 时，会被协议守卫正确拦截

这说明当前版本在完成 `workflow / bootstrap / protocol / generator / healing` 的左右分支重构后，以下核心能力仍然可用：

- 拓扑扫描
- 协议校验
- 图谱审核
- 骨架生成
- 协议修改
- 运行时自愈提示词生成

如果你要在新环境重新复验，推荐最小顺序：

```bash
npm install
npm run typecheck
npm run self
npm run heal -- --message "TypeError: Cannot read properties of undefined at runParser (...)"
```

## Project Status

TriadMind 正从“提示词手册”升级为“架构编译器”：

- Prompt 约束 -> Schema 硬约束
- 人工同步 -> 增量同步 / watch
- 手动提醒 -> Always-on 规则
- TypeScript 单语种 -> 适配器 + Tree-sitter 泛化
- 事后修 Bug -> 拓扑感知自愈

如果你要看完整落地使用方式，请读 `triadmind-core/user guide.md`。
