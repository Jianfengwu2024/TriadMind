# Recursive Renormalization TODO

Status: reserved capability only. This workflow is not implemented yet.

## Why this file exists

TriadMind currently supports cycle-based renormalization, but it does not yet support iterative branch repartition for single nodes with high downstream fanout.

## Reserved trigger

- `@triadmind renormalize --deep`
- `@triadmind converge`

## Intended future behavior

- Detect nodes whose downstream fanout is greater than or equal to 3
- Renormalize from outermost layer to innermost layer
- Recompute `blast radius / cycles / drift` after every round
- Stop only when topology stabilizes into explicit left/right branch structure

## Current workspace snapshot

- Project root: D:/TraidMind/triadmind-core
- Triad map: D:/TraidMind/triadmind-core/.triadmind/triad-map.json
- Threshold: 3 downstream nodes

## Current high-fanout candidates

1. Analyzer.generateFeatureHash -> 55 downstream(s)
   - Analyzer.calculateBlastRadius
   - Config.resolveCategoryFromConfig
   - Config.shouldExcludeSourcePath
   - Generator.applyProtocol
   - GeneratorRightBranch.buildFunctionStructure
   - GeneratorRightBranch.buildMethodStructure
   - GeneratorRightBranch.buildTodoStatement
   - GeneratorRightBranch.buildTriadGeneratedDoc
   - GeneratorRightBranch.collectTypeTokens
   - GeneratorRightBranch.normalizeToken
   - GeneratorRightBranch.resolveSourceFilePath
   - GeneratorRightBranch.resolveTypesModuleSpecifier
   - GeneratorRightBranch.shouldUseTopLevelFunction
   - Healing.buildHealingPrompt
   - Healing.diagnoseRuntimeFailure
   - Healing.prepareHealingArtifacts
   - HealingRightBranch.buildEvidence
   - HealingRightBranch.classifyDiagnosis
   - HealingRightBranch.parseTraceLine
   - Parser.runParser
   - Protocol.normalizeCategory
   - Protocol.parseDemandEntry
   - Protocol.parseNodeRef
   - Protocol.parseReturnType
   - Protocol.readJsonFile
   - Protocol.readTriadMap
   - Snapshot.createSnapshot
   - Snapshot.restoreSnapshot
   - TreeSitterParser.runTreeSitterParser
   - TreeSitterParser.runTreeSitterTypeScriptParser
   - TypescriptAdapter.applyUpgradeProtocol
   - TypescriptAdapter.parseTopology
   - TypescriptAdapter.readTopologyIR
   - TypescriptGenerator.applyTypeScriptProtocol
   - TypescriptParser.runTypeScriptParser
   - Visualizer.generateDashboard
   - Workflow.buildImplementationHandoffPrompt
   - Workflow.buildImplementationPrompt
   - Workflow.buildMacroPrompt
   - Workflow.buildMesoPrompt
   - Workflow.buildMicroPrompt
   - Workflow.buildPipelinePrompt
   - Workflow.buildProtocolPrompt
   - Workflow.ensureMultiPassTemplates
   - Workflow.ensurePipelineArtifactSeeds
   - Workflow.resetPipelineArtifacts
   - Workflow.writePromptPacket
   - WorkflowRightBranch.buildMacroPromptShape
   - WorkflowRightBranch.buildMesoPromptShape
   - WorkflowRightBranch.buildMicroPromptShape
   - WorkflowRightBranch.buildTriadSpecDocument
   - WorkflowRightBranch.createDraftProtocolTemplate
   - WorkflowRightBranch.createMacroSplitSeed
   - Workspace.getWorkspacePaths
   - Workspace.normalizePath
