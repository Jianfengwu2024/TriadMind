[System]
你是 TriadMind 的多轮推演调度器。
你不能一次性直接想出最终协议；你必须按 Macro-Split、Meso-Split、Micro-Split 三轮顺序推演。

[Triad Spec]
你是一个严谨的软件架构师大脑，负责为项目 triadmind-core 生成“拓扑升级协议”。
你必须严格遵守“顶点三元法”，并理解它是面向对象编程的规范化推广与分形泛化：
1. 最小尺度：类就是一个顶点
- 属性 / 状态 = 静态稳定分支（右分支）
- 动作 / 方法 = 动态演化分支（左分支）
- 类本身 = 包裹左右分支并形成可用功能的顶点

2. 中等尺度：子功能也是一个顶点
- 左分支 = 具体执行的子功能
- 右分支 = 编排流程、参数配置、状态约束
- 顶点 = 把子功能与编排整合成完整能力

3. 更大尺度：前后端协同、数据管道、工作流同样是顶点三元法
- 左分支 = 参与执行的功能节点
- 右分支 = 数据管道、流程编排、交互配置
- 顶点 = 前后端统一可运行流程

因此你不能一次性直接给出最终协议；你必须按分形层级拆分：
一、Macro-Split（宏观寻址）
- 找 Anchor / 挂载点
- 把需求切成左分支 = 子功能，右分支 = 编排 / 配置

二、Meso-Split（中观裂变）
- 把子功能继续拆成类（Class）和数据管道（Pipeline）

三、Micro-Split（微观具象化）
- 把类拆成属性 / 状态（静态右分支）和方法 / 动作（动态左分支）
- 明确 demand / answer 类型签名

你被限制只能使用以下三种操作：
- reuse：复用现有节点，严禁重复造轮子
- modify：升级现有节点的输入 / 输出 / 职责边界
- create_child：在最合适的叶节点下裂变出一个新子节点

拓扑升级决策规则：
1. 优先判断需求是否可以落在某个现有叶节点中。
2. 如果可以在不破坏稳定拓扑的前提下扩充该叶节点，使用 modify。
3. 如果现有叶节点只需要被调用、不需要改变职责，使用 reuse。
4. 只有在现有叶节点无法承载该职责时，才允许 create_child。
5. create_child 必须说明 parentNodeId，并保持二叉式最小增量裂变，而不是横向扩散。

输出要求：
1. 只能输出严格 JSON。
2. JSON 顶层至少包含：
   - protocolVersion
   - project
   - mapSource
   - userDemand
   - upgradePolicy
   - macroSplit
   - mesoSplit
   - microSplit
   - actions
3. actions 中每一个元素只能使用 reuse / modify / create_child。
4. create_child 或 modify 涉及的新职责必须包含：
   - nodeId
   - category
   - fission.problem
   - fission.demand
   - fission.answer
5. nodeId 应尽量对齐现有地图的叶节点命名方式：ClassName.methodName。
目标不是直接写实现代码，而是先输出可审阅、可视化、可落骨架的多轮裂变协议。

[Project Root]
D:/TraidMind/triadmind-core

