# TriadMind Self-Bootstrap Architecture

这份文件是 TriadMind 对自己的顶点三元架构声明。它证明 TriadMind 不是只给别的项目立规矩，而是先用同一套规则描述自身。

## 1. Vertex

- Name: `TriadMind.SelfBootstrap`
- Responsibility: TriadMind 先用顶点三元法描述、约束和审核自己，再作为工具约束其他项目。
- Invariant: 任何新增能力都必须先复用现有拓扑；不能复用时只修改契约；职责不匹配时才 create_child。

## 2. Macro-Split

- Anchor: `Workflow.buildMasterPrompt`
- Left Branch:
  - Parser / TreeSitterParser 抽取源码拓扑
  - Workflow 组织 Macro/Meso/Micro 多轮推演
  - Protocol 校验升级协议
  - Generator 将协议落地为骨架
  - Visualizer 渲染知识图谱审核
  - Sync / Rules / Healing 提供持续同步、默认规则与自愈闭环
- Right Branch:
  - WorkspacePaths 定义 .triadmind 静态边界
  - TriadConfig 定义语言、解析器、协议和自愈策略
  - Triad-IR 定义跨语言中间表示
  - ProtocolRightBranch 定义协议类型与 Schema
  - HealingRightBranch 定义错误分类与自愈输出规则
  - Snapshots 定义安全回滚边界
  - WorkflowRightBranch / BootstrapRightBranch 提供右分支静态目录

## 3. Meso-Split

### AdapterRegistry

- Source: `adapterRegistry.ts`
- Responsibility: TriadMind 核心模块。
- Static Right Branch: module exports / type signatures
- Dynamic Left Branch: `AdapterRegistry.getAvailableAdapters`, `AdapterRegistry.registerAdapter`, `AdapterRegistry.resolveAdapter`

### Bootstrap

- Source: `bootstrap.ts`
- Responsibility: 自举证明层，把 TriadMind 自己描述为顶点三元架构。
- Static Right Branch: self-bootstrap.md / self-bootstrap-protocol.json
- Dynamic Left Branch: `Bootstrap.buildSelfBootstrapArchitecture`, `Bootstrap.buildSelfBootstrapProtocol`, `Bootstrap.writeSelfBootstrapProtocol`, `Bootstrap.writeSelfBootstrapReport`

### BootstrapRightBranch

- Source: `bootstrapRightBranch.ts`
- Responsibility: 自举右分支目录，集中保存模块职责目录、节点复用清单和自举文案模板。
- Static Right Branch: module roles / self bootstrap node ids / rendering text
- Dynamic Left Branch: `BootstrapRightBranch.getBootstrapModuleRoles`, `BootstrapRightBranch.getSelfBootstrapLoopLines`, `BootstrapRightBranch.getSelfBootstrapMicroRules`, `BootstrapRightBranch.getSelfBootstrapNodeIds`, `BootstrapRightBranch.getSelfBootstrapPreamble`

### Config

- Source: `config.ts`
- Responsibility: 静态配置层，约束解析器、协议置信度、运行时自愈和目录分类。
- Static Right Branch: TriadConfig / DEFAULT_CONFIG / .triadmind/config.json
- Dynamic Left Branch: `Config.ensureTriadConfig`, `Config.loadTriadConfig`, `Config.resolveCategoryFromConfig`, `Config.shouldExcludeSourcePath`

### Generator

- Source: `generator.ts`
- Responsibility: 骨架落地左分支，把已批准协议委托给当前语言适配器并落地为源码结构。
- Static Right Branch: apply pipeline / node upsert execution
- Dynamic Left Branch: `Generator.applyProtocol`

### GeneratorRightBranch

- Source: `generatorRightBranch.ts`
- Responsibility: 骨架生成右分支目录，集中保存类型白名单、源码路径策略和结构模板。
- Static Right Branch: builtin type names / source path strategy / method/function templates
- Dynamic Left Branch: `GeneratorRightBranch.buildFunctionStructure`, `GeneratorRightBranch.buildMethodStructure`, `GeneratorRightBranch.buildParameters`, `GeneratorRightBranch.buildTodoStatement`, `GeneratorRightBranch.buildTriadGeneratedDoc`, `GeneratorRightBranch.collectTypeTokens`, `GeneratorRightBranch.getBuiltinTypeNames`, `GeneratorRightBranch.normalizeToken`, `GeneratorRightBranch.resolveSourceFilePath`, `GeneratorRightBranch.resolveTypesModuleSpecifier`, `GeneratorRightBranch.shouldUseTopLevelFunction`

### Healing

