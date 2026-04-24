# TriadMind 升级改造任务单（RHEOS 实测版）

> 版本：v1.0  
> 日期：2026-04-24  
> 适用对象：`triadmind-core` 开发者 / AI 助手 / 架构评审人  
> 目标：提升 TriadMind 对大规模项目的“防架构腐烂”和“防上下文幻觉”能力

---

## 1. 基线现状（2026-04-24 实测）

当前关键指标（来自本地复测）：

- `triad_nodes = 225`
- `leaf_nodes = 638`
- `runtime_nodes = 291`
- `runtime_edges = 198`
- `triad_execute_like = 44`（约 `19.6%`）
- `triad_ghost_nodes = 224`（约 `99.6%`）
- `runtime_diagnostics_total = 30`
- `runtime_diagnostics_no_code = 29`

关键问题：

1. 语义降噪不充分：`execute` 类能力节点占比偏高。  
2. `Ghost:Read` 几乎“全图污染”，主拓扑信号被稀释。  
3. 运行时诊断结构不规范（大量无 `code`），难以做稳定治理。  
4. frontend API 匹配告警多，影响 runtime 图可信度。  
5. 页面渲染与数据边数可能不一致（edge cap 场景）。

---

## 2. 升级目标（必须量化）

### 2.1 质量目标（4 周）

- `diagnostics_no_code == 0`
- `triad_execute_like_ratio < 10%`
- `triad_ghost_ratio < 40%`
- `rendered_runtime_edges == runtime_map_edges`（默认配置）
- `frontend_api_unmatched_warnings` 较基线下降 `>= 70%`

### 2.2 业务目标

- 输出拓扑可用于评审真实架构，不再被低语义节点主导。  
- AI 辅助开发时，上下文引用更稳定，幻觉概率下降。  
- 形成可持续的 CI 门禁，防止质量回退。

---

## 3. 工作分解（Epic 级）

## Epic A：Runtime 可靠性修复（P0）

### A1. 移除默认边截断（Edge Cap）

**目标**：默认渲染边数与 `runtime-map.json` 一致。  
**任务**：

- [ ] 增加 `runtime --max-render-edges <n>` 参数（可选）
- [ ] 默认值改为“无限制/等于 map 边数”
- [ ] 仅在显式开启截断时打印 cap 日志
- [ ] 更新 `runtime --help` 文档

**验收标准**：

- 默认命令下无 `edge cap active` 日志
- 页面边数与 `runtime-map.json` 完全一致

---

### A2. Diagnostics 协议强制化

**目标**：所有 runtime 诊断必须结构化。  
**任务**：

- [ ] 统一 `RuntimeDiagnostic` 结构：`level/code/extractor/message/sourcePath?`
- [ ] 为 `FrontendApiCallExtractor` 所有 warning 赋 `code`
- [ ] 为 `ConfigInfraExtractor` 所有 info/warning 赋 `code`
- [ ] 对写入前做校验：缺失 `code` 则降级为 `RUNTIME_UNKNOWN_DIAGNOSTIC`

**建议 code 规范**：

- `RUNTIME_FRONTEND_API_ROUTE_UNMATCHED`
- `RUNTIME_INFRA_SERVICE_SKIPPED_UNKNOWN_CATEGORY`
- `RUNTIME_EXCLUDED_PATHS_SUMMARY`
- `RUNTIME_FILE_TOO_LARGE`
- `RUNTIME_UNKNOWN_DIAGNOSTIC`

**验收标准**：

- `runtime-diagnostics.json` 中 `no_code=0`

---

### A3. Frontend API 路由匹配增强

**目标**：显著减少“Could not match frontend API call …”。  
**任务**：

- [ ] 归一化 URL：去 `baseUrl`、去重复斜杠、统一前缀
- [ ] 归一化 query：匹配主 path（`?` 后默认忽略）
- [ ] 动态段统一：`${id}`、`{id}`、`[id]` -> `:param`
- [ ] 支持模板字符串片段匹配与 fallback 匹配
- [ ] 输出更可读 evidence（原始路径 + 归一路径）

**验收标准**：

- `RUNTIME_FRONTEND_API_ROUTE_UNMATCHED` 数量较基线下降 `>=70%`

---

## Epic B：能力节点语义治理（P1）

### B1. 能力晋升打分模型重构

**目标**：减少低语义 `execute` 节点占比。  
**任务**：

- [ ] 降低“方法名前缀”单因子权重（execute/run）
- [ ] 提升“外部契约 + runtime 证据 + 业务名词”权重
- [ ] 引入容器/基类抑制规则（Base/Abstract）
- [ ] 输出晋升原因（可审计）

**验收标准**：

- `triad_execute_like_ratio < 10%`

---

### B2. Ghost 信号分层（主图降噪）

**目标**：避免 `Ghost:Read` 污染主契约。  
**任务**：

- [ ] `fission.demand` 仅保留 Top-K 高价值依赖（例如 5 条）
- [ ] 其余 Ghost 迁移到 `fission.evidence.ghostReads[]`
- [ ] Visualizer 默认不把 Ghost 全量画边
- [ ] Leaf drill-down 可查看全量 Ghost

**验收标准**：

- `triad_ghost_ratio < 40%`
- 架构图可读性明显提升

---

### B3. 视图同源化（Domain/Module/Capability/Leaf）

**目标**：减少视图割裂，保持拓扑语义一致。  
**任务**：

