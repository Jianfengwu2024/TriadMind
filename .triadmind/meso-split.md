[Pass 2: Meso-Split]
任务：基于 Macro-Split 的子功能，把需求继续拆成类（Class）和数据管道（Pipeline）。
输入文件：D:/TraidMind/triadmind-core/.triadmind/macro-split.json
输出文件：D:/TraidMind/triadmind-core/.triadmind/meso-split.json

[User Demand]
"角色与背景：你现在是底层架构师。我们要重构 cli.ts 的 triadmind plan 和 apply 流程，支持基于 Tree-sitter 的多语言生成分发。任务 1 (构建 Adapter 调度器)：在 cli.ts 中实现一个语言嗅探与调度逻辑：检查当前目标项目目录，若存在 tsconfig.json 则判定为 TypeScript；若存在 requirements.txt / pyproject.toml 则判定为 Python；若存在 go.mod 则判定为 Go。声明一个接口 interface ILanguageAdapter { applyProtocol(protocol: any, projectRoot: string): void }。任务 2 (组装拦截生命周期)：在 Init/Apply 之后：调用我们写好的 detectTopologicalDrift。若 isDegraded === true，拦截报错，拒绝执行。在 Plan 接收到 LLM 草案后：调用 calculateBlastRadius。若波及过多节点，发出警告。在最终 Apply 执行时：不再直接调用写死的 generator.ts，而是根据嗅探到的语言，将协议 JSON 传递给对应的 ILanguageAdapter 实例去执行代码生成。要求：请写出这个具有 Adapter 模式与多生命周期拦截机制的 cli.ts 核心控制流代码。"

[Output JSON Shape]
{"classes":[{"className":"","category":"","responsibility":"","upstreams":[],"downstreams":[]}],"pipelines":[{"pipelineId":"","purpose":"","steps":[]}]}