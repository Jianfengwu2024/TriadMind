[System]
你现在处于顶点三元法工作流的第二阶段：协议已通过审核，骨架代码已落地。
你的任务不再是重新设计拓扑，而是在已批准拓扑内，基于骨架代码完成具体实现。

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

[User Demand]
"重构核心的 AST 解析与代码生成模块，引入"

[Approved Protocol JSON]
```json
{
  "protocolVersion": "1.1",
  "project": "triadmind-core",
  "mapSource": "D:/TraidMind/triadmind-core/.triadmind/triad-map.json",
  "userDemand": "重构核心的 AST 解析与代码生成模块，引入“多语言适配器（Language Adapter）”架构，解除核心引擎对 ts-morph 的硬编码绑定，实现多语言泛化支持。具体要求：1. 定义 LanguageAdapter 接口；2. 封装 TypeScriptAdapter；3. 新增 AdapterRegistry 动态路由；4. 改造 parser 和 generator 为纯调度器。",
  "upgradePolicy": {
    "allowedOps": [
      "reuse",
      "modify",
      "create_child"
    ],
    "principle": "优先复用 Adapter.resolveAdapter、Parser.runParser、Generator.applyProtocol；新增适配器契约、注册表与 TypeScript 适配器；parser/generator 只保留调度职责。"
  },
  "macroSplit": {
    "anchorNodeId": "Adapter.resolveAdapter",
    "vertexGoal": "将 AST 解析与代码生成从 ts-morph 绑定中抽离，升级为 LanguageAdapter 驱动的多语言泛化架构。",
    "leftBranch": [
      "定义 LanguageAdapter 统一接口，承载 readTopologyIR、parseTopology 与 applyUpgradeProtocol 动态能力",
      "封装 TypeScriptAdapter，把现有 TypeScript parser/generator 实现迁入适配器",
      "新增 AdapterRegistry，根据 .triadmind/config.json 动态选择语言适配器",
      "改造 parser 和 generator 为纯调度器，只委托当前 Adapter 执行"
    ],
    "rightBranch": [
      "TriadConfig.architecture.language / parserEngine / adapter 作为静态路由配置",
      "AdapterRegistry 作为稳定适配器目录，保存语言到适配器的映射关系",
      "Triad-IR / triad-map.json 作为跨语言中间拓扑契约",
      "协议 Schema 与 reuse/modify/create_child 规则保持核心引擎稳定边界"
    ]
  },
  "mesoSplit": {
    "classes": [
      {
        "className": "LanguageAdapter",
        "category": "core",
        "responsibility": "定义跨语言适配器契约，统一暴露拓扑解析、协议应用和能力描述入口。",
        "upstreams": [
          "Adapter.resolveAdapter",
          "TriadConfig.architecture"
        ],
        "downstreams": [
          "TypeScriptAdapter",
          "Parser.runParser",
          "Generator.applyProtocol"
        ]
      },
      {
        "className": "TypeScriptAdapter",
        "category": "core",
        "responsibility": "承接现有 TypeScript AST 解析与代码生成实现，作为 LanguageAdapter 的稳定 TS 插件实现。",
        "upstreams": [
          "LanguageAdapter",
          "AdapterRegistry"
        ],
        "downstreams": [
          "TypeScriptParser",
          "TypeScriptGenerator",
          "TreeSitterParser.runTreeSitterTypeScriptParser"
        ]
      },
      {
        "className": "AdapterRegistry",
        "category": "core",
        "responsibility": "维护语言到适配器的静态注册表，并根据项目配置动态解析当前适配器。",
        "upstreams": [
          "TriadConfig.architecture"
        ],
        "downstreams": [
          "Adapter.resolveAdapter",
          "LanguageAdapter"
        ]
      }
    ],
    "pipelines": [
      {
        "pipelineId": "language-adapter-resolution",
        "purpose": "根据项目静态配置选择当前语言适配器，避免核心引擎硬编码具体语言实现。",
        "steps": [
          "读取 .triadmind/config.json 的 architecture.language / parserEngine / adapter",
          "AdapterRegistry 校验目标语言是否已注册且可用",
          "resolveAdapter 返回符合 LanguageAdapter 契约的具体适配器",
          "parser/generator 调度器只依赖 LanguageAdapter 接口"
        ]
      },
      {
        "pipelineId": "topology-parse-dispatch",
        "purpose": "把源码拓扑抽取从 parser.ts 内部实现迁移为适配器委托流程。",
        "steps": [
          "ParserDispatcher 接收 projectRoot 与 outputPath",
          "ParserDispatcher 解析当前 LanguageAdapter",
          "LanguageAdapter.parseTopology 产出 triad-map 节点",
          "写入 .triadmind/triad-map.json 并保持跨语言格式一致"
        ]
      },
      {
        "pipelineId": "protocol-apply-dispatch",
        "purpose": "把代码骨架生成从 generator.ts 内部实现迁移为适配器委托流程。",
        "steps": [
          "GeneratorDispatcher 解析当前 LanguageAdapter",
          "LanguageAdapter.applyUpgradeProtocol 执行目标语言的 AST 或模板生成",
          "返回 changedFiles 并触发拓扑同步"
        ]
      }
    ]
  },
  "microSplit": {
    "classes": [
      {
        "className": "LanguageAdapter",
        "staticRightBranch": [
          {
            "name": "metadata",
            "type": "language/displayName/parserEngine/adapterPackage/status",
            "role": "描述适配器稳定身份、解析策略和插件包名。"
          }
        ],
        "dynamicLeftBranch": [
          {
            "name": "readTopologyIR",
            "demand": [
              "string (projectRoot)"
            ],
            "answer": [
              "TriadTopologyIR"
            ],
            "responsibility": "读取当前语言项目拓扑并映射为 Triad-IR。"
          },
          {
            "name": "parseTopology",
            "demand": [
              "string (projectRoot)",
              "string | undefined (outputPath)"
            ],
            "answer": [
              "void"
            ],
            "responsibility": "把目标语言源码解析为 triad-map 拓扑输出。"
          },
          {
            "name": "applyUpgradeProtocol",
            "demand": [
              "string (projectRoot)",
              "string | undefined (protocolPath)"
            ],
            "answer": [
              "{ changedFiles: string[] }"
            ],
            "responsibility": "把升级协议落地为目标语言骨架代码修改。"
          }
        ]
      }
    ]
  },
  "actions": [
    {
      "op": "reuse",
      "nodeId": "Adapter.resolveAdapter",
      "reason": "复用现有适配器入口作为多语言路由锚点。",
      "confidence": 0.96
    },
    {
      "op": "reuse",
      "nodeId": "Ir.buildTopologyIR",
      "reason": "复用现有 Triad-IR 构建能力作为跨语言拓扑契约。",
      "confidence": 0.9
    },
    {
      "op": "modify",
      "nodeId": "Parser.runParser",
      "category": "core",
      "sourcePath": "parser.ts",
      "fission": {
        "problem": "执行 runParser 流程",
        "demand": [
          "string (targetDir)",
          "string | undefined (outputPath)"
        ],
        "answer": [
          "void"
        ]
      },
      "reason": "parser 改造为纯调度器，委托 LanguageAdapter.parseTopology。",
      "confidence": 0.92
    },
    {
      "op": "modify",
      "nodeId": "Generator.applyProtocol",
      "category": "core",
      "sourcePath": "generator.ts",
      "fission": {
        "problem": "执行 applyProtocol 流程",
        "demand": [
          "string (projectRoot)",
          "string | undefined (protocolPath)"
        ],
        "answer": [
          "{ changedFiles: string[]; }"
        ]
      },
      "reason": "generator 改造为纯调度器，委托 LanguageAdapter.applyUpgradeProtocol。",
      "confidence": 0.92
    },
    {
      "op": "create_child",
      "parentNodeId": "Adapter.resolveAdapter",
      "node": {
        "nodeId": "AdapterRegistry.registerAdapter",
        "category": "core",
        "sourcePath": "adapterRegistry.ts",
        "fission": {
          "problem": "执行 registerAdapter 流程",
          "demand": [
            "LanguageAdapter (adapter)"
          ],
          "answer": [
            "void"
          ]
        }
      },
      "reason": "注册表需要独立维护语言到适配器的稳定映射。",
      "confidence": 0.91
    },
    {
      "op": "create_child",
      "parentNodeId": "Adapter.resolveAdapter",
      "node": {
        "nodeId": "AdapterRegistry.resolveAdapter",
        "category": "core",
        "sourcePath": "adapterRegistry.ts",
        "fission": {
          "problem": "执行 resolveAdapter 流程",
          "demand": [
            "WorkspacePaths | string (pathsOrProjectRoot)"
          ],
          "answer": [
            "LanguageAdapter"
          ]
        }
      },
      "reason": "把动态路由职责从 adapter.ts 提升为独立注册表顶点。",
      "confidence": 0.94
    },
    {
      "op": "create_child",
      "parentNodeId": "Adapter.getAvailableAdapters",
      "node": {
        "nodeId": "AdapterRegistry.getAvailableAdapters",
        "category": "core",
        "sourcePath": "adapterRegistry.ts",
        "fission": {
          "problem": "执行 getAvailableAdapters 流程",
          "demand": [
            "None"
          ],
          "answer": [
            "LanguageAdapter[]"
          ]
        }
      },
      "reason": "把适配器目录读取职责移动到注册表。",
      "confidence": 0.91
    },
    {
      "op": "create_child",
      "parentNodeId": "Adapter.resolveAdapter",
      "node": {
        "nodeId": "TypeScriptAdapter.readTopologyIR",
        "category": "core",
        "sourcePath": "typescriptAdapter.ts",
        "fission": {
          "problem": "执行 readTopologyIR 流程",
          "demand": [
            "string (projectRoot)"
          ],
          "answer": [
            "TriadTopologyIR"
          ]
        }
      },
      "reason": "TypeScript 适配器需要封装 Triad-IR 读取能力。",
      "confidence": 0.9
    },
    {
      "op": "create_child",
      "parentNodeId": "Parser.runParser",
      "node": {
        "nodeId": "TypeScriptAdapter.parseTopology",
        "category": "core",
        "sourcePath": "typescriptAdapter.ts",
        "fission": {
          "problem": "执行 parseTopology 流程",
          "demand": [
            "string (projectRoot)",
            "string | undefined (outputPath)"
          ],
          "answer": [
            "void"
          ]
        }
      },
      "reason": "TypeScript 适配器承接原 parser 的语言绑定实现。",
      "confidence": 0.94
    },
    {
      "op": "create_child",
      "parentNodeId": "Generator.applyProtocol",
      "node": {
        "nodeId": "TypeScriptAdapter.applyUpgradeProtocol",
        "category": "core",
        "sourcePath": "typescriptAdapter.ts",
        "fission": {
          "problem": "执行 applyUpgradeProtocol 流程",
          "demand": [
            "string (projectRoot)",
            "string | undefined (protocolPath)"
          ],
          "answer": [
            "{ changedFiles: string[] }"
          ]
        }
      },
      "reason": "TypeScript 适配器承接原 generator 的语言绑定实现。",
      "confidence": 0.94
    }
  ]
}
```