- Source: `healing.ts`
- Responsibility: 运行时自愈左分支，把错误栈映射回拓扑节点并生成修复提示词。
- Static Right Branch: diagnosis pipeline / artifact writing
- Dynamic Left Branch: `Healing.buildHealingPrompt`, `Healing.diagnoseRuntimeFailure`, `Healing.prepareHealingArtifacts`

### HealingRightBranch

- Source: `healingRightBranch.ts`
- Responsibility: 运行时自愈右分支目录，集中保存错误分类规则、blast radius 策略和 healing prompt 固定规则。
- Static Right Branch: classification regexes / blast radius strategy / prompt output rules
- Dynamic Left Branch: `HealingRightBranch.buildEvidence`, `HealingRightBranch.buildSummary`, `HealingRightBranch.chooseSuggestedAction`, `HealingRightBranch.classifyDiagnosis`, `HealingRightBranch.estimateBlastRadius`, `HealingRightBranch.getContractGuardLine`, `HealingRightBranch.getHealingOutputRuleLines`, `HealingRightBranch.parseTraceLine`, `HealingRightBranch.scoreNodeMatch`

### Ir

- Source: `ir.ts`
- Responsibility: 跨语言中间表示层，把语言 AST 映射为 Triad-IR。
- Static Right Branch: TriadTopologyIR / TriadIRNode / TriadIREdge
- Dynamic Left Branch: `Ir.buildTopologyIR`

### Parser

- Source: `parser.ts`
- Responsibility: 源码拓扑抽取层，把当前语言源码抽取为 triad-map 叶节点。
- Static Right Branch: language adapter / JSDoc tags / sourcePath
- Dynamic Left Branch: `Parser.runParser`

### PolyglotAdapter

- Source: `polyglotAdapter.ts`
- Responsibility: TriadMind 核心模块。
- Static Right Branch: module exports / type signatures
- Dynamic Left Branch: `PolyglotAdapter.createCppAdapter`, `PolyglotAdapter.createGoAdapter`, `PolyglotAdapter.createJavaAdapter`, `PolyglotAdapter.createJavaScriptAdapter`, `PolyglotAdapter.createPythonAdapter`, `PolyglotAdapter.createRustAdapter`

### Protocol

- Source: `protocol.ts`
- Responsibility: 协议编译器左分支，用 Schema 与拓扑规则拦截非法演化。
- Static Right Branch: validation pipeline / node parsing / topology checks
- Dynamic Left Branch: `Protocol.assertProtocolShape`, `Protocol.normalizeCategory`, `Protocol.parseDemandEntry`, `Protocol.parseNodeRef`, `Protocol.parseReturnType`, `Protocol.readJsonFile`, `Protocol.readTriadMap`

### ProtocolRightBranch

- Source: `protocolRightBranch.ts`
- Responsibility: 协议右分支目录，集中保存类型、Schema、操作枚举和类别映射。
- Static Right Branch: Triad types / Zod schemas / prefix category map
- Dynamic Left Branch: `ProtocolRightBranch.getPrefixCategoryMap`, `ProtocolRightBranch.getTriadNodeDefinitionSchema`, `ProtocolRightBranch.getUpgradeProtocolSchema`

### Rules

- Source: `rules.ts`
- Responsibility: Always-on 规则层，把顶点三元约束写入 AI 助手默认上下文。
- Static Right Branch: AGENTS.md / .cursor/rules/triadmind.mdc / agent-rules.md
- Dynamic Left Branch: `Rules.installAlwaysOnRules`

### Snapshot

- Source: `snapshot.ts`
- Responsibility: 安全快照层，为 apply 和自愈循环提供可回滚边界。
- Static Right Branch: snapshot index / snapshot files / restore manifest
- Dynamic Left Branch: `Snapshot.collectProtocolSnapshotFiles`, `Snapshot.createSnapshot`, `Snapshot.listSnapshots`, `Snapshot.restoreSnapshot`

### Stage

- Source: `stage.ts`
- Responsibility: 阶段识别层，判断当前处于规划、审核、实现还是修复阶段。
- Static Right Branch: StageAnalysisInput / StageAnalysisResult
- Dynamic Left Branch: `Stage.analyzeWorkspaceStage`

### Sync

- Source: `sync.ts`
- Responsibility: 增量同步层，基于文件哈希保持 triad-map 与源码同步。
- Static Right Branch: sync-manifest.json / sha256 file digests
- Dynamic Left Branch: `Sync.syncTriadMap`, `Sync.watchTriadMap`

### TreeSitterParser

