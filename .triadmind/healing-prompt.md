[System]
你是 TriadMind 的 Runtime Self-Healing 架构师。
你的任务不是直接输出补丁代码，而是先根据运行时错误回溯到拓扑节点，再输出严格 JSON 升级协议。
优先使用 `modify` 修复当前节点；只有当重试预算耗尽或职责明显过载时，才允许 `create_child`。
如果判断为 Demand / Answer 契约变更，请只输出待审阅协议，不要假定可直接自动落盘。

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
1. 优先判断需求是否可以落在某个现有叶节点上。
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
3. actions 中每个元素只能使用 reuse / modify / create_child。
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

[Runtime Healing Config]
```json
{
  "enabled": true,
  "maxAutoRetries": 3,
  "requireHumanApprovalForContractChanges": true,
  "snapshotStrategy": "manual"
}
```

[Latest User Demand]
"将 triadmind-core 重构为遵从顶点三元法的自举系统：让 parser 能抽取模块级顶点，generator 能基于 sourcePath 修改模块函数，workflow 拆分为 workspace 与 stage 右分支，形成可自举的协议-实现闭环"

[Triad Map JSON]
```json
[
  {
    "nodeId": "Config.ensureTriadConfig",
    "category": "core",
    "sourcePath": "config.ts",
    "fission": {
      "problem": "执行 ensureTriadConfig 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (force)"
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
      "problem": "执行 loadTriadConfig 流程",
      "demand": [
        "WorkspacePaths (paths)"
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
      "problem": "执行 resolveCategoryFromConfig 流程",
      "demand": [
        "string (sourcePath)",
        "TriadConfig (config)"
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
      "problem": "执行 shouldExcludeSourcePath 流程",
      "demand": [
        "string (sourcePath)",
        "TriadConfig (config)"
      ],
      "answer": [
        "boolean"
      ]
    }
  },
  {
    "nodeId": "Generator.applyProtocol",
    "category": "core",
    "sourcePath": "generator.ts",
    "fission": {
      "problem": "执行 applyProtocol 流程",
      "demand": [
        "string (projectRoot)",
        "string (protocolPath)"
      ],
      "answer": [
        "{ changedFiles: string[]; }"
      ]
    }
  },
  {
    "nodeId": "Parser.runParser",
    "category": "core",
    "sourcePath": "parser.ts",
    "fission": {
      "problem": "执行 runParser 流程",
      "demand": [
        "string (targetDir)",
        "string (outputPath)"
      ],
      "answer": [
        "void"
      ]
    }
  },
  {
    "nodeId": "Protocol.assertProtocolShape",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "执行 assertProtocolShape 流程",
      "demand": [
        "UpgradeProtocol (protocol)",
        "ProtocolValidationContext (context)"
      ],
      "answer": [
        "{ actions: ({ op: \"reuse\"; nodeId: string; reason?: string | undefined; } | { op: \"modify\"; nodeId: string; fission: { problem: string; demand: string[]; answer: string[]; }; category?: \"frontend\" | \"backend\" | \"core\" | undefined; sourcePath?: string | undefined; reason?: string | undefined; reuse?: string[] | undefined; } | { op: \"create_child\"; parentNodeId: string; node: { nodeId: string; fission: { problem: string; demand: string[]; answer: string[]; }; category?: \"frontend\" | \"backend\" | \"core\" | undefined; sourcePath?: string | undefined; }; reason?: string | undefined; reuse?: string[] | undefined; })[]; protocolVersion?: string | undefined; project?: string | undefined; mapSource?: string | undefined; userDemand?: string | undefined; upgradePolicy?: { allowedOps?: (\"reuse\" | \"modify\" | \"create_child\")[] | undefined; principle?: string | undefined; } | undefined; macroSplit?: { anchorNodeId: string; vertexGoal: string; leftBranch: string[]; rightBranch: string[]; } | undefined; mesoSplit?: { classes: { className: string; category: string; responsibility: string; upstreams: string[]; downstreams: string[]; }[]; pipelines: { pipelineId: string; purpose: string; steps: string[]; }[]; } | undefined; microSplit?: { classes: { className: string; staticRightBranch: { name: string; type: string; role: string; }[]; dynamicLeftBranch: { name: string; demand: string[]; answer: string[]; responsibility: string; }[]; }[]; } | undefined; resultTopology?: { nodeId: string; fission: { problem: string; demand: string[]; answer: string[]; }; category?: \"frontend\" | \"backend\" | \"core\" | undefined; sourcePath?: string | undefined; }[] | undefined; }"
      ]
    }
  },
  {
    "nodeId": "Protocol.normalizeCategory",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "执行 normalizeCategory 流程",
      "demand": [
        "string (category)",
        "TriadCategory (fallback)"
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
      "problem": "执行 parseDemandEntry 流程",
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
      "problem": "执行 parseNodeRef 流程",
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
      "problem": "执行 parseReturnType 流程",
      "demand": [
        "string (answer)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Protocol.readTriadMap",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "执行 readTriadMap 流程",
      "demand": [
        "string (mapPath)"
      ],
      "answer": [
        "TriadNodeDefinition[]"
      ]
    }
  },
  {
    "nodeId": "Stage.analyzeWorkspaceStage",
    "category": "core",
    "sourcePath": "stage.ts",
    "fission": {
      "problem": "执行 analyzeWorkspaceStage 流程",
      "demand": [
        "StageAnalysisInput (input)"
      ],
      "answer": [
        "StageAnalysisResult"
      ]
    }
  },
  {
    "nodeId": "Visualizer.generateDashboard",
    "category": "core",
    "sourcePath": "visualizer.ts",
    "fission": {
      "problem": "执行 generateDashboard 流程",
      "demand": [
        "string (mapPath)",
        "string (protocolPath)",
        "string (outputPath)"
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
      "problem": "执行 buildImplementationHandoffPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (triadSpec)",
        "ImplementationHandoffInput (input)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildImplementationPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildImplementationPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMacroPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildMacroPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMasterPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildMasterPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMesoPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildMesoPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildMicroPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildMicroPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildPipelinePrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildPipelinePrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.buildProtocolPrompt",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 buildProtocolPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Workflow.createDraftTemplate",
    "category": "core",
    "sourcePath": "workflow.ts",
    "fission": {
      "problem": "执行 createDraftTemplate 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (userDemand)"
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
      "problem": "执行 ensureMultiPassTemplates 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
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
      "problem": "执行 ensureTriadSpec 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (force)"
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
      "problem": "执行 resetPipelineArtifacts 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
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
      "problem": "执行 writeImplementationHandoff 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "ImplementationHandoffInput (input)"
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
      "problem": "执行 writeMasterPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)"
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
      "problem": "执行 writePromptPacket 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (userDemand)"
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
      "problem": "执行 getWorkspacePaths 流程",
      "demand": [
        "string (projectRoot)"
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
      "problem": "执行 normalizePath 流程",
      "demand": [
        "string (input)"
      ],
      "answer": [
        "string"
      ]
    }
  }
]
```