[Updated Triad Map JSON]
```json
[
  {
    "nodeId": "Adapter.getAvailableAdapters",
    "category": "core",
    "sourcePath": "adapter.ts",
    "fission": {
      "problem": "执行 getAvailableAdapters 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "TriadLanguageAdapter[]"
      ]
    }
  },
  {
    "nodeId": "Adapter.resolveAdapter",
    "category": "core",
    "sourcePath": "adapter.ts",
    "fission": {
      "problem": "执行 resolveAdapter 流程",
      "demand": [
        "WorkspacePaths | string (pathsOrProjectRoot)"
      ],
      "answer": [
        "TriadLanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "AdapterRegistry.getAvailableAdapters",
    "category": "core",
    "sourcePath": "adapterRegistry.ts",
    "fission": {
      "problem": "执行 getAvailableAdapters 流程",
      "demand": [
        "None"
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
      "problem": "执行 registerAdapter 流程",
      "demand": [
        "LanguageAdapter (adapter)"
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
      "problem": "执行 resolveAdapter 流程",
      "demand": [
        "WorkspacePaths | string (pathsOrProjectRoot)"
      ],
      "answer": [
        "LanguageAdapter"
      ]
    }
  },
  {
    "nodeId": "Bootstrap.buildSelfBootstrapArchitecture",
    "category": "core",
    "sourcePath": "bootstrap.ts",
    "fission": {
      "problem": "执行 buildSelfBootstrapArchitecture 流程",
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
      "problem": "执行 buildSelfBootstrapProtocol 流程",
      "demand": [
        "WorkspacePaths (paths)"
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
      "problem": "执行 writeSelfBootstrapProtocol 流程",
      "demand": [
        "WorkspacePaths (paths)"
      ],
      "answer": [
        "UpgradeProtocol"
      ]
    }
  },
  {
    "nodeId": "Bootstrap.writeSelfBootstrapReport",
    "category": "core",
    "sourcePath": "bootstrap.ts",
    "fission": {
      "problem": "执行 writeSelfBootstrapReport 流程",
      "demand": [
        "WorkspacePaths (paths)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getBootstrapModuleRoles",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "执行 getBootstrapModuleRoles 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "{ readonly Adapter: { readonly role: \"语言适配器选择层，把协议执行委托给当前项目语言插件。\"; readonly staticRightBranch: readonly [\"adapter registry\", \"language\", \"parserEngine\", \"adapterPackage\"]; }; readonly Bootstrap: { readonly role: \"自举证明层，把 TriadMind 自己描述为顶点三元架构。\"; readonly staticRightBranch: readonly [\"self-bootstrap.md\", \"self-bootstrap-protocol.json\"]; }; readonly BootstrapRightBranch: { readonly role: \"自举右分支目录，集中保存模块职责目录、节点复用清单和自举文案模板。\"; readonly staticRightBranch: readonly [\"module roles\", \"self bootstrap node ids\", \"rendering text\"]; }; readonly Config: { readonly role: \"静态配置层，约束解析器、协议置信度、运行时自愈和目录分类。\"; readonly staticRightBranch: readonly [\"TriadConfig\", \"DEFAULT_CONFIG\", \".triadmind/config.json\"]; }; readonly Generator: { readonly role: \"骨架落地左分支，把已批准协议真正落地为 TypeScript 源码结构。\"; readonly staticRightBranch: readonly [\"apply pipeline\", \"node upsert execution\"]; }; readonly GeneratorRightBranch: { readonly role: \"骨架生成右分支目录，集中保存类型白名单、源码路径策略和结构模板。\"; readonly staticRightBranch: readonly [\"builtin type names\", \"source path strategy\", \"method/function templates\"]; }; readonly Healing: { readonly role: \"运行时自愈左分支，把错误栈映射回拓扑节点并生成修复提示词。\"; readonly staticRightBranch: readonly [\"diagnosis pipeline\", \"artifact writing\"]; }; readonly HealingRightBranch: { readonly role: \"运行时自愈右分支目录，集中保存错误分类规则、blast radius 策略和 healing prompt 固定规则。\"; readonly staticRightBranch: readonly [\"classification regexes\", \"blast radius strategy\", \"prompt output rules\"]; }; readonly Ir: { readonly role: \"跨语言中间表示层，把语言 AST 映射为 Triad-IR。\"; readonly staticRightBranch: readonly [\"TriadTopologyIR\", \"TriadIRNode\", \"TriadIREdge\"]; }; readonly Parser: { readonly role: \"源码拓扑抽取层，把 TypeScript 源码抽取为 triad-map 叶节点。\"; readonly staticRightBranch: readonly [\"tsconfig.json\", \"JSDoc tags\", \"sourcePath\"]; }; readonly Protocol: { readonly role: \"协议编译器左分支，用 Schema 与拓扑规则拦截非法演化。\"; readonly staticRightBranch: readonly [\"validation pipeline\", \"node parsing\", \"topology checks\"]; }; readonly ProtocolRightBranch: { readonly role: \"协议右分支目录，集中保存类型、Schema、操作枚举和类别映射。\"; readonly staticRightBranch: readonly [\"Triad types\", \"Zod schemas\", \"prefix category map\"]; }; readonly Rules: { readonly role: \"Always-on 规则层，把顶点三元约束写入 AI 助手默认上下文。\"; readonly staticRightBranch: readonly [\"AGENTS.md\", \".cursor/rules/triadmind.mdc\", \"agent-rules.md\"]; }; readonly Snapshot: { readonly role: \"安全快照层，为 apply 和自愈循环提供可回滚边界。\"; readonly staticRightBranch: readonly [\"snapshot index\", \"snapshot files\", \"restore manifest\"]; }; readonly Stage: { readonly role: \"阶段识别层，判断当前处于规划、审核、实现还是修复阶段。\"; readonly staticRightBranch: readonly [\"StageAnalysisInput\", \"StageAnalysisResult\"]; }; readonly Sync: { readonly role: \"增量同步层，基于文件哈希保持 triad-map 与源码同步。\"; readonly staticRightBranch: readonly [\"sync-manifest.json\", \"sha256 file digests\"]; }; readonly TreeSitterParser: { readonly role: \"Tree-sitter 解析层，为跨语言泛化提供统一 AST 路径。\"; readonly staticRightBranch: readonly [\"tree-sitter grammar\", \"query patterns\"]; }; readonly Visualizer: { readonly role: \"拓扑审核层，把协议和现有地图渲染为知识图谱。\"; readonly staticRightBranch: readonly [\"visualizer.html\", \"node status\", \"edge status\"]; }; readonly Workflow: { readonly role: \"多轮推演编排左分支，生成 Macro/Meso/Micro/Protocol/Handoff 提示词。\"; readonly staticRightBranch: readonly [\"workflow execution pipeline\"]; }; readonly WorkflowRightBranch: { readonly role: \"工作流右分支目录，集中保存协议模板、阶段规则和提示词固定结构。\"; readonly staticRightBranch: readonly [\"draft templates\", \"stage router rules\", \"prompt shapes\"]; }; readonly Workspace: { readonly role: \"工作区路径层，统一描述 .triadmind 文件系统边界。\"; readonly staticRightBranch: readonly [\"WorkspacePaths\", \"projectRoot\", \".triadmind paths\"]; }; }"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapLoopLines",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "执行 getSelfBootstrapLoopLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapMicroRules",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "执行 getSelfBootstrapMicroRules 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapNodeIds",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "执行 getSelfBootstrapNodeIds 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "BootstrapRightBranch.getSelfBootstrapPreamble",
    "category": "core",
    "sourcePath": "bootstrapRightBranch.ts",
    "fission": {
      "problem": "执行 getSelfBootstrapPreamble 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string"
      ]
    }
  },
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
        "string | undefined (protocolPath)"
      ],
      "answer": [
        "{ changedFiles: string[]; }"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildFunctionStructure",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 buildFunctionStructure 流程",
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
      "problem": "执行 buildMethodStructure 流程",
      "demand": [
        "ParsedNodeRef (ref)",
        "TriadNodeDefinition (node)",
        "OptionalKind<ParameterDeclarationStructure>[] (parameters)",
        "string (returnType)",
        "boolean (includeTodo)"
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
      "problem": "执行 buildParameters 流程",
      "demand": [
        "string[] (demand)"
      ],
      "answer": [
        "OptionalKind<ParameterDeclarationStructure>[]"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildTodoStatement",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 buildTodoStatement 流程",
      "demand": [
        "string (nodeId)",
        "string (responsibility)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.buildTriadGeneratedDoc",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 buildTriadGeneratedDoc 流程",
      "demand": [
        "string (responsibility)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.collectTypeTokens",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 collectTypeTokens 流程",
      "demand": [
        "string (typeText)"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.getBuiltinTypeNames",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 getBuiltinTypeNames 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "Set<string>"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.normalizeToken",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 normalizeToken 流程",
      "demand": [
        "string (value)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.resolveSourceFilePath",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 resolveSourceFilePath 流程",
      "demand": [
        "string (projectRoot)",
        "ParsedNodeRef (ref)",
        "TriadNodeDefinition (node)",
        "NodeLocationMap (nodeLocations)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.resolveTypesModuleSpecifier",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 resolveTypesModuleSpecifier 流程",
      "demand": [
        "string (projectRoot)",
        "SourceFile (sourceFile)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "GeneratorRightBranch.shouldUseTopLevelFunction",
    "category": "core",
    "sourcePath": "generatorRightBranch.ts",
    "fission": {
      "problem": "执行 shouldUseTopLevelFunction 流程",
      "demand": [
        "SourceFile (sourceFile)",
        "ParsedNodeRef (ref)",
        "string (sourcePath)"
      ],
      "answer": [
        "boolean"
      ]
    }
  },
  {
    "nodeId": "Healing.buildHealingPrompt",
    "category": "core",
    "sourcePath": "healing.ts",
    "fission": {
      "problem": "执行 buildHealingPrompt 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (errorText)",
        "HealingDiagnosis (diagnosis)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "Healing.diagnoseRuntimeFailure",
    "category": "core",
    "sourcePath": "healing.ts",
    "fission": {
      "problem": "执行 diagnoseRuntimeFailure 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (errorText)",
        "number (retryCount)",
        "TriadNodeDefinition[] (nodes)"
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
      "problem": "执行 prepareHealingArtifacts 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (errorText)",
        "unknown (retryCount)"
      ],
      "answer": [
        "{ diagnosis: HealingDiagnosis; prompt: string; }"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.buildEvidence",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "执行 buildEvidence 流程",
      "demand": [
        "string (errorText)",
        "RuntimeTraceFrame[] (traceFrames)",
        "TriadNodeDefinition | null (matchedNode)",
        "HealingBranchKind (diagnosis)",
        "BlastRadius (blastRadius)"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.buildSummary",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "执行 buildSummary 流程",
      "demand": [
        "TriadNodeDefinition | null (matchedNode)",
        "HealingBranchKind (diagnosis)",
        "HealingActionKind (suggestedAction)",
        "BlastRadius (blastRadius)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.chooseSuggestedAction",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "执行 chooseSuggestedAction 流程",
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
      "problem": "执行 classifyDiagnosis 流程",
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
      "problem": "执行 estimateBlastRadius 流程",
      "demand": [
        "TriadNodeDefinition | null (rootNode)",
        "TriadNodeDefinition[] (nodes)"
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
      "problem": "执行 getContractGuardLine 流程",
      "demand": [
        "boolean (requireHumanApprovalForContractChanges)"
      ],
      "answer": [
        "\"如果判断为 Demand / Answer 契约变更，请只输出待审阅协议，不要假定可直接自动落盘。\" | \"契约变更允许自动生成待执行协议。\""
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.getHealingOutputRuleLines",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "执行 getHealingOutputRuleLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.parseTraceLine",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "执行 parseTraceLine 流程",
      "demand": [
        "string (line)",
        "string (projectRootNormalized)",
        "string (projectRoot)"
      ],
      "answer": [
        "{ raw: string; sourcePath: string; line: number; column: number; symbol: string | undefined; } | null"
      ]
    }
  },
  {
    "nodeId": "HealingRightBranch.scoreNodeMatch",
    "category": "core",
    "sourcePath": "healingRightBranch.ts",
    "fission": {
      "problem": "执行 scoreNodeMatch 流程",
      "demand": [
        "RuntimeTraceFrame (frame)",
        "TriadNodeDefinition (node)"
      ],
      "answer": [
        "number"
      ]
    }
  },
  {
    "nodeId": "Ir.buildTopologyIR",
    "category": "core",
    "sourcePath": "ir.ts",
    "fission": {
      "problem": "执行 buildTopologyIR 流程",
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
      "problem": "执行 runParser 流程",
      "demand": [
        "string (targetDir)",
        "string | undefined (outputPath)"
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
        "UpgradeProtocol"
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
    "nodeId": "Protocol.readJsonFile",
    "category": "core",
    "sourcePath": "protocol.ts",
    "fission": {
      "problem": "执行 readJsonFile 流程",
      "demand": [
        "string (filePath)"
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
    "nodeId": "ProtocolRightBranch.getPrefixCategoryMap",
    "category": "core",
    "sourcePath": "protocolRightBranch.ts",
    "fission": {
      "problem": "执行 getPrefixCategoryMap 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "Record<string, TriadCategory>"
      ]
    }
  },
  {
    "nodeId": "ProtocolRightBranch.getTriadNodeDefinitionSchema",
    "category": "core",
    "sourcePath": "protocolRightBranch.ts",
    "fission": {
      "problem": "执行 getTriadNodeDefinitionSchema 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "z.ZodObject<{ nodeId: z.ZodString; category: z.ZodOptional<z.ZodEnum<{ frontend: \"frontend\"; backend: \"backend\"; core: \"core\"; }>>; sourcePath: z.ZodOptional<z.ZodString>; fission: z.ZodObject<{ problem: z.ZodString; demand: z.ZodArray<z.ZodString>; answer: z.ZodArray<z.ZodString>; }, z.core.$strip>; }, z.core.$strip>"
      ]
    }
  },
  {
    "nodeId": "ProtocolRightBranch.getUpgradeProtocolSchema",
    "category": "core",
    "sourcePath": "protocolRightBranch.ts",
    "fission": {
      "problem": "执行 getUpgradeProtocolSchema 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "z.ZodObject<{ protocolVersion: z.ZodOptional<z.ZodString>; project: z.ZodOptional<z.ZodString>; mapSource: z.ZodOptional<z.ZodString>; userDemand: z.ZodOptional<z.ZodString>; upgradePolicy: z.ZodOptional<z.ZodObject<{ allowedOps: z.ZodOptional<z.ZodArray<z.ZodEnum<{ modify: \"modify\"; create_child: \"create_child\"; reuse: \"reuse\"; }>>>; principle: z.ZodOptional<z.ZodString>; }, z.core.$strip>>; macroSplit: z.ZodOptional<z.ZodObject<{ anchorNodeId: z.ZodString; vertexGoal: z.ZodString; leftBranch: z.ZodArray<z.ZodString>; rightBranch: z.ZodArray<z.ZodString>; }, z.core.$strip>>; mesoSplit: z.ZodOptional<z.ZodObject<{ classes: z.ZodArray<z.ZodObject<{ className: z.ZodString; category: z.ZodString; responsibility: z.ZodString; upstreams: z.ZodArray<z.ZodString>; downstreams: z.ZodArray<z.ZodString>; }, z.core.$strip>>; pipelines: z.ZodArray<z.ZodObject<{ pipelineId: z.ZodString; purpose: z.ZodString; steps: z.ZodArray<z.ZodString>; }, z.core.$strip>>; }, z.core.$strip>>; microSplit: z.ZodOptional<z.ZodObject<{ classes: z.ZodArray<z.ZodObject<{ className: z.ZodString; staticRightBranch: z.ZodArray<z.ZodObject<{ name: z.ZodString; type: z.ZodString; role: z.ZodString; }, z.core.$strip>>; dynamicLeftBranch: z.ZodArray<z.ZodObject<{ name: z.ZodString; demand: z.ZodArray<z.ZodString>; answer: z.ZodArray<z.ZodString>; responsibility: z.ZodString; }, z.core.$strip>>; }, z.core.$strip>>; }, z.core.$strip>>; actions: z.ZodArray<z.ZodDiscriminatedUnion<[z.ZodObject<{ op: z.ZodLiteral<\"reuse\">; nodeId: z.ZodString; reason: z.ZodOptional<z.ZodString>; confidence: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>, z.ZodObject<{ op: z.ZodLiteral<\"modify\">; nodeId: z.ZodString; category: z.ZodOptional<z.ZodEnum<{ frontend: \"frontend\"; backend: \"backend\"; core: \"core\"; }>>; sourcePath: z.ZodOptional<z.ZodString>; fission: z.ZodObject<{ problem: z.ZodString; demand: z.ZodArray<z.ZodString>; answer: z.ZodArray<z.ZodString>; }, z.core.$strip>; reason: z.ZodOptional<z.ZodString>; reuse: z.ZodOptional<z.ZodArray<z.ZodString>>; confidence: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>, z.ZodObject<{ op: z.ZodLiteral<\"create_child\">; parentNodeId: z.ZodString; node: z.ZodObject<{ nodeId: z.ZodString; category: z.ZodOptional<z.ZodEnum<{ frontend: \"frontend\"; backend: \"backend\"; core: \"core\"; }>>; sourcePath: z.ZodOptional<z.ZodString>; fission: z.ZodObject<{ problem: z.ZodString; demand: z.ZodArray<z.ZodString>; answer: z.ZodArray<z.ZodString>; }, z.core.$strip>; }, z.core.$strip>; reason: z.ZodOptional<z.ZodString>; reuse: z.ZodOptional<z.ZodArray<z.ZodString>>; confidence: z.ZodOptional<z.ZodNumber>; }, z.core.$strip>], \"op\">>; resultTopology: z.ZodOptional<z.ZodArray<z.ZodObject<{ nodeId: z.ZodString; category: z.ZodOptional<z.ZodEnum<{ frontend: \"frontend\"; backend: \"backend\"; core: \"core\"; }>>; sourcePath: z.ZodOptional<z.ZodString>; fission: z.ZodObject<{ problem: z.ZodString; demand: z.ZodArray<z.ZodString>; answer: z.ZodArray<z.ZodString>; }, z.core.$strip>; }, z.core.$strip>>>; }, z.core.$strip>"
      ]
    }
  },
  {
    "nodeId": "Rules.installAlwaysOnRules",
    "category": "core",
    "sourcePath": "rules.ts",
    "fission": {
      "problem": "执行 installAlwaysOnRules 流程",
      "demand": [
        "WorkspacePaths (paths)"
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
      "problem": "执行 collectProtocolSnapshotFiles 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "UpgradeProtocol (protocol)"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "Snapshot.createSnapshot",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "执行 createSnapshot 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (label)",
        "string[] (filePaths)"
      ],
      "answer": [
        "TriadSnapshot"
      ]
    }
  },
  {
    "nodeId": "Snapshot.listSnapshots",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "执行 listSnapshots 流程",
      "demand": [
        "WorkspacePaths (paths)"
      ],
      "answer": [
        "Pick<TriadSnapshot, \"id\" | \"label\" | \"createdAt\">[]"
      ]
    }
  },
  {
    "nodeId": "Snapshot.restoreSnapshot",
    "category": "core",
    "sourcePath": "snapshot.ts",
    "fission": {
      "problem": "执行 restoreSnapshot 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "string (snapshotId)"
      ],
      "answer": [
        "TriadSnapshot"
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
    "nodeId": "Sync.syncTriadMap",
    "category": "core",
    "sourcePath": "sync.ts",
    "fission": {
      "problem": "执行 syncTriadMap 流程",
      "demand": [
        "WorkspacePaths (paths)",
        "unknown (force)"
      ],
      "answer": [
        "{ changed: boolean; fileCount: number; }"
      ]
    }
  },
  {
    "nodeId": "Sync.watchTriadMap",
    "category": "core",
    "sourcePath": "sync.ts",
    "fission": {
      "problem": "执行 watchTriadMap 流程",
      "demand": [
        "WorkspacePaths (paths)"
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
      "problem": "执行 runTreeSitterTypeScriptParser 流程",
      "demand": [
        "string (targetDir)",
        "string (outputPath)",
        "TriadConfig (config)"
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
      "problem": "执行 applyUpgradeProtocol 流程",
      "demand": [
        "string (projectRoot)",
        "string | undefined (protocolPath)"
      ],
      "answer": [
        "{ changedFiles: string[] }"
      ]
    }
  },
  {
    "nodeId": "TypescriptAdapter.parseTopology",
    "category": "core",
    "sourcePath": "typescriptAdapter.ts",
    "fission": {
      "problem": "执行 parseTopology 流程",
      "demand": [
        "string (projectRoot)",
        "string | undefined (outputPath)"
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
      "problem": "执行 readTopologyIR 流程",
      "demand": [
        "string (projectRoot)"
      ],
      "answer": [
        "TriadTopologyIR"
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
        "string (userDemand)",
        "{ resetArtifacts?: boolean } (options)"
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
      "problem": "执行 ensurePipelineArtifactSeeds 流程",
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
    "nodeId": "WorkflowRightBranch.buildMacroPromptShape",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 buildMacroPromptShape 流程",
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
    "nodeId": "WorkflowRightBranch.buildMesoPromptShape",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 buildMesoPromptShape 流程",
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
    "nodeId": "WorkflowRightBranch.buildMicroPromptShape",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 buildMicroPromptShape 流程",
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
    "nodeId": "WorkflowRightBranch.buildTriadSpecDocument",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 buildTriadSpecDocument 流程",
      "demand": [
        "string (projectName)"
      ],
      "answer": [
        "string"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createDraftProtocolTemplate",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 createDraftProtocolTemplate 流程",
      "demand": [
        "string (projectRoot)",
        "string (mapFile)",
        "unknown (userDemand)"
      ],
      "answer": [
        "{ protocolVersion: string; project: string; mapSource: string; userDemand: string; upgradePolicy: { allowedOps: string[]; principle: string; }; macroSplit: { anchorNodeId: string; vertexGoal: string; leftBranch: never[]; rightBranch: never[]; }; mesoSplit: { classes: never[]; pipelines: never[]; }; microSplit: { classes: never[]; }; actions: never[]; }"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createMacroSplitSeed",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 createMacroSplitSeed 流程",
      "demand": [
        "string (userDemand)"
      ],
      "answer": [
        "{ anchorNodeId: string; vertexGoal: string; leftBranch: never[]; rightBranch: never[]; }"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createMesoSplitSeed",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 createMesoSplitSeed 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "{ classes: never[]; pipelines: never[]; }"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.createMicroSplitSeed",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 createMicroSplitSeed 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "{ classes: never[]; }"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getImplementationExecutionWorkflowLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getImplementationExecutionWorkflowLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getImplementationHandoffRuleLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getImplementationHandoffRuleLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptExpectedBehaviorLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getMasterPromptExpectedBehaviorLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptImplementationPhaseLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getMasterPromptImplementationPhaseLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptProtocolPhaseLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getMasterPromptProtocolPhaseLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getMasterPromptStageRouterLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getMasterPromptStageRouterLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
      ]
    }
  },
  {
    "nodeId": "WorkflowRightBranch.getProtocolOutputContractLines",
    "category": "core",
    "sourcePath": "workflowRightBranch.ts",
    "fission": {
      "problem": "执行 getProtocolOutputContractLines 流程",
      "demand": [
        "None"
      ],
      "answer": [
        "string[]"
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

[Skeleton Files]
[Skeleton File] parser.ts
```ts
import { Project, SourceFile } from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import chalk from 'chalk';
import { getWorkspacePaths, normalizePath } from './workspace';
import { loadTriadConfig, resolveCategoryFromConfig, shouldExcludeSourcePath, TriadConfig } from './config';

