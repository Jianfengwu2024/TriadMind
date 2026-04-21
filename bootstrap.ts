import * as fs from 'fs';
import * as path from 'path';
import { readTriadMap, TriadNodeDefinition, UpgradeProtocol } from './protocol';
import { normalizePath, WorkspacePaths } from './workspace';

interface BootstrapModule {
    moduleName: string;
    sourcePath: string;
    role: string;
    staticRightBranch: string[];
    dynamicLeftBranch: string[];
}

interface SelfBootstrapArchitecture {
    vertex: {
        name: string;
        responsibility: string;
        invariant: string;
    };
    macroSplit: {
        anchorNodeId: string;
        leftBranch: string[];
        rightBranch: string[];
    };
    mesoSplit: BootstrapModule[];
    microSplit: BootstrapModule[];
}

const MODULE_ROLES: Record<string, { role: string; staticRightBranch: string[] }> = {
    Adapter: {
        role: '语言适配器选择层，把协议执行委托给当前项目语言插件。',
        staticRightBranch: ['adapter registry', 'language', 'parserEngine', 'adapterPackage']
    },
    Config: {
        role: '静态配置层，约束解析器、协议置信度、运行时自愈和目录分类。',
        staticRightBranch: ['TriadConfig', 'DEFAULT_CONFIG', '.triadmind/config.json']
    },
    Generator: {
        role: '骨架落地层，把已批准协议转译为 TypeScript 源码结构。',
        staticRightBranch: ['nodeLocations', 'exportedTypeNames', 'sourcePath']
    },
    Healing: {
        role: '运行时自愈层，把错误栈映射回拓扑节点并生成修复提示词。',
        staticRightBranch: ['runtime-error.log', 'healing-report.json', 'healing-prompt.md']
    },
    Ir: {
        role: '跨语言中间表示层，把语言 AST 映射为 Triad-IR。',
        staticRightBranch: ['TriadTopologyIR', 'TriadIRNode', 'TriadIREdge']
    },
    Parser: {
        role: '源码拓扑抽取层，把 TypeScript 源码抽取为 triad-map 叶节点。',
        staticRightBranch: ['tsconfig.json', 'JSDoc tags', 'sourcePath']
    },
    Protocol: {
        role: '协议编译器层，用 Schema 和拓扑规则拦截非法演化。',
        staticRightBranch: ['Zod schemas', 'allowedOps', 'confidence thresholds']
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
        role: '多轮推演编排层，生成 Macro/Meso/Micro/Protocol/Handoff 提示词。',
        staticRightBranch: ['triad.md', 'master-prompt.md', 'latest-demand.txt']
    },
    Workspace: {
        role: '工作区路径层，统一描述 .triadmind 文件系统边界。',
        staticRightBranch: ['WorkspacePaths', 'projectRoot', '.triadmind paths']
    },
    Bootstrap: {
        role: '自举证明层，把 TriadMind 自己描述为顶点三元架构。',
        staticRightBranch: ['self-bootstrap.md', 'self-bootstrap-protocol.json']
    }
};

const SELF_BOOTSTRAP_NODE_IDS = [
    'Workflow.buildMasterPrompt',
    'Parser.runParser',
    'Protocol.assertProtocolShape',
    'Generator.applyProtocol',
    'Visualizer.generateDashboard',
    'Sync.syncTriadMap',
    'Rules.installAlwaysOnRules',
    'Healing.prepareHealingArtifacts',
    'Snapshot.createSnapshot',
    'Adapter.resolveAdapter',
    'TreeSitterParser.runTreeSitterTypeScriptParser',
    'Workspace.getWorkspacePaths',
    'Config.loadTriadConfig',
    'Stage.analyzeWorkspaceStage',
    'Ir.buildTopologyIR'
];

export function buildSelfBootstrapArchitecture(paths: WorkspacePaths): SelfBootstrapArchitecture {
    const triadMap = readTriadMap(paths.mapFile);
    const modules = buildBootstrapModules(triadMap);

    return {
        vertex: {
            name: 'TriadMind.SelfBootstrap',
            responsibility: 'TriadMind 先用顶点三元法描述、约束和审核自己，再作为工具约束其他项目。',
            invariant: '任何新增能力都必须先复用现有拓扑；不能复用时只修改契约；职责不匹配时才 create_child。'
        },
        macroSplit: {
            anchorNodeId: 'Workflow.buildMasterPrompt',
            leftBranch: [
                'Parser / TreeSitterParser 抽取源码拓扑',
                'Workflow 组织 Macro/Meso/Micro 多轮推演',
                'Protocol 校验升级协议',
                'Generator 将协议落地为骨架',
                'Visualizer 渲染知识图谱审核',
                'Sync / Rules / Healing 提供持续同步、默认规则与自愈闭环'
            ],
            rightBranch: [
                'WorkspacePaths 定义 .triadmind 静态边界',
                'TriadConfig 定义语言、解析器、协议和自愈策略',
                'Triad-IR 定义跨语言中间表示',
                'Zod Schema 定义协议物理约束',
                'Snapshots 定义安全回滚边界'
            ]
        },
        mesoSplit: modules,
        microSplit: modules
    };
}

