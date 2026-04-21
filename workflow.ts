import * as fs from 'fs';
import * as path from 'path';
import { ensureTriadConfig } from './config';
import { analyzeWorkspaceStage } from './stage';
import { getWorkspacePaths, ImplementationHandoffInput, normalizePath, WorkspacePaths } from './workspace';

export { getWorkspacePaths, type WorkspacePaths, type ImplementationHandoffInput } from './workspace';

export function ensureTriadSpec(paths: WorkspacePaths, force = false) {
    fs.mkdirSync(paths.triadDir, { recursive: true });
    ensureTriadConfig(paths);

    if (force || !fs.existsSync(paths.triadSpecFile)) {
        fs.writeFileSync(paths.triadSpecFile, buildTriadSpec(paths.projectRoot), 'utf-8');
    }
}

export function createDraftTemplate(paths: WorkspacePaths, userDemand = '') {
    fs.mkdirSync(paths.triadDir, { recursive: true });

    if (fs.existsSync(paths.draftFile)) {
        return;
    }

    fs.writeFileSync(
        paths.draftFile,
        JSON.stringify(
            {
                protocolVersion: '1.0',
                project: normalizePath(paths.projectRoot),
                mapSource: normalizePath(paths.mapFile),
                userDemand,
                upgradePolicy: {
                    allowedOps: ['reuse', 'modify', 'create_child'],
                    principle: 'reuse_first_minimal_change'
                },
                macroSplit: {
                    anchorNodeId: '',
                    vertexGoal: '',
                    leftBranch: [],
                    rightBranch: []
                },
                mesoSplit: {
                    classes: [],
                    pipelines: []
                },
                microSplit: {
                    classes: []
                },
                actions: []
            },
            null,
            2
        ),
        'utf-8'
    );
}

export function writePromptPacket(paths: WorkspacePaths, userDemand: string) {
    ensureTriadSpec(paths, true);

    if (!fs.existsSync(paths.mapFile)) {
        throw new Error(`找不到 triad-map.json：${paths.mapFile}`);
    }

    ensureMultiPassTemplates(paths, userDemand);

    const protocolPrompt = buildProtocolPrompt(paths, userDemand);
    const implementationPrompt = buildImplementationPrompt(paths, userDemand);
    const pipelinePrompt = buildPipelinePrompt(paths, userDemand);

    fs.writeFileSync(paths.promptFile, protocolPrompt, 'utf-8');
    fs.writeFileSync(paths.protocolTaskFile, protocolPrompt, 'utf-8');
    fs.writeFileSync(paths.pipelinePromptFile, pipelinePrompt, 'utf-8');
    fs.writeFileSync(paths.implementationPromptFile, implementationPrompt, 'utf-8');
    fs.writeFileSync(paths.demandFile, userDemand.trim(), 'utf-8');

    writeMasterPrompt(paths);
}

export function resetPipelineArtifacts(paths: WorkspacePaths, userDemand: string) {
    fs.writeFileSync(
        paths.macroSplitFile,
        JSON.stringify(
            {
                anchorNodeId: '',
                vertexGoal: userDemand,
                leftBranch: [],
                rightBranch: []
            },
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(
        paths.mesoSplitFile,
        JSON.stringify(
            {
                classes: [],
                pipelines: []
            },
            null,
            2
        ),
        'utf-8'
    );

    fs.writeFileSync(
        paths.microSplitFile,
        JSON.stringify(
            {
                classes: []
            },
            null,
            2
        ),
        'utf-8'
    );
}

export function buildProtocolPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const configJson = safeRead(paths.configFile);
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();
    const macroJson = safeRead(paths.macroSplitFile);
    const mesoJson = safeRead(paths.mesoSplitFile);
    const microJson = safeRead(paths.microSplitFile);

    return [
        '[System]',
        triadSpec,
        '',
        '[Context: Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Context: Triad Map Path]',
        normalizePath(paths.mapFile),
        '',
        '[Context: Triad Config JSON]',
        '```json',
        configJson || '{}',
        '```',
        '',
        '[Context: Triad Map JSON]',
        '```json',
        mapJson,
        '```',
        '',
        '[Context: Macro Split JSON]',
        '```json',
        macroJson || '{}',
        '```',
        '',
        '[Context: Meso Split JSON]',
        '```json',
        mesoJson || '{}',
        '```',
        '',
        '[Context: Micro Split JSON]',
        '```json',
        microJson || '{}',
        '```',
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Output Contract]',
        '只返回严格 JSON；禁止输出 markdown、解释、前后缀说明。',
        '最终 JSON 必须同时包含 `macroSplit`、`mesoSplit`、`microSplit`、`actions`。',
        '`allowedOps` 只能是 `reuse` / `modify` / `create_child`。',
        '`macroSplit` 负责寻找挂载点，并拆出左分支=子功能、右分支=编排 / 配置。',
        '`mesoSplit` 负责把子功能继续拆成类与数据管道。',
        '`microSplit` 负责把类继续拆成属性 / 状态与方法 / 动作，并明确 demand / answer。',
        '`actions` 是最终可 apply 的落地协议；可复用则优先 `reuse`，可局部升级则 `modify`，只有无法稳定挂载时才 `create_child`。',
        '`create_child` 必须提供 `parentNodeId`，并保持符合顶点三元法的最小裂变。'
    ].join('\n');
}