interface TriadNode {
    nodeId: string;
    category: string;
    sourcePath: string;
    fission: {
        problem: string;
        demand: string[];
        answer: string[];
    };
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 runParser 流程
 */
export function runParser(targetDir: string, outputPath?: string | undefined): void {
    console.log(chalk.gray('   - [Parser] 正在扫描 TypeScript AST，回写项目拓扑地图...'));

    const tsConfigFilePath = path.join(targetDir, 'tsconfig.json');
    if (!fs.existsSync(tsConfigFilePath)) {
        throw new Error(`目标目录下缺少 tsconfig.json：${tsConfigFilePath}`);
    }

    const triadDir = path.join(targetDir, '.triadmind');
    fs.mkdirSync(triadDir, { recursive: true });
    const workspacePaths = getWorkspacePaths(targetDir);
    const config = loadTriadConfig(workspacePaths);

    const resolvedOutputPath = outputPath ?? path.join(triadDir, 'triad-map.json');

    const project = new Project({
        tsConfigFilePath
    });

    const triadGraph: TriadNode[] = [];
    const sourceFiles = project
        .getSourceFiles()
        .filter(
            (file) =>
                !file.getFilePath().endsWith('.d.ts') &&
                !file.getBaseName().endsWith('types.ts') &&
                !shouldExcludeSourcePath(path.relative(targetDir, file.getFilePath()), config)
        );

    for (const sourceFile of sourceFiles) {
        const filePath = sourceFile.getFilePath();
        const sourcePath = normalizePath(path.relative(targetDir, filePath));
        const category = resolveCategoryFromConfig(sourcePath, config);

        collectClassMethodNodes(sourceFile, category, sourcePath, triadGraph, config);
        collectExportedFunctionNodes(sourceFile, category, sourcePath, triadGraph, config);
    }

    triadGraph.sort((left, right) => left.nodeId.localeCompare(right.nodeId));
    fs.writeFileSync(resolvedOutputPath, JSON.stringify(triadGraph, null, 2), 'utf-8');
    console.log(chalk.gray(`   - [Parser] 扫描完成，共抽取 ${triadGraph.length} 个叶节点。`));
}

function collectClassMethodNodes(
    sourceFile: SourceFile,
    category: string,
    sourcePath: string,
    triadGraph: TriadNode[],
    config: TriadConfig
) {
    for (const cls of sourceFile.getClasses()) {
        const className = cls.getName();
        if (!className) {
            continue;
        }

        const classHasTriadTag = hasTriadTag(cls, config);

        for (const method of cls.getMethods()) {
            if (method.getName() === 'constructor') {
                continue;
            }

            const scope = method.getScope();
            if (scope === 'private' || scope === 'protected') {
                continue;
            }

            if (!config.parser.includeUntaggedExports && !classHasTriadTag && !hasTriadTag(method, config)) {
                continue;
            }

            const demand = method.getParameters().map((parameter) => {
                const typeName = parameter.getTypeNode()?.getText() ?? 'unknown';
                return `${typeName} (${parameter.getName()})`;
            });

            const answer = method.getReturnTypeNode()?.getText() ?? method.getReturnType().getText(method);

            triadGraph.push({
                nodeId: `${className}.${method.getName()}`,
                category,
                sourcePath,
                fission: {
                    problem: `执行 ${method.getName()} 流程`,
                    demand: demand.length > 0 ? demand : ['None'],
                    answer: [answer]
                }
            });
        }
    }
}

function collectExportedFunctionNodes(
    sourceFile: SourceFile,
    category: string,
    sourcePath: string,
    triadGraph: TriadNode[],
    config: TriadConfig
) {
    const moduleName = toPascalCase(sourceFile.getBaseNameWithoutExtension());

    for (const fn of sourceFile.getFunctions()) {
        const functionName = fn.getName();
        if (!functionName || !fn.isExported()) {
            continue;
        }

        if (!config.parser.includeUntaggedExports && !hasTriadTag(fn, config)) {
            continue;
        }

        const demand = fn.getParameters().map((parameter) => {
            const typeName = parameter.getTypeNode()?.getText() ?? 'unknown';
            return `${typeName} (${parameter.getName()})`;
        });

        const answer = fn.getReturnTypeNode()?.getText() ?? fn.getReturnType().getText(fn);

        triadGraph.push({
            nodeId: `${moduleName}.${functionName}`,
            category,
            sourcePath,
            fission: {
                problem: `执行 ${functionName} 流程`,
                demand: demand.length > 0 ? demand : ['None'],
                answer: [answer]
            }
        });
    }
}

function toPascalCase(value: string) {
    return value
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join('');
}

function hasTriadTag(node: { getJsDocs(): Array<{ getTags(): Array<{ getTagName(): string }> }> }, config: TriadConfig) {
    const supportedTags = new Set([
        config.parser.jsDocTags.triadNode,
        config.parser.jsDocTags.leftBranch,
        config.parser.jsDocTags.rightBranch
    ]);

    return node
        .getJsDocs()
        .flatMap((doc) => doc.getTags())
        .some((tag) => supportedTags.has(tag.getTagName()));
}
```

[Skeleton File] generator.ts
```ts
import {
    FunctionDeclaration,
    MethodDeclaration,
    OptionalKind,
    ParameterDeclarationStructure,
    Project,
    SourceFile
} from 'ts-morph';
import * as fs from 'fs';
import * as path from 'path';
import { loadTriadConfig } from './config';
import {
    buildFunctionStructure,
    buildMethodStructure,
    buildParameters,
    buildTodoStatement,
    buildTriadGeneratedDoc,
    collectTypeTokens,
    NodeLocationMap,
    resolveSourceFilePath,
    resolveTypesModuleSpecifier,
    shouldUseTopLevelFunction
} from './generatorRightBranch';
import { getWorkspacePaths } from './workspace';
import {
    assertProtocolShape,
    CreateChildAction,
    ModifyAction,
    parseDemandEntry,
    parseNodeRef,
    parseReturnType,
    ParsedNodeRef,
    readJsonFile,
    readTriadMap,
    TriadNodeDefinition,
    UpgradeProtocol
} from './protocol';

/**
 * TriadMind 自动生成骨架
 * 职责：执行 applyProtocol 流程
 */
export function applyProtocol(projectRoot: string, protocolPath?: string | undefined): { changedFiles: string[]; } {
    const resolvedProjectRoot = path.resolve(projectRoot);
    const resolvedProtocolPath = protocolPath ?? path.join(resolvedProjectRoot, '.triadmind', 'draft-protocol.json');
    const tsConfigFilePath = path.join(resolvedProjectRoot, 'tsconfig.json');

    if (!fs.existsSync(resolvedProtocolPath)) {
        throw new Error(`找不到协议文件：${resolvedProtocolPath}`);
    }

    if (!fs.existsSync(tsConfigFilePath)) {
        throw new Error(`找不到 tsconfig.json：${tsConfigFilePath}`);
    }

    const protocol = readJsonFile<UpgradeProtocol>(resolvedProtocolPath);
    const triadMapPath = path.join(resolvedProjectRoot, '.triadmind', 'triad-map.json');
    const existingNodes = readTriadMap(triadMapPath);
    const config = loadTriadConfig(getWorkspacePaths(resolvedProjectRoot));
    assertProtocolShape(protocol, {
        existingNodes,
        minConfidence: config.protocol.minConfidence,
        requireConfidence: config.protocol.requireConfidence
    });

    const project = new Project({
        tsConfigFilePath
    });

    const exportedTypeNames = getExportedTypeNames(project, resolvedProjectRoot);
    const nodeLocations = loadNodeLocations(resolvedProjectRoot);
    const changedFiles = new Set<string>();

    for (const action of protocol.actions) {
        if (action.op === 'reuse') {
            continue;
        }

        if (action.op === 'create_child') {
            changedFiles.add(
                upsertNode(project, resolvedProjectRoot, action.node, exportedTypeNames, nodeLocations, action)
            );
            continue;
        }

        if (action.op === 'modify') {
            changedFiles.add(
                upsertNode(
                    project,
                    resolvedProjectRoot,
                    {
                        nodeId: action.nodeId,
                        category: action.category,
                        sourcePath: action.sourcePath,
                        fission: action.fission
                    },
                    exportedTypeNames,
                    nodeLocations,
                    action
                )
            );
        }
    }

    project.saveSync();
    const normalizedFiles = Array.from(changedFiles).map((filePath) => path.relative(resolvedProjectRoot, filePath));
    console.log(`[TriadMind] 协议执行完成，涉及 ${normalizedFiles.length} 个源码文件。`);

    return {
        changedFiles: normalizedFiles
    };
}

function upsertNode(
    project: Project,
    projectRoot: string,
    node: TriadNodeDefinition,
    exportedTypeNames: Set<string>,
    nodeLocations: NodeLocationMap,
    action: CreateChildAction | ModifyAction
) {
    const ref = parseNodeRef(node.nodeId, node.category);
    const filePath = resolveSourceFilePath(projectRoot, ref, node, nodeLocations);
    const sourceFile =
        project.getSourceFile(filePath) ?? project.createSourceFile(filePath, '', { overwrite: false });

    ensureTypeImports(projectRoot, sourceFile, exportedTypeNames, node);

    if (shouldUseTopLevelFunction(sourceFile, ref, node.sourcePath)) {
        upsertFunctionVertex(sourceFile, ref, node, action);
    } else {
        upsertClassVertex(sourceFile, ref, node, action);
    }

    sourceFile.formatText({
        indentSize: 4
    });

    return filePath;
}

function upsertClassVertex(
    sourceFile: SourceFile,
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    action: CreateChildAction | ModifyAction
) {
    const cls =
        sourceFile.getClass(ref.className) ??
        sourceFile.addClass({
            name: ref.className,
            isExported: true
        });

    const existingMethod = cls.getMethod(ref.methodName);
    const parameters = buildParameters(node.fission.demand);
    const returnType = parseReturnType(node.fission.answer[0] ?? 'void');

    if (!existingMethod) {
        cls.addMethod(buildMethodStructure(ref, node, parameters, returnType, action.op === 'create_child'));
    } else {
        syncMethod(existingMethod, parameters, returnType, node);
    }
}

function upsertFunctionVertex(
    sourceFile: SourceFile,
    ref: ParsedNodeRef,
    node: TriadNodeDefinition,
    action: CreateChildAction | ModifyAction
) {
    const existingFunction = sourceFile.getFunction(ref.methodName);
    const parameters = buildParameters(node.fission.demand);
    const returnType = parseReturnType(node.fission.answer[0] ?? 'void');

    if (!existingFunction) {
        sourceFile.addFunction(buildFunctionStructure(ref, node, parameters, returnType, action.op === 'create_child'));
    } else {
        syncFunction(existingFunction, parameters, returnType, node);
    }
}

function syncMethod(
    method: MethodDeclaration,
    parameters: OptionalKind<ParameterDeclarationStructure>[],
    returnType: string,
    node: TriadNodeDefinition
) {
    const existingParameters = method.getParameters();

    for (let index = existingParameters.length - 1; index >= parameters.length; index -= 1) {
        existingParameters[index].remove();
    }

    parameters.forEach((parameter, index) => {
        const existing = method.getParameters()[index];
        if (!existing) {
            method.insertParameter(index, parameter);
            return;
        }

        existing.rename(parameter.name);
        existing.setType(parameter.type ?? 'unknown');
    });

    method.setReturnType(returnType);
    replaceDocs(method, node.fission.problem);

    if (method.getStatements().length === 0) {
        method.addStatements([buildTodoStatement(node.nodeId, node.fission.problem)]);
    }
}

function syncFunction(
    fn: FunctionDeclaration,
    parameters: OptionalKind<ParameterDeclarationStructure>[],
    returnType: string,
    node: TriadNodeDefinition
) {
    const existingParameters = fn.getParameters();

    for (let index = existingParameters.length - 1; index >= parameters.length; index -= 1) {
        existingParameters[index].remove();
    }

    parameters.forEach((parameter, index) => {
        const existing = fn.getParameters()[index];
        if (!existing) {
            fn.insertParameter(index, parameter);
            return;
        }

        existing.rename(parameter.name);
        existing.setType(parameter.type ?? 'unknown');
    });

    fn.setReturnType(returnType);
    fn.setIsExported(true);
    replaceDocs(fn, node.fission.problem);

    if (fn.getStatements().length === 0) {
        fn.addStatements([buildTodoStatement(node.nodeId, node.fission.problem)]);
    }
}

function ensureTypeImports(
    projectRoot: string,
    sourceFile: SourceFile,
    exportedTypeNames: Set<string>,
    node: TriadNodeDefinition
) {
    const referencedTypes = new Set<string>();
    for (const demand of node.fission.demand) {
        const parsed = parseDemandEntry(demand, 0);
        if (parsed) {
            collectTypeTokens(parsed.type).forEach((token) => referencedTypes.add(token));
        }
    }

    collectTypeTokens(parseReturnType(node.fission.answer[0] ?? 'void')).forEach((token) =>
        referencedTypes.add(token)
    );

    const typeImports = Array.from(referencedTypes).filter((token) => exportedTypeNames.has(token));
    if (typeImports.length === 0) {
        return;
    }

    const moduleSpecifier = resolveTypesModuleSpecifier(projectRoot, sourceFile);
    removeStaleTypeImports(sourceFile, moduleSpecifier, typeImports);
    const existingImport = sourceFile.getImportDeclaration(
        (declaration) => declaration.getModuleSpecifierValue() === moduleSpecifier
    );

    if (!existingImport) {
        sourceFile.addImportDeclaration({
            moduleSpecifier,
            namedImports: typeImports.sort()
        });
        return;
    }

    const existingNames = new Set(existingImport.getNamedImports().map((specifier) => specifier.getName()));
    typeImports
        .sort()
        .filter((name) => !existingNames.has(name))
        .forEach((name) => existingImport.addNamedImport(name));
}

function getExportedTypeNames(project: Project, projectRoot: string) {
    const typesFilePath = path.join(projectRoot, 'src', 'types.ts');
    const sourceFile = project.getSourceFile(typesFilePath);
    const exported = new Set<string>();

    if (!sourceFile) {
        return exported;
    }

    for (const [name] of sourceFile.getExportedDeclarations()) {
        exported.add(name);
    }

    return exported;
}

function loadNodeLocations(projectRoot: string) {
    const candidates = [
        path.join(projectRoot, '.triadmind', 'triad-map.json'),
        path.join(projectRoot, 'triad-map.json')
    ];

    for (const candidate of candidates) {
        if (!fs.existsSync(candidate)) {
            continue;
        }

        try {
            const nodes = JSON.parse(fs.readFileSync(candidate, 'utf-8')) as Array<{
                nodeId?: string;
                sourcePath?: string;
            }>;

            return nodes.reduce<NodeLocationMap>((result, item) => {
                if (item?.nodeId && item?.sourcePath) {
                    result[item.nodeId] = item.sourcePath;
                }
                return result;
            }, {});
        } catch {
            return {};
        }
    }

    return {};
}

function replaceDocs(node: MethodDeclaration | FunctionDeclaration, responsibility: string) {
    node.getJsDocs().forEach((doc) => doc.remove());
    node.addJsDoc({
        description: buildTriadGeneratedDoc(responsibility)
    });
}

function removeStaleTypeImports(sourceFile: SourceFile, moduleSpecifier: string, typeImports: string[]) {
    const targetNames = new Set(typeImports);
    sourceFile
        .getImportDeclarations()
        .filter((declaration) => {
            const value = declaration.getModuleSpecifierValue();
            return value !== moduleSpecifier && value.includes('types');
        })
        .forEach((declaration) => {
            declaration
                .getNamedImports()
                .filter((specifier) => targetNames.has(specifier.getName()))
                .forEach((specifier) => specifier.remove());

            if (
                declaration.getNamedImports().length === 0 &&
                !declaration.getDefaultImport() &&
                !declaration.getNamespaceImport()
            ) {
                declaration.remove();
            }
        });
}

if (require.main === module) {
    applyProtocol(process.argv[2] ?? process.cwd(), process.argv[3]);
}
```

[Skeleton File] adapterRegistry.ts
```ts
/**
 * TriadMind 自动生成骨架
 * 职责：执行 registerAdapter 流程
 */
export function registerAdapter(adapter: LanguageAdapter): void {
    throw new Error("TODO: 实现 AdapterRegistry.registerAdapter，职责：执行 registerAdapter 流程");
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 resolveAdapter 流程
 */
export function resolveAdapter(pathsOrProjectRoot: WorkspacePaths | string): LanguageAdapter {
    throw new Error("TODO: 实现 AdapterRegistry.resolveAdapter，职责：执行 resolveAdapter 流程");
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 getAvailableAdapters 流程
 */
export function getAvailableAdapters(): LanguageAdapter[] {
    throw new Error("TODO: 实现 AdapterRegistry.getAvailableAdapters，职责：执行 getAvailableAdapters 流程");
}
```

[Skeleton File] typescriptAdapter.ts
```ts
/**
 * TriadMind 自动生成骨架
 * 职责：执行 readTopologyIR 流程
 */
export function readTopologyIR(projectRoot: string): TriadTopologyIR {
    throw new Error("TODO: 实现 TypeScriptAdapter.readTopologyIR，职责：执行 readTopologyIR 流程");
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 parseTopology 流程
 */
export function parseTopology(projectRoot: string, outputPath: string | undefined): void {
    throw new Error("TODO: 实现 TypeScriptAdapter.parseTopology，职责：执行 parseTopology 流程");
}

/**
 * TriadMind 自动生成骨架
 * 职责：执行 applyUpgradeProtocol 流程
 */
export function applyUpgradeProtocol(projectRoot: string, protocolPath: string | undefined): { changedFiles: string[] } {
    throw new Error("TODO: 实现 TypeScriptAdapter.applyUpgradeProtocol，职责：执行 applyUpgradeProtocol 流程");
}
```

[Implementation Rules]
1. 不要重新发明拓扑；默认协议与 triad-map 已批准。
2. 只在批准后的节点职责范围内补全实现，不要绕开节点边界随意扩散。
3. 优先完善当前骨架文件，必要时再补其直接依赖。
4. 如果发现实现困难，先检查是否能通过 reuse 已存在能力解决，而不是新增节点。
5. 如果实现确实要求拓扑改变，应停止编码并返回协议阶段。

[Expected Output]
先给出简洁实现计划。
然后基于现有骨架代码完成实现。
完成后总结修改了哪些文件，以及这些修改如何对应已批准协议。