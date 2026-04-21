# TriadMind Self-Bootstrap Architecture

这份文件是 TriadMind 对自己的顶点三元架构声明。它证明 TriadMind 不是只给别的项目立规矩，而是先用同一套规则描述自身。

## 1. 顶点

- 名称：`TriadMind.SelfBootstrap`
- 职责：TriadMind 先用顶点三元法描述、约束和审核自己，再作为工具约束其他项目。
- 不变量：任何新增能力都必须先复用现有拓扑；不能复用时只修改契约；职责不匹配时才 create_child。

## 2. Macro-Split

- 挂载锚点：`Workflow.buildMasterPrompt`
- 左分支（动态演化）：
  - Parser / TreeSitterParser 抽取源码拓扑
  - Workflow 组织 Macro/Meso/Micro 多轮推演
  - Protocol 校验升级协议
  - Generator 将协议落地为骨架
  - Visualizer 渲染知识图谱审核
  - Sync / Rules / Healing 提供持续同步、默认规则与自愈闭环
- 右分支（静态稳定）：
  - WorkspacePaths 定义 .triadmind 静态边界
  - TriadConfig 定义语言、解析器、协议和自愈策略
  - Triad-IR 定义跨语言中间表示
  - Zod Schema 定义协议物理约束
  - Snapshots 定义安全回滚边界

## 3. Meso-Split

### Adapter

- 源文件：`adapter.ts`
- 职责：语言适配器选择层，把协议执行委托给当前项目语言插件。
- 静态右分支：adapter registry / language / parserEngine / adapterPackage
- 动态左分支：`Adapter.getAvailableAdapters`, `Adapter.resolveAdapter`

### Bootstrap

- 源文件：`bootstrap.ts`
- 职责：自举证明层，把 TriadMind 自己描述为顶点三元架构。
- 静态右分支：self-bootstrap.md / self-bootstrap-protocol.json
- 动态左分支：`Bootstrap.buildSelfBootstrapArchitecture`, `Bootstrap.buildSelfBootstrapProtocol`, `Bootstrap.writeSelfBootstrapProtocol`, `Bootstrap.writeSelfBootstrapReport`

### Config

- 源文件：`config.ts`
- 职责：静态配置层，约束解析器、协议置信度、运行时自愈和目录分类。
- 静态右分支：TriadConfig / DEFAULT_CONFIG / .triadmind/config.json
- 动态左分支：`Config.ensureTriadConfig`, `Config.loadTriadConfig`, `Config.resolveCategoryFromConfig`, `Config.shouldExcludeSourcePath`

### Generator

- 源文件：`generator.ts`
- 职责：骨架落地层，把已批准协议转译为 TypeScript 源码结构。
- 静态右分支：nodeLocations / exportedTypeNames / sourcePath
- 动态左分支：`Generator.applyProtocol`

### Healing

- 源文件：`healing.ts`
- 职责：运行时自愈层，把错误栈映射回拓扑节点并生成修复提示词。
- 静态右分支：runtime-error.log / healing-report.json / healing-prompt.md
- 动态左分支：`Healing.buildHealingPrompt`, `Healing.diagnoseRuntimeFailure`, `Healing.prepareHealingArtifacts`

### Ir

- 源文件：`ir.ts`
- 职责：跨语言中间表示层，把语言 AST 映射为 Triad-IR。
- 静态右分支：TriadTopologyIR / TriadIRNode / TriadIREdge
- 动态左分支：`Ir.buildTopologyIR`

### Parser

- 源文件：`parser.ts`
- 职责：源码拓扑抽取层，把 TypeScript 源码抽取为 triad-map 叶节点。
- 静态右分支：tsconfig.json / JSDoc tags / sourcePath
- 动态左分支：`Parser.runParser`

### Protocol