export function buildImplementationPrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const configJson = safeRead(paths.configFile);
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();

    return [
        '[System]',
        '你是一个严格遵守顶点三元法的软件实现助手。',
        '在真正写代码之前，你必须先完成一个内置子任务：生成拓扑升级协议。',
        '协议生成不是独立流程，而是实现流程的第一阶段。',
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Triad Map Path]',
        normalizePath(paths.mapFile),
        '',
        '[Triad Config JSON]',
        '```json',
        configJson || '{}',
        '```',
        '',
        '[Triad Map JSON]',
        '```json',
        mapJson,
        '```',
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Execution Workflow]',
        '1. 先执行 Macro-Split：寻找挂载点，并把功能拆成左分支=子功能、右分支=编排 / 配置。',
        '2. 再执行 Meso-Split：把子功能继续拆成类（Class）、数据管道（Pipeline）与职责边界。',
        '3. 最后执行 Micro-Split：把类拆成属性 / 状态（静态右分支）与方法 / 动作（动态左分支）。',
        '4. 把三轮结果折叠进最终 `draft-protocol.json`，再进入 visualizer 审核。',
        '5. 协议确认之后，才允许继续具体实现。',
        '',
        '[Output Rules]',
        '先给出 Macro / Meso / Micro 三轮拆分结果。',
        '再给出 `draft-protocol.json` 的严格 JSON 内容。',
        '再给出简洁实现计划。',
        '如果当前就在编码环境中工作，应先把协议写入 `.triadmind/draft-protocol.json`。',
        '如果协议尚未确认，就停在协议阶段，不要跳过 visualizer 审核。'
    ].join('\n');
}

export function buildPipelinePrompt(paths: WorkspacePaths, userDemand: string) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const mapJson = fs.readFileSync(paths.mapFile, 'utf-8').trim();

    return [
        '[System]',
        '你是 TriadMind 的多轮推演调度器。',
        '你不能一次性直接想出最终协议；你必须按 Macro-Split、Meso-Split、Micro-Split 三轮顺序推演。',
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Triad Map JSON]',
        '```json',
        mapJson,
        '```',
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Pass 1: Macro-Split]',
        `把需求切成：挂载点、左分支（子功能）、右分支（编排 / 配置）。结果写入 ${normalizePath(paths.macroSplitFile)}。`,
        '',
        '[Pass 2: Meso-Split]',
        `基于 Macro 结果，把子功能切成类与数据管道。结果写入 ${normalizePath(paths.mesoSplitFile)}。`,
        '',
        '[Pass 3: Micro-Split]',
        `基于 Meso 结果，把类切成属性 / 状态和方法 / 动作，并明确 demand / answer。结果写入 ${normalizePath(paths.microSplitFile)}。`,
        '',
        '[Final Protocol]',
        `把三轮结果折叠进 ${normalizePath(paths.draftFile)}，并提供可 apply 的 \`actions\`。`,
        '',
        '[Rules]',
        '每一轮都必须继承上一轮，不能跳步。',
        '如果上层拆分不稳定，就不能进入下层。',
        '最终协议必须包含 `macroSplit`、`mesoSplit`、`microSplit`、`actions`。'
    ].join('\n');
}