[Runtime Error]
```text
TypeError: Cannot read properties of undefined (reading 'foo')
```

[Healing Diagnosis]
```json
{
  "projectRoot": "D:/TraidMind/triadmind-core",
  "adapterLanguage": "typescript",
  "retryCount": 0,
  "matchedNodeId": null,
  "matchedSourcePath": null,
  "diagnosis": "contract",
  "suggestedAction": "modify",
  "summary": "unknown node is classified as contract; suggested action is modify; blast radius is medium.",
  "blastRadius": {
    "impactedNodeIds": [],
    "risk": "medium"
  },
  "traceFrames": [],
  "evidence": [
    "diagnosis=contract",
    "traceFrames=0",
    "blastRadius=medium",
    "error=TypeError: Cannot read properties of undefined (reading 'foo')"
  ],
  "requiresHumanApproval": false
}
```

[Output Rules]
1. 先明确错误属于 left_branch / right_branch / contract / topology 哪一类。
2. 如果当前节点可修复，输出以 `modify` 为主的严格 JSON 协议。
3. 如果 retryCount 已达到上限，且节点职责过载，可提出 `create_child`。
4. 输出必须兼容 `.triadmind/draft-protocol.json`。
5. 只返回严格 JSON，不要返回 Markdown 解释。

[Output Target]
D:/TraidMind/triadmind-core/.triadmind/draft-protocol.json