export function writeSelfBootstrapReport(paths: WorkspacePaths) {
    fs.mkdirSync(paths.triadDir, { recursive: true });
    const architecture = buildSelfBootstrapArchitecture(paths);
    fs.writeFileSync(paths.selfBootstrapFile, renderSelfBootstrapMarkdown(architecture), 'utf-8');
    return paths.selfBootstrapFile;
}

export function buildSelfBootstrapProtocol(paths: WorkspacePaths): UpgradeProtocol {
    const existingNodes = new Set(readTriadMap(paths.mapFile).map((node) => node.nodeId));
    const reusableNodes = SELF_BOOTSTRAP_NODE_IDS.filter((nodeId) => existingNodes.has(nodeId));

    return {
        protocolVersion: '1.0',
        project: normalizePath(paths.projectRoot),
        mapSource: normalizePath(paths.mapFile),
        userDemand: '完成 TriadMind 自举：用 TriadMind 自身的拓扑图证明其核心模块已经遵从顶点三元法。',
        upgradePolicy: {
            allowedOps: ['reuse', 'modify', 'create_child'],
            principle: 'reuse_first_minimal_change'
        },
        macroSplit: {
            anchorNodeId: 'Workflow.buildMasterPrompt',
            vertexGoal: 'TriadMind 作为架构演进顶点，连接动态执行链路与静态约束链路。',
            leftBranch: [
                'Parser.runParser',
                'Protocol.assertProtocolShape',
                'Generator.applyProtocol',
                'Visualizer.generateDashboard',
                'Healing.prepareHealingArtifacts'
            ],
            rightBranch: [
                'Workspace.getWorkspacePaths',
                'Config.loadTriadConfig',
                'Ir.buildTopologyIR',
                'Snapshot.createSnapshot',
                'Rules.installAlwaysOnRules'
            ]
        },
        mesoSplit: {
            classes: [
                {
                    className: 'Workflow',
                    category: 'core',
                    responsibility: '编排多轮推演、协议生成和实现交接。',
                    upstreams: ['triad.md', 'triad-map.json', 'latest-demand.txt'],
                    downstreams: ['master-prompt.md', 'draft-protocol.json', 'implementation-handoff.md']
                },
                {
                    className: 'Protocol',
                    category: 'core',
                    responsibility: '用 Schema 与拓扑规则把提示词输出转为硬约束协议。',
                    upstreams: ['draft-protocol.json', 'triad-map.json', 'config.json'],
                    downstreams: ['validated UpgradeProtocol']
                },
                {
                    className: 'Generator',
                    category: 'core',
                    responsibility: '把已批准协议转译为源码骨架。',
                    upstreams: ['validated UpgradeProtocol', 'triad-map.json'],
                    downstreams: ['changed source files']
                },
                {
                    className: 'Healing',
                    category: 'core',
                    responsibility: '把运行时错误回溯到拓扑节点并生成修复协议提示词。',
                    upstreams: ['runtime-error.log', 'triad-map.json'],
                    downstreams: ['healing-report.json', 'healing-prompt.md']
                }
            ],
            pipelines: [
                {
                    pipelineId: 'SelfBootstrap.PlanningPipeline',
                    purpose: 'TriadMind 用自己的 Workflow/Protocol 约束自己的演化。',
                    steps: ['Sync.syncTriadMap', 'Workflow.buildMasterPrompt', 'Protocol.assertProtocolShape']
                },
                {
                    pipelineId: 'SelfBootstrap.ExecutionPipeline',
                    purpose: 'TriadMind 用自己的 Generator/Visualizer/Snapshot 审核并落地自己的变化。',
                    steps: ['Visualizer.generateDashboard', 'Snapshot.createSnapshot', 'Generator.applyProtocol']
                }
            ]
        },
        microSplit: {
            classes: [
                {
                    className: 'Protocol',
                    staticRightBranch: [
                        { name: 'upgradeProtocolSchema', type: 'ZodSchema', role: '静态协议约束' },
                        { name: 'TriadConfig.protocol', type: 'Config', role: '置信度阈值' }
                    ],
                    dynamicLeftBranch: [
                        {
                            name: 'assertProtocolShape',
                            demand: ['UpgradeProtocol', 'ProtocolValidationContext'],
                            answer: ['UpgradeProtocol'],
                            responsibility: '拒绝非法操作、非法拓扑和低置信度动作。'
                        }
                    ]
                },
                {
                    className: 'Workflow',
                    staticRightBranch: [
                        { name: 'triad.md', type: 'Markdown', role: '方法论约束' },
                        { name: 'master-prompt.md', type: 'Markdown', role: '统一上下文' }
                    ],
                    dynamicLeftBranch: [
                        {
                            name: 'buildMasterPrompt',
                            demand: ['WorkspacePaths'],
                            answer: ['string'],
                            responsibility: '组装自举和项目演化使用的总提示词。'
                        }
                    ]
                }
            ]
        },
        actions: reusableNodes.map((nodeId) => ({
            op: 'reuse' as const,
            nodeId,
            reason: '自举协议复用该节点作为 TriadMind 自身架构的既有顶点。',
            confidence: 0.95
        }))
    };
}