export function writeImplementationHandoff(paths: WorkspacePaths, input: ImplementationHandoffInput) {
    const triadSpec = fs.readFileSync(paths.triadSpecFile, 'utf-8').trim();
    const prompt = buildImplementationHandoffPrompt(paths, triadSpec, input);

    fs.writeFileSync(paths.handoffPromptFile, prompt, 'utf-8');
    fs.writeFileSync(
        paths.lastApplyFilesFile,
        JSON.stringify(
            {
                generatedAt: new Date().toISOString(),
                files: input.changedFiles.map((file) => file.path)
            },
            null,
            2
        ),
        'utf-8'
    );

    writeMasterPrompt(paths);
}

export function writeMasterPrompt(paths: WorkspacePaths) {
    ensureTriadSpec(paths, true);
    fs.writeFileSync(paths.masterPromptFile, buildMasterPrompt(paths), 'utf-8');
}

export function buildMasterPrompt(paths: WorkspacePaths) {
    const triadSpec = safeRead(paths.triadSpecFile);
    const triadConfig = safeRead(paths.configFile);
    const triadMap = safeRead(paths.mapFile);
    const latestDemand = safeRead(paths.demandFile);
    const draftProtocol = safeRead(paths.draftFile);
    const macroSplit = safeRead(paths.macroSplitFile);
    const mesoSplit = safeRead(paths.mesoSplitFile);
    const microSplit = safeRead(paths.microSplitFile);
    const pipelinePrompt = safeRead(paths.pipelinePromptFile);
    const approvedProtocol = safeRead(paths.approvedProtocolFile);
    const handoffPrompt = safeRead(paths.handoffPromptFile);
    const applyFilesManifest = safeRead(paths.lastApplyFilesFile);
    const changedFiles = readChangedFiles(paths);
    const stage = analyzeWorkspaceStage({
        latestDemand,
        draftProtocol,
        macroSplit,
        mesoSplit,
        microSplit,
        approvedProtocol
    });

    const changedFilesSection =
        changedFiles.length === 0
            ? '当前没有记录到最近一次 apply 直接涉及的骨架文件。'
            : changedFiles
                  .map((file: string) => {
                      const fullPath = path.join(paths.projectRoot, file);
                      const content = fs.existsSync(fullPath) ? fs.readFileSync(fullPath, 'utf-8').trim() : '';
                      return [`[Changed File] ${normalizePath(file)}`, '```ts', content, '```'].join('\n');
                  })
                  .join('\n\n');

    return [
        '[System]',
        '你是 TriadMind 工作流的统一入口助手。',
        '你必须先判断当前所处阶段，再决定是继续协议规划，还是进入批准后的实现阶段。',
        '协议没有被确认前，不允许直接跳过 visualizer 去写最终实现。',
        '',
        '[Current Stage]',
        stage.currentStage,
        '',
        '[Triad Spec]',
        triadSpec || '未找到 triad.md',
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[Triad Config JSON]',
        '```json',
        triadConfig || '{}',
        '```',
        '',
        '[Latest User Demand]',
        latestDemand ? JSON.stringify(latestDemand.trim()) : '""',
        '',
        '[Triad Map JSON]',
        '```json',
        triadMap || '[]',
        '```',
        '',
        '[Draft Protocol JSON]',
        '```json',
        draftProtocol || '{}',
        '```',
        '',
        '[Macro Split JSON]',
        '```json',
        macroSplit || '{}',
        '```',
        '',
        '[Meso Split JSON]',
        '```json',
        mesoSplit || '{}',
        '```',
        '',
        '[Micro Split JSON]',
        '```json',
        microSplit || '{}',
        '```',
        '',
        '[Approved Protocol JSON]',
        '```json',
        approvedProtocol || '{}',
        '```',
        '',
        '[Last Apply Files]',
        '```json',
        applyFilesManifest || '{"files":[]}',
        '```',
        '',
        '[Changed Skeleton Files]',
        changedFilesSection,
        '',
        '[Stage Router]',
        '1. 只有当 `actions` 非空时，Draft / Approved Protocol 才算完成。',
        '2. 只有当 `macroSplit` 出现 `anchorNodeId`，或 `leftBranch` / `rightBranch` 非空时，才算完成 Macro-Split。',
        '3. 只有当 `mesoSplit` 的 `classes` 或 `pipelines` 非空时，才算完成 Meso-Split。',
        '4. 只有当 `microSplit.classes` 非空，且类中存在属性 / 方法拆分时，才算完成 Micro-Split。',
        '5. Draft / Approved Protocol 是否生效，要以 `userDemand` 是否匹配当前最新需求为准。',
        '6. 若 Approved Protocol 已完成且需求匹配，则进入实现阶段。',
        '7. 若 Draft Protocol 已完成且需求匹配，但尚未批准，则先走 visualizer 审核。',
        '8. 若 Micro 已完成但 Draft 未完成，则汇总最终 `draft-protocol.json`。',
        '9. 若 Meso 已完成但 Micro 未完成，则继续 Micro-Split。',
        '10. 若 Macro 已完成但 Meso 未完成，则继续 Meso-Split。',
        '11. 若以上都未完成，则先做 Macro-Split。',
        '12. 若实现阶段发现协议无法承载需求，应停止编码并返回协议阶段。',
        '',
        '[Protocol Phase Rules]',
        '先做 Macro-Split：挂载点 + 左分支子功能 + 右分支编排 / 配置。',
        '再做 Meso-Split：类与数据管道。',
        '最后做 Micro-Split：属性 / 状态 + 方法 / 动作。',
        '最终输出必须汇总成严格 JSON 的 `draft-protocol.json`。',
        '',
        '[Implementation Phase Rules]',
        '优先依据 Approved Protocol JSON 与 Changed Skeleton Files 完善代码。',
        '严格在已批准节点职责内实现，不要擅自新增拓扑分支。',
        '若存在 `implementation-handoff.md`，优先服从它。',
        '',
        '[Multi-pass Pipeline Prompt]',
        pipelinePrompt || '当前尚未生成 multi-pass-pipeline.md',
        '',
        '[Handoff Prompt]',
        handoffPrompt || '当前尚未生成 implementation-handoff.md',
        '',
        '[Expected Behavior]',
        '先判断阶段，再执行对应子任务。',
        '协议阶段：先给协议，再等待 visualizer / 用户确认。',
        '实现阶段：先给简洁实现计划，再补全代码实现。'
    ].join('\n');
}

