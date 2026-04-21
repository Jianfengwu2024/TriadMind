[Pass 1: Macro-Split]
任务：寻找挂载点 Anchor，并把需求切成左右分支。
左分支 = 具体要干活的子功能。
右分支 = 编排流程、参数配置、状态约束。
输出文件：D:/TraidMind/triadmind-core/.triadmind/macro-split.json

[User Demand]
"将 triadmind-core 重构为遵从顶点三元法的自举系统：让 parser 能抽取模块级顶点，generator 能基于 sourcePath 修改模块函数，workflow 拆分为 workspace 与 stage 右分支，形成可自举的协议-实现闭环"

[Output JSON Shape]
{"anchorNodeId":"","vertexGoal":"","leftBranch":[],"rightBranch":[]}