export function writeSelfBootstrapProtocol(paths: WorkspacePaths) {
    fs.mkdirSync(paths.triadDir, { recursive: true });
    const protocol = buildSelfBootstrapProtocol(paths);
    const payload = JSON.stringify(protocol, null, 2);
    fs.writeFileSync(paths.selfBootstrapProtocolFile, payload, 'utf-8');
    fs.writeFileSync(paths.draftFile, payload, 'utf-8');
    return protocol;
}

function buildBootstrapModules(triadMap: TriadNodeDefinition[]) {
    const grouped = new Map<string, TriadNodeDefinition[]>();
    triadMap.forEach((node) => {
        const moduleName = node.nodeId.split('.')[0] || 'Unknown';
        grouped.set(moduleName, [...(grouped.get(moduleName) ?? []), node]);
    });

    return Array.from(grouped.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map<BootstrapModule>(([moduleName, nodes]) => {
            const role = MODULE_ROLES[moduleName] ?? {
                role: 'TriadMind 核心模块。',
                staticRightBranch: ['module exports', 'type signatures']
            };

            return {
                moduleName,
                sourcePath: nodes[0]?.sourcePath ?? '',
                role: role.role,
                staticRightBranch: role.staticRightBranch,
                dynamicLeftBranch: nodes.map((node) => node.nodeId).sort()
            };
        });
}

function renderSelfBootstrapMarkdown(architecture: SelfBootstrapArchitecture) {
    return [
        '# TriadMind Self-Bootstrap Architecture',
        '',
        '这份文件是 TriadMind 对自己的顶点三元架构声明。它证明 TriadMind 不是只给别的项目立规矩，而是先用同一套规则描述自身。',
        '',
        '## 1. 顶点',
        '',
        `- 名称：\`${architecture.vertex.name}\``,
        `- 职责：${architecture.vertex.responsibility}`,
        `- 不变量：${architecture.vertex.invariant}`,
        '',
        '## 2. Macro-Split',
        '',
        `- 挂载锚点：\`${architecture.macroSplit.anchorNodeId}\``,
        '- 左分支（动态演化）：',
        ...architecture.macroSplit.leftBranch.map((item) => `  - ${item}`),
        '- 右分支（静态稳定）：',
        ...architecture.macroSplit.rightBranch.map((item) => `  - ${item}`),
        '',
        '## 3. Meso-Split',
        '',
        ...architecture.mesoSplit.flatMap((module) => [
            `### ${module.moduleName}`,
            '',
            `- 源文件：\`${module.sourcePath}\``,
            `- 职责：${module.role}`,
            `- 静态右分支：${module.staticRightBranch.join(' / ')}`,
            `- 动态左分支：${module.dynamicLeftBranch.map((nodeId) => `\`${nodeId}\``).join(', ')}`,
            ''
        ]),
        '## 4. Micro-Split 判定',
        '',
        '每个模块内部继续按同一规则分形：',
        '',
        '- 类型、接口、配置、路径、Schema、缓存、快照属于静态右分支。',
        '- 导出的函数、命令处理、协议执行、解析、生成、诊断属于动态左分支。',
        '- 模块本身是顶点，负责把右分支约束包装成可执行的左分支能力。',
        '',
        '## 5. 自举闭环',
        '',
        '```text',
        'triadmind-core 源码',
        '-> Parser / TreeSitterParser',
        '-> triad-map.json',
        '-> self-bootstrap-protocol.json',
        '-> visualizer.html',
        '-> AGENTS.md / Cursor rules',
        '-> 后续所有 TriadMind 改动继续先走协议',
        '```',
        ''
    ].join('\n');
}