export function buildImplementationHandoffPrompt(
    paths: WorkspacePaths,
    triadSpec: string,
    input: ImplementationHandoffInput
) {
    const changedFilesSection =
        input.changedFiles.length === 0
            ? '当前没有检测到本轮 apply 直接涉及的骨架文件，请优先从 `last-approved-protocol.json` 对应的节点文件开始实现。'
            : input.changedFiles
                  .map((file) => [`[Skeleton File] ${file.path}`, '```ts', file.content.trim(), '```'].join('\n'))
                  .join('\n\n');

    return [
        '[System]',
        '你现在处于顶点三元法工作流的第二阶段：协议已通过审核，骨架代码已落地。',
        '你的任务不再是重新设计拓扑，而是在已批准拓扑内，基于骨架代码完成具体实现。',
        '',
        '[Triad Spec]',
        triadSpec,
        '',
        '[Project Root]',
        normalizePath(paths.projectRoot),
        '',
        '[User Demand]',
        JSON.stringify(input.userDemand.trim()),
        '',
        '[Approved Protocol JSON]',
        '```json',
        input.approvedProtocolJson.trim(),
        '```',
        '',
        '[Updated Triad Map JSON]',
        '```json',
        input.triadMapJson.trim(),
        '```',
        '',
        '[Skeleton Files]',
        changedFilesSection,
        '',
        '[Implementation Rules]',
        '1. 不要重新发明拓扑；默认协议与 triad-map 已批准。',
        '2. 只在批准后的节点职责范围内补全实现，不要绕开节点边界随意扩散。',
        '3. 优先完善当前骨架文件，必要时再补其直接依赖。',
        '4. 如果发现实现困难，先检查是否能通过 reuse 已存在能力解决，而不是新增节点。',
        '5. 如果实现确实要求拓扑改变，应停止编码并返回协议阶段。',
        '',
        '[Expected Output]',
        '先给出简洁实现计划。',
        '然后基于现有骨架代码完成实现。',
        '完成后总结修改了哪些文件，以及这些修改如何对应已批准协议。'
    ].join('\n');
}