2. Analyzer.generateMayaFeatureHash -> 55 downstream(s)
   - Analyzer.calculateBlastRadius
   - Config.resolveCategoryFromConfig
   - Config.shouldExcludeSourcePath
   - Generator.applyProtocol
   - GeneratorRightBranch.buildFunctionStructure
   - GeneratorRightBranch.buildMethodStructure
   - GeneratorRightBranch.buildTodoStatement
   - GeneratorRightBranch.buildTriadGeneratedDoc
   - GeneratorRightBranch.collectTypeTokens
   - GeneratorRightBranch.normalizeToken
   - GeneratorRightBranch.resolveSourceFilePath
   - GeneratorRightBranch.resolveTypesModuleSpecifier
   - GeneratorRightBranch.shouldUseTopLevelFunction
   - Healing.buildHealingPrompt
   - Healing.diagnoseRuntimeFailure
   - Healing.prepareHealingArtifacts
   - HealingRightBranch.buildEvidence
   - HealingRightBranch.classifyDiagnosis
   - HealingRightBranch.parseTraceLine
   - Parser.runParser
   - Protocol.normalizeCategory
   - Protocol.parseDemandEntry
   - Protocol.parseNodeRef
   - Protocol.parseReturnType
   - Protocol.readJsonFile
   - Protocol.readTriadMap
   - Snapshot.createSnapshot
   - Snapshot.restoreSnapshot
   - TreeSitterParser.runTreeSitterParser
   - TreeSitterParser.runTreeSitterTypeScriptParser
   - TypescriptAdapter.applyUpgradeProtocol
   - TypescriptAdapter.parseTopology
   - TypescriptAdapter.readTopologyIR
   - TypescriptGenerator.applyTypeScriptProtocol
   - TypescriptParser.runTypeScriptParser
   - Visualizer.generateDashboard
   - Workflow.buildImplementationHandoffPrompt
   - Workflow.buildImplementationPrompt
   - Workflow.buildMacroPrompt
   - Workflow.buildMesoPrompt
   - Workflow.buildMicroPrompt
   - Workflow.buildPipelinePrompt
   - Workflow.buildProtocolPrompt
   - Workflow.ensureMultiPassTemplates
   - Workflow.ensurePipelineArtifactSeeds
   - Workflow.resetPipelineArtifacts
   - Workflow.writePromptPacket
   - WorkflowRightBranch.buildMacroPromptShape
   - WorkflowRightBranch.buildMesoPromptShape
   - WorkflowRightBranch.buildMicroPromptShape
   - WorkflowRightBranch.buildTriadSpecDocument
   - WorkflowRightBranch.createDraftProtocolTemplate
   - WorkflowRightBranch.createMacroSplitSeed
   - Workspace.getWorkspacePaths
   - Workspace.normalizePath
3. Workspace.getWorkspacePaths -> 35 downstream(s)
   - Bootstrap.buildSelfBootstrapArchitecture
   - Bootstrap.buildSelfBootstrapProtocol
   - Bootstrap.writeSelfBootstrapProtocol
   - Bootstrap.writeSelfBootstrapReport
   - Config.ensureTriadConfig
   - Config.loadTriadConfig
   - Healing.buildHealingPrompt
   - Healing.diagnoseRuntimeFailure
   - Healing.prepareHealingArtifacts
   - Rules.installAlwaysOnRules
   - Snapshot.collectProtocolSnapshotFiles
   - Snapshot.createSnapshot
   - Snapshot.listSnapshots
   - Snapshot.restoreSnapshot
   - Sync.syncTriadMap
   - Sync.watchTriadMap
   - Workflow.buildImplementationHandoffPrompt
   - Workflow.buildImplementationPrompt
   - Workflow.buildMacroPrompt
   - Workflow.buildMasterPrompt
   - Workflow.buildMesoPrompt
   - Workflow.buildMicroPrompt
   - Workflow.buildPipelinePrompt
   - Workflow.buildProtocolPrompt
   - Workflow.createDraftTemplate
   - Workflow.ensureMultiPassTemplates
   - Workflow.ensurePipelineArtifactSeeds
   - Workflow.ensureTriadSpec
   - Workflow.resetPipelineArtifacts
   - Workflow.writeImplementationHandoff
   - Workflow.writeMasterPrompt
   - Workflow.writePromptPacket
   - WorkflowRightBranch.buildMacroPromptShape
   - WorkflowRightBranch.buildMesoPromptShape
   - WorkflowRightBranch.buildMicroPromptShape
4. Analyzer.normalizeSubgraph -> 6 downstream(s)
   - Analyzer.calculateBlastRadius
   - Analyzer.detectCycles
   - Analyzer.detectTopologicalDrift
   - Analyzer.generateMayanMatrix
   - Analyzer.generateRenormalizeProtocol
   - Analyzer.mapTopologyToYoungPartition
5. Bootstrap.buildSelfBootstrapProtocol -> 4 downstream(s)
   - Protocol.assertProtocolShape
   - Snapshot.collectProtocolSnapshotFiles
   - TypescriptGenerator.applyTypeScriptProtocol
   - Visualizer.generateDashboard
6. Config.loadTriadConfig -> 4 downstream(s)
   - Config.resolveCategoryFromConfig
   - Config.shouldExcludeSourcePath
   - TreeSitterParser.runTreeSitterParser
   - TreeSitterParser.runTreeSitterTypeScriptParser
7. Protocol.parseNodeRef -> 4 downstream(s)
   - GeneratorRightBranch.buildFunctionStructure
   - GeneratorRightBranch.buildMethodStructure
   - GeneratorRightBranch.resolveSourceFilePath
   - GeneratorRightBranch.shouldUseTopLevelFunction
8. HealingRightBranch.classifyDiagnosis -> 3 downstream(s)
   - HealingRightBranch.buildEvidence
   - HealingRightBranch.buildSummary
   - HealingRightBranch.chooseSuggestedAction

## Suggested governance loop

1. Select only the current outermost overloaded nodes
2. Emit branch repartition protocol for that layer
3. Refresh triad-map after the patch
4. Recalculate drift and blast radius
5. Repeat until no overloaded layer remains