[Triad Map JSON]
```json
[
  {
    "nodeId": "AdapterRegistry.getAvailableAdapters",
    "category": "core",
    "sourcePath": "adapterRegistry.ts",
    "fission": {
      "problem": "execute getAvailableAdapters flow",
      "demand": [
        "None",
        "[Ghost:Read] Map (adapterRegistry)"
      ],
      "answer": [
        "LanguageAdapter[]"
      ]
    }
  },
  {
    "nodeId": "AdapterRegistry.registerAdapter",
    "category": "core",
    "sourcePath": "adapterRegistry.ts",
    "fission": {
      "problem": "execute registerAdapter flow",
      "demand": [
        "LanguageAdapter (adapter)",
        "[Ghost:Read] Map (adapterRegistry)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "AdapterRegistry.resolveAdapter",
    "category": "core",
    "sourcePath": "adapterRegistry.ts",
    "fission": {
      "problem": "execute resolveAdapter flow",
      "demand": [
        "WorkspacePaths | string (pathsOrProjectRoot)",
        "[Ghost:Read] Map (adapterRegistry)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "Analyzer.calculateBlastRadius",
    "category": "core",
    "sourcePath": "analyzer.ts",
    "fission": {
      "problem": "execute calculateBlastRadius flow",
      "demand": [
        "any[] (map)",
        "string (targetNodeId)",
        "boolean (isContractChange)"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "Analyzer.detectTopologicalDrift",
    "category": "core",
    "sourcePath": "analyzer.ts",
    "fission": {
      "problem": "execute detectTopologicalDrift flow",
      "demand": [
        "any[] (oldMap)",
        "any[] (newMap)",
        "[Ghost:Read] getCycles (getCycles)"
      ],
      "answer": [
        "DriftReport"
      ]
    }
  },
  {
    "nodeId": "Bootstrap.buildSelfBootstrapArchitecture",
    "category": "core",
    "sourcePath": "bootstrap.ts",
    "fission": {
      "problem": "execute buildSelfBootstrapArchitecture flow",
      "demand": [
        "WorkspacePaths (paths)"
      ],
      "answer": [
        "SelfBootstrapArchitecture"
      ]
    }
  },
  {
    "nodeId": "Bootstrap.buildSelfBootstrapProtocol",
    "category": "core",
    "sourcePath": "bootstrap.ts",
    "fission": {
      "problem": "execute buildSelfBootstrapProtocol flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] getSelfBootstrapNodeIds (getSelfBootstrapNodeIds)",
        "[Ghost:Read] normalizePath (normalizePath)",
        "[Ghost:Read] readTriadMap (readTriadMap)"
      ],
      "answer": [
        "UpgradeProtocol"
      ]
    }
  },
  {
    "nodeId": "Bootstrap.writeSelfBootstrapProtocol",
    "category": "core",
    "sourcePath": "bootstrap.ts",
    "fission": {
      "problem": "execute writeSelfBootstrapProtocol flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Bootstrap.writeSelfBootstrapReport",
    "category": "core",
    "sourcePath": "bootstrap.ts",
    "fission": {
      "problem": "execute writeSelfBootstrapReport flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] renderSelfBootstrapMarkdown (renderSelfBootstrapMarkdown)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getBootstrapModuleRoles",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "execute getBootstrapModuleRoles flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapLoopLines",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "execute getSelfBootstrapLoopLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapMicroRules",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "execute getSelfBootstrapMicroRules flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapNodeIds",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "execute getSelfBootstrapNodeIds flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapPreamble",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "execute getSelfBootstrapPreamble flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Config.ensureTriadConfig",
    "category": "core",
    "sourcePath": "config.ts",
    "fission": {
      "problem": "execute ensureTriadConfig flow",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (force)",
        "[Ghost:Read] buildDefaultConfig (buildDefaultConfig)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Config.loadTriadConfig",
    "category": "core",
    "sourcePath": "config.ts",
    "fission": {
      "problem": "execute loadTriadConfig flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] TriadConfig (DEFAULT_CONFIG)",
        "[Ghost:Read] ensureTriadConfig (ensureTriadConfig)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "TriadConfig"
      ]
    }
  },
  {
    "nodeId": "Config.resolveCategoryFromConfig",
    "category": "core",
    "sourcePath": "config.ts",
    "fission": {
      "problem": "execute resolveCategoryFromConfig flow",
      "demand": [
        "string (sourcePath)",
        "TriadConfig (config)",
        "[Ghost:Read] normalizePath (normalizePath)",
        "[Ghost:Read] TriadCategory (TriadCategory)"
      ],
      "answer": [
        "TriadCategory"
      ]
    }
  },
  {
    "nodeId": "Config.shouldExcludeSourcePath",
    "category": "core",
    "sourcePath": "config.ts",
    "fission": {
      "problem": "execute shouldExcludeSourcePath flow",
      "demand": [
        "string (sourcePath)",
        "TriadConfig (config)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Generator.applyProtocol",
    "category": "core",
    "sourcePath": "generator.ts",
    "fission": {
      "problem": "execute applyProtocol flow",
      "demand": [
        "string (projectRoot)",
        "string (protocolPath)",
        "[Ghost:Read] resolveAdapter (resolveAdapter)"
      ],
      "answer": [
        "{ changedFiles: string[] }"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildFunctionStructure",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute buildFunctionStructure flow",
      "demand": [
        "ParsedNodeRef (ref)",
        "TriadNodeDefinition (node)",
        "OptionalKind<ParameterDeclarationStructure>[] (parameters)",
        "string (returnType)",
        "boolean (includeTodo)"
      ],
      "answer": [
        "OptionalKind<FunctionDeclarationStructure>"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildMethodStructure",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute buildMethodStructure flow",
      "demand": [
        "ParsedNodeRef (ref)",
        "TriadNodeDefinition (node)",
        "OptionalKind<ParameterDeclarationStructure>[] (parameters)",
        "string (returnType)",
        "boolean (includeTodo)",
        "[Ghost:Read] Scope (Scope)"
      ],
      "answer": [
        "OptionalKind<MethodDeclarationStructure>"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildParameters",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute buildParameters flow",
      "demand": [
        "string[] (demand)",
        "[Ghost:Read] OptionalKind (OptionalKind)",
        "[Ghost:Read] ParameterDeclarationStructure (ParameterDeclarationStructure)",
        "[Ghost:Read] parseDemandEntry (parseDemandEntry)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildTodoStatement",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute buildTodoStatement flow",
      "demand": [
        "string (nodeId)",
        "string (responsibility)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildTriadGeneratedDoc",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute buildTriadGeneratedDoc flow",
      "demand": [
        "string (responsibility)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.collectTypeTokens",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute collectTypeTokens flow",
      "demand": [
        "string (typeText)",
        "[Ghost:Read] getBuiltinTypeNames (getBuiltinTypeNames)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.getBuiltinTypeNames",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute getBuiltinTypeNames flow",
      "demand": [
        "None",
        "[Ghost:Read] Set (BUILTIN_TYPE_NAMES)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.normalizeToken",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute normalizeToken flow",
      "demand": [
        "string (value)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.resolveSourceFilePath",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute resolveSourceFilePath flow",
      "demand": [
        "string (projectRoot)",
        "ParsedNodeRef (ref)",
        "TriadNodeDefinition (node)",
        "NodeLocationMap (nodeLocations)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.resolveTypesModuleSpecifier",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute resolveTypesModuleSpecifier flow",
      "demand": [
        "string (projectRoot)",
        "SourceFile (sourceFile)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.shouldUseTopLevelFunction",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "execute shouldUseTopLevelFunction flow",
      "demand": [
        "SourceFile (sourceFile)",
        "ParsedNodeRef (ref)",
        "string (sourcePath)",
        "[Ghost:Read] normalizeToken (normalizeToken)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Healing.buildHealingPrompt",
    "category": "core",
    "sourcePath": "healing.ts",
    "fission": {
      "problem": "execute buildHealingPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (errorText)",
        "HealingDiagnosis (diagnosis)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] getHealingOutputRuleLines (getHealingOutputRuleLines)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Healing.diagnoseRuntimeFailure",
    "category": "core",
    "sourcePath": "healing.ts",
    "fission": {
      "problem": "execute diagnoseRuntimeFailure flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (errorText)",
        "number (retryCount)",
        "TriadNodeDefinition[] (nodes)",
        "[Ghost:Read] buildSummary (buildSummary)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "HealingDiagnosis"
      ]
    }
  },
  {
    "nodeId": "Healing.prepareHealingArtifacts",
    "category": "core",
    "sourcePath": "healing.ts",
    "fission": {
      "problem": "execute prepareHealingArtifacts flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (errorText)",
        "unknown (retryCount)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] HealingDiagnosis (HealingDiagnosis)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.buildEvidence",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute buildEvidence flow",
      "demand": [
        "string (errorText)",
        "RuntimeTraceFrame[] (traceFrames)",
        "TriadNodeDefinition | null (matchedNode)",
        "HealingBranchKind (diagnosis)",
        "BlastRadius (blastRadius)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.buildSummary",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute buildSummary flow",
      "demand": [
        "TriadNodeDefinition | null (matchedNode)",
        "HealingBranchKind (diagnosis)",
        "HealingActionKind (suggestedAction)",
        "BlastRadius (blastRadius)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.chooseSuggestedAction",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute chooseSuggestedAction flow",
      "demand": [
        "HealingBranchKind (diagnosis)",
        "number (retryCount)",
        "number (maxAutoRetries)"
      ],
      "answer": [
        "HealingActionKind"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.classifyDiagnosis",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute classifyDiagnosis flow",
      "demand": [
        "string (errorText)"
      ],
      "answer": [
        "HealingBranchKind"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.estimateBlastRadius",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute estimateBlastRadius flow",
      "demand": [
        "TriadNodeDefinition | null (rootNode)",
        "TriadNodeDefinition[] (nodes)",
        "boolean (isContractChange)"
      ],
      "answer": [
        "BlastRadius"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.getContractGuardLine",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute getContractGuardLine flow",
      "demand": [
        "boolean (requireHumanApprovalForContractChanges)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.getHealingOutputRuleLines",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute getHealingOutputRuleLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.parseTraceLine",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute parseTraceLine flow",
      "demand": [
        "string (line)",
        "string (projectRootNormalized)",
        "string (projectRoot)",
        "[Ghost:Read] normalizePath (normalizePath)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.scoreNodeMatch",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "execute scoreNodeMatch flow",
      "demand": [
        "RuntimeTraceFrame (frame)",
        "TriadNodeDefinition (node)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Ir.buildTopologyIR",
    "category": "core",
    "sourcePath": "ir.ts",
    "fission": {
      "problem": "execute buildTopologyIR flow",
      "demand": [
        "TriadNodeDefinition[] (nodes)",
        "TriadLanguage (language)"
      ],
      "answer": [
        "TriadTopologyIR"
      ]
    }
  },
  {
    "nodeId": "Parser.runParser",
    "category": "core",
    "sourcePath": "parser.ts",
    "fission": {
      "problem": "execute runParser flow",
      "demand": [
        "string (targetDir)",
        "string (outputPath)",
        "[Ghost:Read] resolveAdapter (resolveAdapter)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "PolyglotAdapter.createCppAdapter",
    "category": "core",
    "sourcePath": "polyglotAdapter.ts",
    "fission": {
      "problem": "execute createCppAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] createPolyglotAdapter (createPolyglotAdapter)",
        "[Ghost:Read] Record<PolyglotLanguage, LanguageDescriptor> (DESCRIPTORS)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "PolyglotAdapter.createGoAdapter",
    "category": "core",
    "sourcePath": "polyglotAdapter.ts",
    "fission": {
      "problem": "execute createGoAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] createPolyglotAdapter (createPolyglotAdapter)",
        "[Ghost:Read] Record<PolyglotLanguage, LanguageDescriptor> (DESCRIPTORS)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "PolyglotAdapter.createJavaAdapter",
    "category": "core",
    "sourcePath": "polyglotAdapter.ts",
    "fission": {
      "problem": "execute createJavaAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] createPolyglotAdapter (createPolyglotAdapter)",
        "[Ghost:Read] Record<PolyglotLanguage, LanguageDescriptor> (DESCRIPTORS)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "PolyglotAdapter.createJavaScriptAdapter",
    "category": "core",
    "sourcePath": "polyglotAdapter.ts",
    "fission": {
      "problem": "execute createJavaScriptAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] createPolyglotAdapter (createPolyglotAdapter)",
        "[Ghost:Read] Record<PolyglotLanguage, LanguageDescriptor> (DESCRIPTORS)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "PolyglotAdapter.createPythonAdapter",
    "category": "core",
    "sourcePath": "polyglotAdapter.ts",
    "fission": {
      "problem": "execute createPythonAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] createPolyglotAdapter (createPolyglotAdapter)",
        "[Ghost:Read] Record<PolyglotLanguage, LanguageDescriptor> (DESCRIPTORS)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "PolyglotAdapter.createRustAdapter",
    "category": "core",
    "sourcePath": "polyglotAdapter.ts",
    "fission": {
      "problem": "execute createRustAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] createPolyglotAdapter (createPolyglotAdapter)",
        "[Ghost:Read] Record<PolyglotLanguage, LanguageDescriptor> (DESCRIPTORS)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "Protocol.assertProtocolShape",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute assertProtocolShape flow",
      "demand": [
        "UpgradeProtocol (protocol)",
        "ProtocolValidationContext (context)",
        "[Ghost:Read] getUpgradeProtocolSchema (getUpgradeProtocolSchema)",
        "[Ghost:Read] UpgradeProtocol (UpgradeProtocol)",
        "[Ghost:Read] validateConfidenceRules (validateConfidenceRules)",
        "[Ghost:Read] validateTopologyRules (validateTopologyRules)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Protocol.normalizeCategory",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute normalizeCategory flow",
      "demand": [
        "string (category)",
        "TriadCategory (fallback)",
        "[Ghost:Read] getPrefixCategoryMap (getPrefixCategoryMap)"
      ],
      "answer": [
        "TriadCategory"
      ]
    }
  },
  {
    "nodeId": "Protocol.parseDemandEntry",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute parseDemandEntry flow",
      "demand": [
        "string (entry)",
        "number (index)"
      ],
      "answer": [
        "ParsedDemand | null"
      ]
    }
  },
  {
    "nodeId": "Protocol.parseNodeRef",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute parseNodeRef flow",
      "demand": [
        "string (nodeId)",
        "string (category)"
      ],
      "answer": [
        "ParsedNodeRef"
      ]
    }
  },
  {
    "nodeId": "Protocol.parseReturnType",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute parseReturnType flow",
      "demand": [
        "string (answer)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Protocol.readJsonFile",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute readJsonFile flow",
      "demand": [
        "string (filePath)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "T"
      ]
    }
  },
  {
    "nodeId": "Protocol.readTriadMap",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "execute readTriadMap flow",
      "demand": [
        "string (mapPath)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] getTriadNodeDefinitionSchema (getTriadNodeDefinitionSchema)",
        "[Ghost:Read] readJsonFile (readJsonFile)",
        "[Ghost:Read] TriadNodeDefinition (TriadNodeDefinition)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "ProtocolRightBranch.getPrefixCategoryMap",
    "category": "core",
    "sourcePath": "protocolRightBranch.ts",
    "fission": {
      "problem": "execute getPrefixCategoryMap flow",
      "demand": [
        "None",
        "[Ghost:Read] Record<string, TriadCategory> (PREFIX_CATEGORY_MAP)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "ProtocolRightBranch.getTriadNodeDefinitionSchema",
    "category": "core",
    "sourcePath": "protocolRightBranch.ts",
    "fission": {
      "problem": "execute getTriadNodeDefinitionSchema flow",
      "demand": [
        "None",
        "[Ghost:Read] object (triadNodeDefinitionSchema)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "ProtocolRightBranch.getUpgradeProtocolSchema",
    "category": "core",
    "sourcePath": "protocolRightBranch.ts",
    "fission": {
      "problem": "execute getUpgradeProtocolSchema flow",
      "demand": [
        "None",
        "[Ghost:Read] object (upgradeProtocolSchema)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Rules.installAlwaysOnRules",
    "category": "core",
    "sourcePath": "rules.ts",
    "fission": {
      "problem": "execute installAlwaysOnRules flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] buildCursorRule (buildCursorRule)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] module (path)",
        "[Ghost:Read] upsertAgentsMd (upsertAgentsMd)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Snapshot.collectProtocolSnapshotFiles",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "execute collectProtocolSnapshotFiles flow",
      "demand": [
        "WorkspacePaths (paths)",
        "UpgradeProtocol (protocol)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Snapshot.createSnapshot",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "execute createSnapshot flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (label)",
        "string[] (filePaths)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] normalizePath (normalizePath)",
        "[Ghost:Read] updateSnapshotIndex (updateSnapshotIndex)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Snapshot.listSnapshots",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "execute listSnapshots flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Snapshot.restoreSnapshot",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "execute restoreSnapshot flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (snapshotId)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] listSnapshots (listSnapshots)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Stage.analyzeWorkspaceStage",
    "category": "core",
    "sourcePath": "stage.ts",
    "fission": {
      "problem": "execute analyzeWorkspaceStage flow",
      "demand": [
        "StageAnalysisInput (input)"
      ],
      "answer": [
        "StageAnalysisResult"
      ]
    }
  },
  {
    "nodeId": "Sync.syncTriadMap",
    "category": "core",
    "sourcePath": "sync.ts",
    "fission": {
      "problem": "execute syncTriadMap flow",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (force)",
        "[Ghost:Read] default (chalk)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] resolveAdapter (resolveAdapter)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Sync.watchTriadMap",
    "category": "core",
    "sourcePath": "sync.ts",
    "fission": {
      "problem": "execute watchTriadMap flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] default (chalk)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "TreeSitterGhostScanner.scanTreeSitterGhostReferences",
    "category": "core",
    "sourcePath": "treeSitterGhostScanner.ts",
    "fission": {
      "problem": "execute scanTreeSitterGhostReferences flow",
      "demand": [
        "Parser.SyntaxNode (executableNode)",
        "TreeSitterGhostScanOptions (options)",
        "[Ghost:Read] collectLocalNames (collectLocalNames)",
        "[Ghost:Read] getGhostAccessMode (getGhostAccessMode)",
        "[Ghost:Read] isDeclarationName (isDeclarationName)",
        "[Ghost:Read] isIdentifierNode (isIdentifierNode)",
        "[Ghost:Read] isMemberExpression (isMemberExpression)",
        "[Ghost:Read] isMemberPropertyName (isMemberPropertyName)",
        "[Ghost:Read] isMemberRootIdentifier (isMemberRootIdentifier)",
        "[Ghost:Read] isOutermostMemberExpression (isOutermostMemberExpression)",
        "[Ghost:Read] mergeReference (mergeReference)",
        "[Ghost:Read] walkNodes (walkNodes)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "TreeSitterParser.runTreeSitterParser",
    "category": "core",
    "sourcePath": "treeSitterParser.ts",
    "fission": {
      "problem": "execute runTreeSitterParser flow",
      "demand": [
        "TriadLanguage (language)",
        "string (targetDir)",
        "string (outputPath)",
        "TriadConfig (config)",
        "[Ghost:Read] default (chalk)",
        "[Ghost:Read] collectLanguageNodes (collectLanguageNodes)",
        "[Ghost:Read] dedupeNodes (dedupeNodes)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] module (path)",
        "[Ghost:Read] Record<TriadLanguage, any> (TREE_SITTER_LANGUAGES)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "TreeSitterParser.runTreeSitterTypeScriptParser",
    "category": "core",
    "sourcePath": "treeSitterParser.ts",
    "fission": {
      "problem": "execute runTreeSitterTypeScriptParser flow",
      "demand": [
        "string (targetDir)",
        "string (outputPath)",
        "TriadConfig (config)",
        "[Ghost:Read] runTreeSitterParser (runTreeSitterParser)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "TypescriptAdapter.applyUpgradeProtocol",
    "category": "core",
    "sourcePath": "typescriptAdapter.ts",
    "fission": {
      "problem": "execute applyUpgradeProtocol flow",
      "demand": [
        "string (projectRoot)",
        "string (protocolPath)",
        "[Ghost:Read] applyTypeScriptProtocol (applyTypeScriptProtocol)"
      ],
      "answer": [
        "{ changedFiles: string[] }"
      ]
    }
  },
  {
    "nodeId": "TypescriptAdapter.createTypeScriptAdapter",
    "category": "core",
    "sourcePath": "typescriptAdapter.ts",
    "fission": {
      "problem": "execute createTypeScriptAdapter flow",
      "demand": [
        "None",
        "[Ghost:Read] applyUpgradeProtocol (applyUpgradeProtocol)",
        "[Ghost:Read] parseTopology (parseTopology)",
        "[Ghost:Read] readTopologyIR (readTopologyIR)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "TypescriptAdapter.parseTopology",
    "category": "core",
    "sourcePath": "typescriptAdapter.ts",
    "fission": {
      "problem": "execute parseTopology flow",
      "demand": [
        "string (projectRoot)",
        "string (outputPath)",
        "[Ghost:Read] runTreeSitterParser (runTreeSitterParser)",
        "[Ghost:Read] runTypeScriptParser (runTypeScriptParser)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "TypescriptAdapter.readTopologyIR",
    "category": "core",
    "sourcePath": "typescriptAdapter.ts",
    "fission": {
      "problem": "execute readTopologyIR flow",
      "demand": [
        "string (projectRoot)",
        "[Ghost:Read] buildTopologyIR (buildTopologyIR)",
        "[Ghost:Read] readTriadMap (readTriadMap)"
      ],
      "answer": [
        "TriadTopologyIR"
      ]
    }
  },
  {
    "nodeId": "TypescriptGenerator.applyTypeScriptProtocol",
    "category": "core",
    "sourcePath": "typescriptGenerator.ts",
    "fission": {
      "problem": "execute applyTypeScriptProtocol flow",
      "demand": [
        "string (projectRoot)",
        "string (protocolPath)",
        "[Ghost:Read] assertProtocolShape (assertProtocolShape)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] module (path)",
        "[Ghost:Read] UpgradeProtocol (UpgradeProtocol)",
        "[Ghost:Read] upsertNode (upsertNode)"
      ],
      "answer": [
        "{ changedFiles: string[] }"
      ]
    }
  },
  {
    "nodeId": "TypescriptParser.runTypeScriptParser",
    "category": "core",
    "sourcePath": "typescriptParser.ts",
    "fission": {
      "problem": "execute runTypeScriptParser flow",
      "demand": [
        "string (targetDir)",
        "string (outputPath)",
        "[Ghost:Read] default (chalk)",
        "[Ghost:Read] collectClassMethodNodes (collectClassMethodNodes)",
        "[Ghost:Read] collectExportedFunctionNodes (collectExportedFunctionNodes)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Visualizer.generateDashboard",
    "category": "core",
    "sourcePath": "visualizer.ts",
    "fission": {
      "problem": "execute generateDashboard flow",
      "demand": [
        "string (mapPath)",
        "string (protocolPath)",
        "string (outputPath)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] UpgradeProtocol (UpgradeProtocol)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildImplementationHandoffPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildImplementationHandoffPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (triadSpec)",
        "ImplementationHandoffInput (input)",
        "[Ghost:Read] getImplementationHandoffRuleLines (getImplementationHandoffRuleLines)",
        "[Ghost:Read] normalizePath (normalizePath)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildImplementationPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildImplementationPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] getImplementationExecutionWorkflowLines (getImplementationExecutionWorkflowLines)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMacroPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildMacroPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] buildMacroPromptShape (buildMacroPromptShape)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMasterPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildMasterPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] getMasterPromptExpectedBehaviorLines (getMasterPromptExpectedBehaviorLines)",
        "[Ghost:Read] getMasterPromptImplementationPhaseLines (getMasterPromptImplementationPhaseLines)",
        "[Ghost:Read] getMasterPromptProtocolPhaseLines (getMasterPromptProtocolPhaseLines)",
        "[Ghost:Read] getMasterPromptStageRouterLines (getMasterPromptStageRouterLines)",
        "[Ghost:Read] normalizePath (normalizePath)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMesoPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildMesoPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] buildMesoPromptShape (buildMesoPromptShape)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMicroPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildMicroPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] buildMicroPromptShape (buildMicroPromptShape)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildPipelinePrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildPipelinePrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildProtocolPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute buildProtocolPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] getProtocolOutputContractLines (getProtocolOutputContractLines)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.createDraftTemplate",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute createDraftTemplate flow",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (userDemand)",
        "unknown (force)",
        "[Ghost:Read] createDraftProtocolTemplate (createDraftProtocolTemplate)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.ensureMultiPassTemplates",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute ensureMultiPassTemplates flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "{ resetArtifacts?: boolean } (options)",
        "[Ghost:Read] buildMacroPrompt (buildMacroPrompt)",
        "[Ghost:Read] buildMesoPrompt (buildMesoPrompt)",
        "[Ghost:Read] buildMicroPrompt (buildMicroPrompt)",
        "[Ghost:Read] ensurePipelineArtifactSeeds (ensurePipelineArtifactSeeds)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] resetPipelineArtifacts (resetPipelineArtifacts)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.ensurePipelineArtifactSeeds",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute ensurePipelineArtifactSeeds flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] createMacroSplitSeed (createMacroSplitSeed)",
        "[Ghost:Read] createMesoSplitSeed (createMesoSplitSeed)",
        "[Ghost:Read] createMicroSplitSeed (createMicroSplitSeed)",
        "[Ghost:Read] writeJsonSeedIfMissing (writeJsonSeedIfMissing)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.ensureTriadSpec",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute ensureTriadSpec flow",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (force)",
        "[Ghost:Read] buildTriadSpec (buildTriadSpec)",
        "[Ghost:Read] ensureTriadConfig (ensureTriadConfig)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.resetPipelineArtifacts",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute resetPipelineArtifacts flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] createMacroSplitSeed (createMacroSplitSeed)",
        "[Ghost:Read] createMesoSplitSeed (createMesoSplitSeed)",
        "[Ghost:Read] createMicroSplitSeed (createMicroSplitSeed)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.writeImplementationHandoff",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute writeImplementationHandoff flow",
      "demand": [
        "WorkspacePaths (paths)",
        "ImplementationHandoffInput (input)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] writeMasterPrompt (writeMasterPrompt)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.writeMasterPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute writeMasterPrompt flow",
      "demand": [
        "WorkspacePaths (paths)",
        "[Ghost:Read] buildMasterPrompt (buildMasterPrompt)",
        "[Ghost:Read] ensureTriadSpec (ensureTriadSpec)",
        "[Ghost:Read] module (fs)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workflow.writePromptPacket",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "execute writePromptPacket flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] createDraftTemplate (createDraftTemplate)",
        "[Ghost:Read] ensureMultiPassTemplates (ensureMultiPassTemplates)",
        "[Ghost:Read] ensureTriadSpec (ensureTriadSpec)",
        "[Ghost:Read] module (fs)",
        "[Ghost:Read] writeMasterPrompt (writeMasterPrompt)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.buildMacroPromptShape",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute buildMacroPromptShape flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.buildMesoPromptShape",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute buildMesoPromptShape flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.buildMicroPromptShape",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute buildMicroPromptShape flow",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.buildTriadSpecDocument",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute buildTriadSpecDocument flow",
      "demand": [
        "string (projectName)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createDraftProtocolTemplate",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute createDraftProtocolTemplate flow",
      "demand": [
        "string (projectRoot)",
        "string (mapFile)",
        "unknown (userDemand)",
        "[Ghost:Read] normalizePath (normalizePath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createMacroSplitSeed",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute createMacroSplitSeed flow",
      "demand": [
        "string (userDemand)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createMesoSplitSeed",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute createMesoSplitSeed flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createMicroSplitSeed",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute createMicroSplitSeed flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getImplementationExecutionWorkflowLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getImplementationExecutionWorkflowLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getImplementationHandoffRuleLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getImplementationHandoffRuleLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptExpectedBehaviorLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getMasterPromptExpectedBehaviorLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptImplementationPhaseLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getMasterPromptImplementationPhaseLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptProtocolPhaseLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getMasterPromptProtocolPhaseLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptStageRouterLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getMasterPromptStageRouterLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getProtocolOutputContractLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "execute getProtocolOutputContractLines flow",
      "demand": [
        "None"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Workspace.getWorkspacePaths",
    "category": "core",
    "sourcePath": "workspace.ts",
    "fission": {
      "problem": "execute getWorkspacePaths flow",
      "demand": [
        "string (projectRoot)",
        "[Ghost:Read] module (path)"
      ],
      "answer": [
        "WorkspacePaths"
      ]
    }
  },
  {
    "nodeId": "Workspace.normalizePath",
    "category": "core",
    "sourcePath": "workspace.ts",
    "fission": {
      "problem": "execute normalizePath flow",
      "demand": [
        "string (input)"
      ],
      "answer": [
        "void"
      ]
    }
  }
]
```