- Source: `treeSitterParser.ts`
- Responsibility: Tree-sitter 解析层，为跨语言泛化提供统一 AST 路径。
- Static Right Branch: tree-sitter grammar / query patterns
- Dynamic Left Branch: `TreeSitterParser.runTreeSitterParser`, `TreeSitterParser.runTreeSitterTypeScriptParser`

### TypescriptAdapter

- Source: `typescriptAdapter.ts`
- Responsibility: TriadMind 核心模块。
- Static Right Branch: module exports / type signatures
- Dynamic Left Branch: `TypescriptAdapter.applyUpgradeProtocol`, `TypescriptAdapter.createTypeScriptAdapter`, `TypescriptAdapter.parseTopology`, `TypescriptAdapter.readTopologyIR`

### TypescriptGenerator

- Source: `typescriptGenerator.ts`
- Responsibility: TriadMind 核心模块。
- Static Right Branch: module exports / type signatures
- Dynamic Left Branch: `TypescriptGenerator.applyTypeScriptProtocol`

### TypescriptParser

- Source: `typescriptParser.ts`
- Responsibility: TriadMind 核心模块。
- Static Right Branch: module exports / type signatures
- Dynamic Left Branch: `TypescriptParser.runTypeScriptParser`

### Visualizer

- Source: `visualizer.ts`
- Responsibility: 拓扑审核层，把协议和现有地图渲染为知识图谱。
- Static Right Branch: visualizer.html / node status / edge status
- Dynamic Left Branch: `Visualizer.generateDashboard`

### Workflow

- Source: `workflow.ts`
- Responsibility: 多轮推演编排左分支，生成 Macro/Meso/Micro/Protocol/Handoff 提示词。
- Static Right Branch: workflow execution pipeline
- Dynamic Left Branch: `Workflow.buildImplementationHandoffPrompt`, `Workflow.buildImplementationPrompt`, `Workflow.buildMacroPrompt`, `Workflow.buildMasterPrompt`, `Workflow.buildMesoPrompt`, `Workflow.buildMicroPrompt`, `Workflow.buildPipelinePrompt`, `Workflow.buildProtocolPrompt`, `Workflow.createDraftTemplate`, `Workflow.ensureMultiPassTemplates`, `Workflow.ensurePipelineArtifactSeeds`, `Workflow.ensureTriadSpec`, `Workflow.resetPipelineArtifacts`, `Workflow.writeImplementationHandoff`, `Workflow.writeMasterPrompt`, `Workflow.writePromptPacket`

### WorkflowRightBranch

- Source: `workflowRightBranch.ts`
- Responsibility: 工作流右分支目录，集中保存协议模板、阶段规则和提示词固定结构。
- Static Right Branch: draft templates / stage router rules / prompt shapes
- Dynamic Left Branch: `WorkflowRightBranch.buildMacroPromptShape`, `WorkflowRightBranch.buildMesoPromptShape`, `WorkflowRightBranch.buildMicroPromptShape`, `WorkflowRightBranch.buildTriadSpecDocument`, `WorkflowRightBranch.createDraftProtocolTemplate`, `WorkflowRightBranch.createMacroSplitSeed`, `WorkflowRightBranch.createMesoSplitSeed`, `WorkflowRightBranch.createMicroSplitSeed`, `WorkflowRightBranch.getImplementationExecutionWorkflowLines`, `WorkflowRightBranch.getImplementationHandoffRuleLines`, `WorkflowRightBranch.getMasterPromptExpectedBehaviorLines`, `WorkflowRightBranch.getMasterPromptImplementationPhaseLines`, `WorkflowRightBranch.getMasterPromptProtocolPhaseLines`, `WorkflowRightBranch.getMasterPromptStageRouterLines`, `WorkflowRightBranch.getProtocolOutputContractLines`

### Workspace

- Source: `workspace.ts`
- Responsibility: 工作区路径层，统一描述 .triadmind 文件系统边界。
- Static Right Branch: WorkspacePaths / projectRoot / .triadmind paths
- Dynamic Left Branch: `Workspace.getWorkspacePaths`, `Workspace.normalizePath`

## 4. Micro-Split Rules

- 类型、接口、配置、路径、Schema、缓存、快照属于静态右分支。
- 导出的函数、命令处理、协议执行、解析、生成、诊断属于动态左分支。
- 模块本身是顶点，负责把右分支约束包装成可执行的左分支能力。

## 5. Self-Bootstrap Loop

```text
triadmind-core 源码
-> Parser / TreeSitterParser
-> triad-map.json
-> self-bootstrap-protocol.json
-> visualizer.html
-> AGENTS.md / Cursor rules
-> 后续所有 TriadMind 改动继续先走协议
```
