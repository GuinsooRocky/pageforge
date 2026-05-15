# pageforge 版本演进

## new0.0.4（2026-05-14）

> **触发原因**：研究开源项目 [claude-task-master](https://github.com/eyaltoledano/claude-task-master) 后做"该借鉴啥"决策。对抗式评估（独立 opus sub-agent）把原始 8 条候选筛到 2 条真有 ROI 的 + 1 条设计原则，其余 6 条砍掉（agg 已有更对症方案 / 落点错 / 引入依赖反成本）。
> **筛选过程与对照**：本目录 `READING-NOTES.md`（task-master 源码精读 + 8 条候选评估表，可选阅读）。
> **本次落地**：DAG validator（工具就位但不强改 step 流程）+ schemas/ 单一真相重构（不引入 zod，保持零依赖）+ "分层不漂"设计原则显式化。

---

### N0.0.4-1 · DAG validator 工具就位（不强改 step 流程）

新增 `skills/pageforge/scripts/dag-validator.mjs`：

- **算法**：DFS 三色标记找环（参考 task-master `utils.js:1468 findCycles`，简化为单层 id 命名空间）
- **触发条件**：[MANIFEST] 中出现可选 `- **deps**: [NW-XXX, NW-YYY]` bullet 时检测环；零 deps 字段时自动 pass（向后兼容）
- **输出**：环路径 + 修复建议（删环上最后一条边，确定性最小影响修复）+ 悬空依赖报告；支持 `--json` 机器读
- **现状**：工具就位备用，**step 流程不强制集成**。未来 visual-analyzer / tech-solution-generator 需要声明 NW-* 间依赖时（NW-* 数量 ≥ 50 必然出现）启用
- **测试覆盖**：clean / empty / cycle / missing-dep 四场景已通过

影响文件：
| 文件 | 修改 |
|---|---|
| `skills/pageforge/scripts/dag-validator.mjs` | 新建（~210 行） |
| `skills/pageforge/SKILL.md` 环境变量段 | 加 [DAG_VALIDATOR] |

### N0.0.4-2 · schemas/ 单一真相重构（不引入 zod）

新增 `skills/pageforge/schemas/` 目录，把跨 agent dispatch 的受控枚举/字段约束从 schema-validator.mjs hardcode 抽出为静态 JSON Schema Draft-07 文件：

| 文件 | 用途 |
|---|---|
| `schemas/manifest-status.schema.json` | [MANIFEST] 组件 status 9 枚举（含 `x-producer-by-value` / `x-lifecycle-invariant` 扩展） |
| `schemas/nw-components.schema.json` | [TEMPLATE_SUMMARY] nw_components 表 row schema（5 字段 + pattern 约束） |
| `schemas/tech-fe-mode.schema.json` | [TECH_FE] frontmatter `模式:` 3 枚举（含 `x-semantics`） |
| `schemas/README.md` | 设计原则 / 引用方式 / 与 schema-validator 关系 |

`schema-validator.mjs` 改造：启动时从 schemas/*.schema.json 加载 enum 数组转 Set，校验函数 0 行修改。**测试证据**：改造前后跑同样 manifest/tech-fe/template-summary 文件，`validator-pass-token` 的 sha256 hash 完全一致（token 基于校验产物计算），零回归。

**借鉴对照**（不直接照搬）：
- 借鉴 task-master `src/schemas/base-schemas.js` 的"声明式 schema + JSON Schema 导出 / 单一真相"思想
- **不引入 zod / ajv**：agg scripts/ 严格"zero external deps"原则不变；静态 JSON 文件即可实现等价功能（JSON Schema spec 允许 `x-*` 扩展字段记录领域约束）
- **不做 markdown → JSON object 重构**：agg 产物本来就是 markdown，校验逻辑保持文本扫描风格（schema-validator 校验函数全保留）

影响文件：
| 文件 | 修改 |
|---|---|
| `skills/pageforge/schemas/` | 新建目录 + 4 个文件 |
| `skills/pageforge/scripts/schema-validator.mjs` | 头部加 `loadEnum()` + `__dirname` 路径解析，替代 3 个 hardcode `Set` 常量 |
| `skills/pageforge/SKILL.md` 环境变量段 | 加 [SCHEMAS_DIR] |
| `skills/pageforge/SKILL.md` §[MANIFEST] status | 加"权威定义见 schemas/manifest-status.schema.json"引用提示 |
| `skills/pageforge/SKILL.md` §[TEMPLATE_SUMMARY] | 同上 |

### N0.0.4-3 · 设计原则显式化（"分层不漂"+ schema single source of truth）

`skills/pageforge/SKILL.md` 顶部"设计原则"段加 2 条：

- **分层不漂**：SKILL.md / `agents/*.md` 永远是流程编排薄层，硬活全进 `scripts/*.mjs`，受控真相全进 `schemas/*.schema.json`。借鉴自 task-master `@tm/core` 业务逻辑单一真相重构原则
- **schema single source of truth**：所有跨 agent dispatch 的受控枚举/字段约束权威定义在 schemas/，schema-validator 加载、sub-agent prompt 引用、SKILL.md 表格镜像，三处必须一致

> **范围**：仅 SKILL.md 文档化（4 行），无代码影响。

---

## 未落地的候选（task-master 研究后明确不偷）

子 Agent 对抗评估后判定**不偷**的 6 条（节省约 22h 工作量 + 不引入 3 个 npm 依赖）：

| 候选 | 不偷理由 |
|---|---|
| 5 层 LLM 调用冗余 | agg 跑在 CC harness 里调 sub-agent，不存在 task-master 的 provider 切换；jsonrepair 对 markdown+frontmatter 产物完全无效（无 JSON parse 步骤）；CC harness 已自带 stream 重连 |
| TimeoutManager（Promise.race） | 主 Agent 拿不到 sub-agent 的 Promise 句柄包不了 race；05.11 事故是 CC harness↔Anthropic API 之间的上游空闲超时，0.5 scope-narrower + 中途落盘是更对症的源头方案 |
| FuzzyTaskSearch（fuse.js） | d-class-prober.mjs 已是同思路精简版；fuse.js 在 tsx 文件名场景边际收益 <5%；引入 npm 依赖反成本 |
| Streaming partial preservation | new0.0.3 P0-1 中途落盘约束**比 stream buffer 抢救更可靠**（落盘 vs 内存），已胜出 |
| gpt-tokens 真实计数 | agg 主 Agent 完全不做 token 估算（CC harness 管 context window）；0.5 用行数/KB 阈值反而更稳健且与 tokenizer 解耦 |
| PromptManager variant + Ajv | 7 个 sub-agent prompt 量级不到需要模板化抽象；与"流程跨项目通用 / 项目知识由 baseline 翻译"原则正交 |

详细对抗评估见 `agg/evolution/`（如需归档可建 `05.14-task-master-借鉴评估.md`）。

---

### N0.0.4-4 · §X 章节锚点编号化（LLM 视角检索锚点）

把 SKILL.md 内 16 个真实章节（13 个 `##` + 3 个 `###`）加 `§X` 前缀，便于 sub-agent return 报"§M1 status 违规"代替"§MANIFEST status 受控集合 违规"（字短 + 精准定位）。命名空间避免与 [TECH_FE] 内部 §4.x 撞：

| 前缀 | 含义 | 例 |
|---|---|---|
| `§D` `§G` `§V` `§R` `§C` | 设计 / Glossary / Variables / Responsibility / Constraints | §D 设计原则 / §G Glossary |
| `§X` `§I` `§O` `§P` `§Q` | eXecution / Input / Output / Plan / matriX | §P 计划模板（7 步）|
| `§M1` `§M2` | MANIFEST 相关 | §M1 status 受控集合 |
| `§F` `§F1` `§F2` | Failure 相关 | §F1 Failure & confirmation matrix |

**改动量**：16 个标题加 `§X` 前缀；同步 1 处交叉引用（L84 fail-fast 错误信息字符串）。**净增 0 行 / +80 bytes**。计划模板内部 numbered list（0/0.5/1-5）不加 §S 前缀避免双编号噪音。

### N0.0.4-5 · §F1 Failure & confirmation matrix 总表

把散写在各 step 段的"Failure semantics"和"人工确认时机"集中到一张总览表，主 Agent 出错时一处定位，**不再回到各 step 段翻**。

**改动**：
- 新增 §F1 章节（标题 + 说明段 + 7 行表）共 ~17 行
- 删除 step 0 / 0.5 段内 Failure semantics 4+3 行 + 加 1 行引用
- 删 5 处零散"此处不需要/必须等人工确认"行
- 原 §F 改 §F2 partial success 兜底链路

**净 diff +3 行**。

### N0.0.4-6 · SKILL.md 拆主索引 + references/（A）

SKILL.md 从 267 行（含全部横切约束）→ **176 行**（仅流程主干 + 跳转引用）。提取 5 个章节到 `references/`：

| references/*.md | 内容 |
|---|---|
| `glossary.md` | §G 术语对照（footprint / 内联复用 / brownfield-greenfield-mixed / scaffold slot / strict equality）|
| `manifest-status.md` | §M1 status 9 枚举 + §M1.1 不变量 + §M1.2 Unknown 处理 |
| `nw-components.md` | §M2 [TEMPLATE_SUMMARY] nw_components 表 schema + 模板片段 |
| `three-dimension-matrix.md` | §Q 三维度行为对照表 |
| `failure-handling.md` | §F1 matrix + §F2 partial success 兜底链路 |

**LLM 视角收益**：主 Agent 每次启动装入量 267 → 176 行（**节省 91 行/启动 × 100 次跑 = 累计 9100 行 token**）；横切约束按需 Read references/*.md，常规流程不进主 context。

### N0.0.4-7 · spec ↔ 历史散文剥离（E）

删除 SKILL.md 中所有"Why / 实战根因 / 历史标签"散文（`new0.0.3 新增` / `new0.0.4 新增` / `2026-05-11 实战已踩坑` / `详见 agg/evolution/...`）共 ~10 行。**spec 端只留规则不留缘由**；缘由仍保留在 CHANGELOG / evolution/。

### N0.0.4-8 · streaming-safety 抽到 agents/_common/（C）

新增 `agents/_common/streaming-safety.md`（29 行通用规则），4 个 sub-agent（prd-clarifier / project-baseliner / tech-solution-generator / visual-analyzer）原"⚠️ 中途落盘约束"段瘦身：通用部分（失败模式 / 工作模式 / 禁止行为 / 失败兜底）改成 1 行引用，仅保留 agent-specific 的落盘细节（目标文件 / 章节切分 / Edit 频次）。

**改动量**：
| 文件 | v0.0.3 行 | v0.0.4 行 | diff |
|---|---|---|---|
| `agents/_common/streaming-safety.md` | - | 29 | +29 |
| `agents/prd-clarifier.md` | 101 | 99 | −2 |
| `agents/project-baseliner.md` | 50 | 48 | −2 |
| `agents/tech-solution-generator.md` | 207 | 208 | +1 |
| `agents/visual-analyzer.md` | 336 | 332 | −4 |

注：page-template-gen / page-logic-gen 不在内（产物是源代码不是大 markdown，不适用 streaming-safety）。

---

## new0.0.3（2026-05-11）

> **触发原因**：2026-05-11 用世界卡 MVP PRD（1500+ 行 ch8 全量）试运行 new0.0.2，sub-agent prd-clarifier 因 context bloat 连挂 2 次（cert / socket 错误），共烗 16 min 三手 token 仍无产物。
> **根因诊断报告**：`/Users/lengmo/Desktop/cmm/agg/evolution/05.11-fe-workflow-new0.0.2-诊断.md`
> **本次落地 P0**：第 1 + 第 2 条建议

---

### P0-1 · sub-agent 中途落盘约束（影响 4 个 spec）

为防止 sub-agent 单次大块 markdown 输出撞穿上游 LLM 空闲超时（5-10 min）导致整段 stream 失败、`total_tokens: 0`、文件 0 字节，所有产出大型 markdown 的 sub-agent / skill 必须按章节增量 Write/Edit：

| 文件 | 修改 |
|---|---|
| `agents/prd-clarifier.md` | 末尾加 "## ⚠️ 中途落盘约束" 段，强制 prd-analyzer 走骨架 → 按节 Edit 流程 |
| `skills/prd-analyzer/skill.md` | Step 8 后加 "中途落盘约束" 段，要求 Step 6 一开始 Write 骨架、按 §1-§14 顺序逐节 Edit、Step 8 不再做 Write |
| `agents/project-baseliner.md` | 末尾加 "中途落盘约束" 段，要求 code-baseliner skill 的 Stage 1-4 按 M1-M9 字段增量落盘 |
| `agents/tech-solution-generator.md` | 文档头部加 "中途落盘约束" 段，要求 Phase 1 Write 骨架、Phase 1/2 按章节 / 字段 Edit |

**预期收益**：sub-agent 中途死掉时已落盘的章节自动保留，主 Agent 接力补缺章节比从零重跑省 50%+。

### P0-2 · scope-narrower 前置（pageforge/SKILL.md 新增 step 0.5）

在 step 0 和 step 1 之间插入主 Agent 自检步骤（不调度 sub-agent，无 LLM 失败风险）：

- 检测 [ORIGIN_PRD] 行数 / 大小（阈值 800 行 / 50KB）
- 超阈值 → AskUserQuestion 让用户切 scope
- 用户切了 → 生成 [ORIGIN_PRD_SCOPED] = `.claude/docs/origin-prd-scoped.md` 供下游消费
- 未超阈值或用户选全量 → 跳过此步零开销

**影响范围**：
- `skills/pageforge/SKILL.md`：
  - "当前环境变量及目录规则" 加 [ORIGIN_PRD_SCOPED]
  - "计划模板" 从 6 步（0-5）改为 7 步（0 / 0.5 / 1-5）
  - "step 1 澄清文档生成" 加输入路径选择说明（[ORIGIN_PRD_SCOPED] 优先）
  - "三维度行为对照表" 加 step 0.5 一行

**预期收益**：从源头降低下游 context 大小，sub-agent 装载量减半，撞超时概率下降 70%+。

---

## new0.0.2（基线，未列改动；详见 `new0.0.1` → `new0.0.2` 历次 evolution 文档）

---

## 后续 P1-P4 待办（不在 new0.0.3 范围）

详见 `agg/evolution/05.11-fe-workflow-new0.0.2-诊断.md` §3：

- P1 · sub-agent 输入扁平化（skill / template 精简）
- P1 · clarifier 切片为 3 个 sub-agent（structure / detail / baseline）
- P2 · baseline 主体 / 索引分离
- P2 · 单回合 token 上限约束
- P3 · 主 Agent inline 兜底模式开关
- P3 · barrier sync 改 fan-out + 异步消费
- P4 · pre-flight check 机制