- 源文件：`protocol.ts`
- 职责：协议编译器层，用 Schema 和拓扑规则拦截非法演化。
- 静态右分支：Zod schemas / allowedOps / confidence thresholds
- 动态左分支：`Protocol.assertProtocolShape`, `Protocol.normalizeCategory`, `Protocol.parseDemandEntry`, `Protocol.parseNodeRef`, `Protocol.parseReturnType`, `Protocol.readJsonFile`, `Protocol.readTriadMap`

### Rules

- 源文件：`rules.ts`
- 职责：Always-on 规则层，把顶点三元约束写入 AI 助手默认上下文。
- 静态右分支：AGENTS.md / .cursor/rules/triadmind.mdc / agent-rules.md
- 动态左分支：`Rules.installAlwaysOnRules`

### Snapshot

- 源文件：`snapshot.ts`
- 职责：安全快照层，为 apply 和自愈循环提供可回滚边界。
- 静态右分支：snapshot index / snapshot files / restore manifest
- 动态左分支：`Snapshot.collectProtocolSnapshotFiles`, `Snapshot.createSnapshot`, `Snapshot.listSnapshots`, `Snapshot.restoreSnapshot`

### Stage

- 源文件：`stage.ts`
- 职责：阶段识别层，判断当前处于规划、审核、实现还是修复阶段。
- 静态右分支：StageAnalysisInput / StageAnalysisResult
- 动态左分支：`Stage.analyzeWorkspaceStage`

### Sync

- 源文件：`sync.ts`
- 职责：增量同步层，基于文件哈希保持 triad-map 与源码同步。
- 静态右分支：sync-manifest.json / sha256 file digests
- 动态左分支：`Sync.syncTriadMap`, `Sync.watchTriadMap`

### TreeSitterParser

- 源文件：`treeSitterParser.ts`
- 职责：Tree-sitter 解析层，为跨语言泛化提供统一 AST 路径。
- 静态右分支：tree-sitter grammar / query patterns
- 动态左分支：`TreeSitterParser.runTreeSitterTypeScriptParser`

### Visualizer

- 源文件：`visualizer.ts`
- 职责：拓扑审核层，把协议和现有地图渲染为知识图谱。
- 静态右分支：visualizer.html / node status / edge status
- 动态左分支：`Visualizer.generateDashboard`

### Workflow

- 源文件：`workflow.ts`
- 职责：多轮推演编排层，生成 Macro/Meso/Micro/Protocol/Handoff 提示词。
- 静态右分支：triad.md / master-prompt.md / latest-demand.txt
- 动态左分支：`Workflow.buildImplementationHandoffPrompt`, `Workflow.buildImplementationPrompt`, `Workflow.buildMacroPrompt`, `Workflow.buildMasterPrompt`, `Workflow.buildMesoPrompt`, `Workflow.buildMicroPrompt`, `Workflow.buildPipelinePrompt`, `Workflow.buildProtocolPrompt`, `Workflow.createDraftTemplate`, `Workflow.ensureMultiPassTemplates`, `Workflow.ensureTriadSpec`, `Workflow.resetPipelineArtifacts`, `Workflow.writeImplementationHandoff`, `Workflow.writeMasterPrompt`, `Workflow.writePromptPacket`

### Workspace

- 源文件：`workspace.ts`
- 职责：工作区路径层，统一描述 .triadmind 文件系统边界。
- 静态右分支：WorkspacePaths / projectRoot / .triadmind paths
- 动态左分支：`Workspace.getWorkspacePaths`, `Workspace.normalizePath`

## 4. Micro-Split 判定

每个模块内部继续按同一规则分形：

- 类型、接口、配置、路径、Schema、缓存、快照属于静态右分支。
- 导出的函数、命令处理、协议执行、解析、生成、诊断属于动态左分支。
- 模块本身是顶点，负责把右分支约束包装成可执行的左分支能力。

## 5. 自举闭环

```text
triadmind-core 源码
-> Parser / TreeSitterParser
-> triad-map.json
-> self-bootstrap-protocol.json
-> visualizer.html
-> AGENTS.md / Cursor rules
-> 后续所有 TriadMind 改动继续先走协议
```
