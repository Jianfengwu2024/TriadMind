[Pass 3: Micro-Split]
任务：基于 Meso-Split 的类，把类拆成属性 / 状态（静态右分支）与方法 / 动作（动态左分支），并明确 demand / answer。
输入文件：D:/TraidMind/triadmind-core/.triadmind/meso-split.json
输出文件：D:/TraidMind/triadmind-core/.triadmind/micro-split.json

[User Demand]
"将 triadmind-core 重构为遵从顶点三元法的自举系统：让 parser 能抽取模块级顶点，generator 能基于 sourcePath 修改模块函数，workflow 拆分为 workspace 与 stage 右分支，形成可自举的协议-实现闭环"

[Output JSON Shape]
{"classes":[{"className":"","staticRightBranch":[{"name":"","type":"","role":""}],"dynamicLeftBranch":[{"name":"","demand":[],"answer":[],"responsibility":""}]}]}