function buildTriadSpec(projectRoot: string) {
    const projectName = path.basename(projectRoot);

    return `你是一个严谨的软件架构师大脑，负责为项目 ${projectName} 生成“拓扑升级协议”。
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

目标不是直接写实现代码，而是先输出可审阅、可视化、可落骨架的多轮裂变协议。`;
}

export function ensureMultiPassTemplates(paths: WorkspacePaths, userDemand: string) {
    resetPipelineArtifacts(paths, userDemand);
    fs.writeFileSync(paths.macroPromptFile, buildMacroPrompt(paths, userDemand), 'utf-8');
    fs.writeFileSync(paths.mesoPromptFile, buildMesoPrompt(paths, userDemand), 'utf-8');
    fs.writeFileSync(paths.microPromptFile, buildMicroPrompt(paths, userDemand), 'utf-8');
}

export function buildMacroPrompt(paths: WorkspacePaths, userDemand: string) {
    return [
        '[Pass 1: Macro-Split]',
        '任务：寻找挂载点 Anchor，并把需求切成左右分支。',
        '左分支 = 具体要干活的子功能。',
        '右分支 = 编排流程、参数配置、状态约束。',
        `输出文件：${normalizePath(paths.macroSplitFile)}`,
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Output JSON Shape]',
        '{"anchorNodeId":"","vertexGoal":"","leftBranch":[],"rightBranch":[]}'
    ].join('\n');
}

export function buildMesoPrompt(paths: WorkspacePaths, userDemand: string) {
    return [
        '[Pass 2: Meso-Split]',
        '任务：基于 Macro-Split 的子功能，把需求继续拆成类（Class）和数据管道（Pipeline）。',
        `输入文件：${normalizePath(paths.macroSplitFile)}`,
        `输出文件：${normalizePath(paths.mesoSplitFile)}`,
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Output JSON Shape]',
        '{"classes":[{"className":"","category":"","responsibility":"","upstreams":[],"downstreams":[]}],"pipelines":[{"pipelineId":"","purpose":"","steps":[]}]}'
    ].join('\n');
}

export function buildMicroPrompt(paths: WorkspacePaths, userDemand: string) {
    return [
        '[Pass 3: Micro-Split]',
        '任务：基于 Meso-Split 的类，把类拆成属性 / 状态（静态右分支）与方法 / 动作（动态左分支），并明确 demand / answer。',
        `输入文件：${normalizePath(paths.mesoSplitFile)}`,
        `输出文件：${normalizePath(paths.microSplitFile)}`,
        '',
        '[User Demand]',
        JSON.stringify(userDemand.trim()),
        '',
        '[Output JSON Shape]',
        '{"classes":[{"className":"","staticRightBranch":[{"name":"","type":"","role":""}],"dynamicLeftBranch":[{"name":"","demand":[],"answer":[],"responsibility":""}]}]}'
    ].join('\n');
}

function readChangedFiles(paths: WorkspacePaths) {
    if (!fs.existsSync(paths.lastApplyFilesFile)) {
        return [] as string[];
    }

    try {
        const parsed = JSON.parse(fs.readFileSync(paths.lastApplyFilesFile, 'utf-8'));
        return Array.isArray(parsed.files)
            ? parsed.files.filter((item: unknown): item is string => typeof item === 'string')
            : [];
    } catch {
        return [];
    }
}

function safeRead(filePath: string) {
    return fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf-8').trim() : '';
}