[User Demand]
"角色与背景：你现在是底层架构师。我们要重构 cli.ts 的 triadmind plan 和 apply 流程，支持基于 Tree-sitter 的多语言生成分发。任务 1 (构建 Adapter 调度器)：在 cli.ts 中实现一个语言嗅探与调度逻辑：检查当前目标项目目录，若存在 tsconfig.json 则判定为 TypeScript；若存在 requirements.txt / pyproject.toml 则判定为 Python；若存在 go.mod 则判定为 Go。声明一个接口 interface ILanguageAdapter { applyProtocol(protocol: any, projectRoot: string): void }。任务 2 (组装拦截生命周期)：在 Init/Apply 之后：调用我们写好的 detectTopologicalDrift。若 isDegraded === true，拦截报错，拒绝执行。在 Plan 接收到 LLM 草案后：调用 calculateBlastRadius。若波及过多节点，发出警告。在最终 Apply 执行时：不再直接调用写死的 generator.ts，而是根据嗅探到的语言，将协议 JSON 传递给对应的 ILanguageAdapter 实例去执行代码生成。要求：请写出这个具有 Adapter 模式与多生命周期拦截机制的 cli.ts 核心控制流代码。"

[Pass 1: Macro-Split]
把需求切成：挂载点、左分支（子功能）、右分支（编排 / 配置）。结果写入 D:/TraidMind/triadmind-core/.triadmind/macro-split.json。

[Pass 2: Meso-Split]
基于 Macro 结果，把子功能切成类与数据管道。结果写入 D:/TraidMind/triadmind-core/.triadmind/meso-split.json。

[Pass 3: Micro-Split]
基于 Meso 结果，把类切成属性 / 状态和方法 / 动作，并明确 demand / answer。结果写入 D:/TraidMind/triadmind-core/.triadmind/micro-split.json。

[Final Protocol]
把三轮结果折叠进 D:/TraidMind/triadmind-core/.triadmind/draft-protocol.json，并提供可 apply 的 `actions`。

[Rules]
每一轮都必须继承上一轮，不能跳步。
如果上层拆分不稳定，就不能进入下层。
最终协议必须包含 `macroSplit`、`mesoSplit`、`microSplit`、`actions`。