- [ ] 建立同源 IR（不同 view 基于同一中间模型投影）
- [ ] 节点 ID 映射可双向跳转（runtime↔capability↔leaf）
- [ ] 统一 view 间过滤与高亮语义

**验收标准**：

- 跨视图切换后，用户无需重建理解路径

---

## Epic C：治理与防回退（P2）

### C1. `triadmind verify` 门禁命令

**目标**：把质量规则固化为自动检查。  
**输出项**：

- [ ] `diagnostics_no_code`
- [ ] `execute_like_ratio`
- [ ] `ghost_ratio`
- [ ] `runtime_unmatched_route_count`
- [ ] `rendered_edges_consistency`

**验收标准**：

- 支持 `--json` 输出，便于 CI 消费

---

### C2. CI 阈值门禁

**目标**：阻断架构质量回退。  
**规则（初始建议）**：

- [ ] `diagnostics_no_code == 0`
- [ ] `execute_like_ratio < 0.10`
- [ ] `ghost_ratio < 0.40`
- [ ] `rendered_edges_consistency == true`
- [ ] `runtime_unmatched_route_count` 不得高于基线 +10%

---

### C3. 架构漂移周报

**目标**：提前发现腐烂趋势。  
**任务**：

- [ ] 输出新增高风险节点（高入度/高出度/高 Ghost）
- [ ] 输出中心度突变节点
- [ ] 输出关键链路断裂/新增
- [ ] 生成 `trend.json` + Markdown 周报

---

## 4. 任务排期（建议）

### Week 1（P0）

- A1、A2 完成
- 输出第一轮复测报告

### Week 2（P0+P1）

- A3 完成
- B1 初版完成并对比基线

### Week 3（P1）

- B2、B3 完成
- 完整回归测试

### Week 4（P2）

- C1、C2、C3 完成
- 接入 CI 与周报

---

## 5. 详细执行清单（可直接分派）

| ID | 优先级 | 任务 | 产出 | 预估 |
|---|---|---|---|---|
| T-001 | P0 | runtime 增加 `--max-render-edges` | CLI + runtime visualizer option | 0.5d |
| T-002 | P0 | 默认禁用 edge cap | 渲染边数与 map 一致 | 0.5d |
| T-003 | P0 | diagnostics code 强制化 | no_code=0 | 1d |
| T-004 | P0 | frontend API 路径归一化 | unmatched 显著下降 | 1.5d |
| T-005 | P1 | capability 晋升打分重构 | execute 比例下降 | 2d |
| T-006 | P1 | Ghost 分层与 Top-K | ghost 比例下降 | 2d |
| T-007 | P1 | 跨视图同源映射 | 视图一致性提升 | 2d |
| T-008 | P2 | `triadmind verify` 命令 | 可机读指标输出 | 1d |
| T-009 | P2 | CI 门禁集成 | 自动阻断回退 | 1d |
| T-010 | P2 | 漂移周报输出 | trend.json + md 报告 | 1d |

---

## 6. 复测脚本（建议每次改动后执行）

```bash
cd /home/wujianfeng/LanPlatform/rheos

# 1) 刷新拓扑
npx triadmind sync --force

# 2) 生成 runtime 视图
npx triadmind runtime --visualize --view full

# 3) 刷新主 visualizer
printf "n\n" | npx triadmind plan --no-open --view architecture

# 4) 指标采样
node -e '
const fs=require("fs");
const triad=JSON.parse(fs.readFileSync(".triadmind/triad-map.json","utf8"));
const runtime=JSON.parse(fs.readFileSync(".triadmind/runtime-map.json","utf8"));
const diag=JSON.parse(fs.readFileSync(".triadmind/runtime-diagnostics.json","utf8"));
const arr=Array.isArray(diag)?diag:(diag.diagnostics||[]);
const execute=triad.filter(n=>/execute/i.test(n.nodeId||"")).length;
const ghost=triad.filter(n=>Array.isArray(n?.fission?.demand)&&n.fission.demand.some(x=>String(x).startsWith("[Ghost:Read]"))).length;
const noCode=arr.filter(d=>!d.code).length;
console.log(JSON.stringify({
  triad_nodes:triad.length,
  runtime_nodes:(runtime.nodes||[]).length,
  runtime_edges:(runtime.edges||[]).length,
  execute_ratio: +(execute/triad.length).toFixed(3),
  ghost_ratio: +(ghost/triad.length).toFixed(3),
  diagnostics_total:arr.length,
  diagnostics_no_code:noCode
},null,2));
'
```

---

## 7. DoD（完成定义）

只有同时满足以下条件，才算本轮升级完成：

- [ ] `diagnostics_no_code == 0`
- [ ] `execute_like_ratio < 10%`
- [ ] `ghost_ratio < 40%`
- [ ] 默认 runtime 页面边数与 map 一致
- [ ] unmatched frontend route 显著下降（>=70%）
- [ ] CI 已接入 `triadmind verify` 门禁
- [ ] 提交完整 before/after 指标与截图

---

## 8. 风险与应对

- **风险**：降噪过度导致真实依赖丢失  
  **应对**：保留 Leaf drill-down 与 evidence 全量视图

- **风险**：匹配规则过严导致 API 链接漏判  
  **应对**：提供归一化回放日志，支持人工校验

- **风险**：性能回退  
  **应对**：加入性能基准（渲染耗时、交互帧率）并设回归阈值

---

## 9. 备注

本任务单优先级顺序：`P0 > P1 > P2`。  
若资源不足，先确保 P0 全量完成，再推进 P1/P2。

