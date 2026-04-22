/**
 * @RightBranch
 */
export function getBootstrapModuleRoles() {
    return {
        Adapter: {
            role: '语言适配器选择层，把协议执行委托给当前项目语言插件。',
            staticRightBranch: ['adapter registry', 'language', 'parserEngine', 'adapterPackage']
        },
        Bootstrap: {
            role: '自举证明层，把 TriadMind 自己描述为顶点三元架构。',
            staticRightBranch: ['self-bootstrap.md', 'self-bootstrap-protocol.json']
        },
        BootstrapRightBranch: {
            role: '自举右分支目录，集中保存模块职责目录、节点复用清单和自举文案模板。',
            staticRightBranch: ['module roles', 'self bootstrap node ids', 'rendering text']
        },
        Config: {
            role: '静态配置层，约束解析器、协议置信度、运行时自愈和目录分类。',
            staticRightBranch: ['TriadConfig', 'DEFAULT_CONFIG', '.triadmind/config.json']
        },
        Generator: {
            role: '骨架落地左分支，把已批准协议委托给当前语言适配器并落地为源码结构。',
            staticRightBranch: ['apply pipeline', 'node upsert execution']
        },
        GeneratorRightBranch: {
            role: '骨架生成右分支目录，集中保存类型白名单、源码路径策略和结构模板。',
            staticRightBranch: ['builtin type names', 'source path strategy', 'method/function templates']
        },
        Healing: {
            role: '运行时自愈左分支，把错误栈映射回拓扑节点并生成修复提示词。',
            staticRightBranch: ['diagnosis pipeline', 'artifact writing']
        },
        HealingRightBranch: {
            role: '运行时自愈右分支目录，集中保存错误分类规则、blast radius 策略和 healing prompt 固定规则。',
            staticRightBranch: ['classification regexes', 'blast radius strategy', 'prompt output rules']
        },
        Ir: {
            role: '跨语言中间表示层，把语言 AST 映射为 Triad-IR。',
            staticRightBranch: ['TriadTopologyIR', 'TriadIRNode', 'TriadIREdge']
        },
        Parser: {
            role: '源码拓扑抽取层，把当前语言源码抽取为 triad-map 叶节点。',
            staticRightBranch: ['language adapter', 'JSDoc tags', 'sourcePath']
        },
        Protocol: {
            role: '协议编译器左分支，用 Schema 与拓扑规则拦截非法演化。',
            staticRightBranch: ['validation pipeline', 'node parsing', 'topology checks']
        },
        ProtocolRightBranch: {
            role: '协议右分支目录，集中保存类型、Schema、操作枚举和类别映射。',
            staticRightBranch: ['Triad types', 'Zod schemas', 'prefix category map']
        },
        Rules: {
            role: 'Always-on 规则层，把顶点三元约束写入 AI 助手默认上下文。',
            staticRightBranch: ['AGENTS.md', '.cursor/rules/triadmind.mdc', 'agent-rules.md']
        },
        Snapshot: {
            role: '安全快照层，为 apply 和自愈循环提供可回滚边界。',
            staticRightBranch: ['snapshot index', 'snapshot files', 'restore manifest']
        },
        Stage: {
            role: '阶段识别层，判断当前处于规划、审核、实现还是修复阶段。',
            staticRightBranch: ['StageAnalysisInput', 'StageAnalysisResult']
        },
        Sync: {
            role: '增量同步层，基于文件哈希保持 triad-map 与源码同步。',
            staticRightBranch: ['sync-manifest.json', 'sha256 file digests']
        },
        TreeSitterParser: {
            role: 'Tree-sitter 解析层，为跨语言泛化提供统一 AST 路径。',
            staticRightBranch: ['tree-sitter grammar', 'query patterns']
        },
        Visualizer: {
            role: '拓扑审核层，把协议和现有地图渲染为知识图谱。',
            staticRightBranch: ['visualizer.html', 'node status', 'edge status']
        },
        Workflow: {
            role: '多轮推演编排左分支，生成 Macro/Meso/Micro/Protocol/Handoff 提示词。',
            staticRightBranch: ['workflow execution pipeline']
        },
        WorkflowRightBranch: {
            role: '工作流右分支目录，集中保存协议模板、阶段规则和提示词固定结构。',
            staticRightBranch: ['draft templates', 'stage router rules', 'prompt shapes']
        },
        Workspace: {
            role: '工作区路径层，统一描述 .triadmind 文件系统边界。',
            staticRightBranch: ['WorkspacePaths', 'projectRoot', '.triadmind paths']
        }
    } as const;
}

/**
 * @RightBranch
 */
export function getSelfBootstrapNodeIds() {
    return [
        'Workflow.buildMasterPrompt',
        'Workflow.buildProtocolPrompt',
        'Workflow.writePromptPacket',
        'WorkflowRightBranch.createDraftProtocolTemplate',
        'WorkflowRightBranch.getMasterPromptStageRouterLines',
        'Protocol.assertProtocolShape',
        'Protocol.parseNodeRef',
        'Protocol.readTriadMap',
        'ProtocolRightBranch.getUpgradeProtocolSchema',
        'ProtocolRightBranch.getTriadNodeDefinitionSchema',
        'Parser.runParser',
        'Generator.applyProtocol',
        'GeneratorRightBranch.resolveSourceFilePath',
        'GeneratorRightBranch.buildMethodStructure',
        'Visualizer.generateDashboard',
        'Sync.syncTriadMap',
        'Rules.installAlwaysOnRules',
        'Healing.prepareHealingArtifacts',
        'Healing.diagnoseRuntimeFailure',
        'HealingRightBranch.classifyDiagnosis',
        'HealingRightBranch.estimateBlastRadius',
        'Snapshot.createSnapshot',
        'Adapter.resolveAdapter',
        'TreeSitterParser.runTreeSitterTypeScriptParser',
        'Workspace.getWorkspacePaths',
        'Config.loadTriadConfig',
        'Stage.analyzeWorkspaceStage',
        'Ir.buildTopologyIR'
    ];
}

/**
 * @RightBranch
 */
export function getSelfBootstrapLoopLines() {
    return [
        'triadmind-core 源码',
        '-> Parser / TreeSitterParser',
        '-> triad-map.json',
        '-> self-bootstrap-protocol.json',
        '-> visualizer.html',
        '-> AGENTS.md / Cursor rules',
        '-> 后续所有 TriadMind 改动继续先走协议'
    ];
}

/**
 * @RightBranch
 */
export function getSelfBootstrapMicroRules() {
    return [
        '类型、接口、配置、路径、Schema、缓存、快照属于静态右分支。',
        '导出的函数、命令处理、协议执行、解析、生成、诊断属于动态左分支。',
        '模块本身是顶点，负责把右分支约束包装成可执行的左分支能力。'
    ];
}

/**
 * @RightBranch
 */
export function getSelfBootstrapPreamble() {
    return '这份文件是 TriadMind 对自己的顶点三元架构声明。它证明 TriadMind 不是只给别的项目立规矩，而是先用同一套规则描述自身。';
}
