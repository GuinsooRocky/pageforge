# pageforge 版本演进

## new0.0.5（2026-05-17 ～ 05-22）

> **触发原因**：在 onlychat-agg-tuning worktree 里对 pageforge 做了多轮实跑调优，本次把调优成果回落进 agg。改动均源自真实跑批暴露的问题——sub-agent socket 中断、step 推进的"自动化体感"、视觉精度与排期不确定性。
> **来源**：onlychat-agg-tuning worktree 实跑回落（非借鉴外部项目）。回落时已对 worktree 引入的项目特定示例做去具体化（换通用例 / 占位符），保持 agg 跨项目通用。
> **一期落地（05-17）**：全自动推进 + 暂停白名单、step 2 视觉分析三档模式、大批量 NW-\* 分批续跑机制（§B）、step 5.5 figma-review 验收、埋点足迹二级保险、workflow-evaluator 能力评估元 Agent。
> **二期补充（05-22 回落，见下「二期」节）**：generate-then-verify 回路 + nw-verifier 子 Agent、跨 NW-\* 契约对账（事前注入 §5.5 → B9 → V5）、确定性死状态 / 幽灵 import 扫描、pageforge-prep 产出规范化层、第二/三波减法收敛（砍 5-D / state-extractor / V5 对抗扫描）。

---

### N0.0.5-1 · 全自动推进 + 暂停白名单（§X 重写）

step 完成后**默认自动推进**下一步，每步只输出简短总结（耗时 / 产物 / validator token / 关键发现）。仅 3 类情况允许暂停：① QA / 澄清需用户回答 ② 必需输入缺失 ③ 机制故障需用户决策"续跑 vs 重跑 vs 跳过"。纯粹的"step N → N+1"**禁止**用 AskUserQuestion 问"要不要继续"。

> 原 §X 是"每步必须等用户确认完成"——实跑下来用户只能机械回"继续"、毫无自动化感，故反转默认值。

### N0.0.5-2 · step 2 视觉分析三档模式 + token-fidelity 硬约束

step 2 调度前用 AskUserQuestion 让用户选 `step2_mode`（按 NW-\* 规模 / 新建占比 / O-\* 数自动给建议默认）：

| 档位 | 耗时 | 适用 |
|---|---|---|
| 2.B 轻量 | ~7 min | 小修小补，design_tokens 不 inline |
| 2.C 中量 | ~14 min | 大 brownfield PRD，inline 真 tokens |
| 2.A 深度 | ~35 min | pixel-perfect 验收 / 全新页面，全量 IoU |

`step2_mode` 写入 [MANIFEST] frontmatter；step 4-B 新增 **token-fidelity 硬约束**：2.C / 2.A 下必须按 manifest 真 token 写 className，禁止 `rounded-lg` / `gap-2` 之类通用默认值兜底，缺值处标 `// figma-token-missing`。visual-analyzer 内部按 mode 走三档分支。

### N0.0.5-3 · §B 大批量 NW-\* 分批续跑机制（new）

sub-agent 稳定在 5-9 min / 40-58 tool uses 触达 socket 中断窗口，单 agent 扛不住几十个 NW-\*（实战单 agent ~28 个即断）。新增 §B：

- **批次粒度实测校准**：4-B 组件骨架 8 个 / 批，5-B 组件逻辑 6 个 / 批（5-B 含 Edit 往返，单文件成本高 30-60%，故粒度更低）
- **批间严格串行** + **grep 自盘点续跑**：每批入场先 `find` / grep 探测已落盘部分，只补未完成的；增量落盘，断点可任意续
- **§B.6 完成信号补丁**：worktree 内 `.claude/agents/*.md` 未注册为 subagent_type，须用 general-purpose 包装跑，dispatch 时强制挂"完成后立刻 STOP"补丁，否则每批白等 600s watchdog

### N0.0.5-4 · step 5.5 figma-review 视觉验收步（new）

step 5 + 5-C postcondition pass 后自动跳 `/figma-review`，对 status=ok 的 NW-\*.tsx 与 [MANIFEST] figma_node 做事后对照，产 `figma-review-diff.md`（light/dark/PC/mobile 四轨视觉 gap + 建议改法）。**不修代码**，仅产 diff 供用户 polish。2.C / 2.A 默认开，2.B 询问，NW-\* ≤ 5 可跳。

### N0.0.5-5 · 埋点足迹二级保险（step 3 限制④）

footprint.json 中 `tracking_calls` 类足迹（脚本输出 `protected_footprint` 显式标记）**禁止登记进 §4.6 删除授权清单**——即使 PRD 明确要求"改埋点"也只走加法。埋点误删后果是数据线静默断裂、极难在回归发现，故单设此保险，**优先级高于 §4.6 通用授权删除规则**（一票否决）。

### N0.0.5-6 · 其它

- **§E 各步预估耗时表**（new）：用于排期与瓶颈定位，区分"实测校准" / "估算"来源
- **[AGENTS_DIR] 环境变量**：显式化 `.claude/agents/` 位置 + worktree dispatch 说明
- **code-baseliner**：M2 新增"归置约定"（探 `placement_convention`：弹窗 / hook / util 目录归置）+ "命名约定"（探 `naming_convention`）
- **prd-analyzer**：§9 新增主动扫描要求——术语一致性扫（同对象多名 / 同名多义）+ 逐端交互完整性扫（每页返回 / 关闭 / 提交在 PC 与 Mobile 是否都定义）

### N0.0.5-7 · workflow-evaluator 工作流能力评估元 Agent（new）

新增 `agents/workflow-evaluator.md`：opus 元 Agent，对 pageforge 类工作流做**纯静态 spec 审计**（不运行工作流），沿 7 个能力维度产一份加权能力分报告（总分 0-100）。

针对"同一份 spec 跑 10 次飘 2-3 次"的根因——单 Agent 注意力被整份 spec 摊薄、凭印象出分——用三层机制保证可复现：① **维度物理隔离**（每维度派独立 sub-agent，各拿限定 rubric + 文件清单）② **证据绑定打分**（每个 rubric 项须附 `file:line` + 原文引用，无证据强制判 0）③ **确定性汇总**（维度主分按公式算，协调者只做加法、禁止主观调整总分）。

**影响文件**（16 个，自 onlychat-agg-tuning worktree 回落）：

| 区域 | 文件 |
|---|---|
| pageforge skill | `SKILL.md`、`scripts/footprint-extractor.mjs`、`scripts/schema-validator.mjs` |
| 其它 skill | `code-baseliner/SKILL.md`、`prd-analyzer/skill.md`、`prd-analyzer/template.md` |
| agents | `visual-analyzer.md`、`tech-solution-generator.md`、`page-template-gen.md`、`page-logic-gen.md`、`prd-clarifier.md`、`prd-api-fetcher.md`、`project-baseliner.md`、`workflow-evaluator.md`（new）、`_common/streaming-safety.md`、`_refs/tech-solution-generator/phase-2-probing.md` |

---

### 二期补充（2026-05-22 回落 · 05-18～05-21 worktree 实跑）

> 一期回落后又跑了若干轮 fresh-run（世界卡 PRD 全量 / 写回簇半量实测），暴露的摩擦按**结构性根因归主题收敛、不逐条打补丁**（防屎山）。详细 dev 史见 `skills/pageforge/CHANGELOG.md`。

#### N0.0.5-8 · generate-then-verify 回路 + nw-verifier 子 Agent（new · lever ③）

新增 `agents/nw-verifier.md`（opus、只读审计）：对**单个 NW-\***拿「切片（规格）+ 生成的 .tsx（成品）」做语义层逐项核对，覆盖 §5 逻辑 / design_token / PRD 约束 / brownfield 足迹 / 跨 NW-\* 契约五类（V1~V5），产 verdict + 失败修正指令。**judge 模式**（核 spec 落地是否到位），不做对抗扫描——把生成与验证的"理解"彻底解耦，才能抓出生成时的系统性误读。

#### N0.0.5-9 · 跨 NW-\* 契约对账：事前注入（§5.5 → B9 → V5）

替代路线图「新建对账表 + V6（~300 行）」的过度设计，复用 B7/B8 同款「事前注入」：

- step 3 产 **§5.5 跨 NW-\* 契约对账表**（`契约符号 | kind | owner | 形状 | 写回义务`）
- `nw-slicer.mjs` 解析 §5.5 → 注入每个 NW-\* 切片 **B9 节**（写回义务 / 消费形状 / owner 导出三视角），生成 sub-agent 据此精确消费、不臆造字段
- nw-verifier **V5 契约对账**维度逐字段核对（写回字段齐全 / 消费形状不臆造 / owner 导出齐全）
- **enum 硬约束**：§5.5/B9 enum 形状只写 **proto 源路径 + 成员名、严禁数值**（实测手抄 proto 数值全抄错）；消费方一律 import proto 成员，V5 只核"是否 import proto + 成员语义对"，不拿数值判对错

#### N0.0.5-10 · 确定性死状态 / 幽灵 import 扫描（替代对抗 verify）

- `dead-state-scanner.mjs`：9 类死状态确定性扫描，含 `handler-noop`（具名处理器空体 `const handleX = () => {}`）——直接命中 tsc 永远抓不到的 no-op handler 真 bug
- `import-resolver.mjs`：5-C 第二关，jsonc-aware tsconfig paths 解析，防"盲写 import → 编译期硬崩"幽灵符号
- **设计教训**：对抗扫描用确定性脚本 / 固定 grep pattern，**不**让 opus 子 Agent 反复挑刺（retry 上限内不收敛、烧 opus 换 0 修复）

#### N0.0.5-11 · pageforge-prep 产出规范化层（new）

`pageforge-prep.mjs`：治"agent 手写产出 ↔ 脚本严格解析"格式漂移。`normalize-manifest`（统一 manifest header 形状）+ `init-summary`（从 manifest 自动生成 template-summary 骨架，主 Agent 不手写）。step2 后置 normalize、step4 前 init-summary，**不在各脚本各加容错正则**。

#### N0.0.5-12 · 第二 / 三波减法收敛

按"减法优先、防屎山"砍掉实测信号 ≈ 0 的机制：

- 砍 **5-D integration-verifier 整套**（实测 verdict=pass 但 5 处 import 硬崩，4 类边覆盖不到 NW 内部 props/atom 真 bug）
- 砍 **step 2.5 state-extractor 独立 sub-agent**（opus 成本 vs 下游效果未观察到）
- 砍 **nw-verifier 旧 V5「对抗扫描」**（回退纯 judge；现 V5 = 契约对账，二者无关）
- `dag-validator` 砍重的 `--emit-edges`，收敛为轻量 `--emit-layers`（输出拓扑分层；§B.5 改成主 Agent 必须据分层分波、禁按编号自分，根治父子组件切同波 prop 漂移）

#### N0.0.5-13 · 配套：schemas / references / 大文档 IO

- schemas 扩充：`nw-slice.schema.json`、`component-graph.schema.json`、`forbidden-patterns.schema.json`
- `references/estimates.md`（各步预估耗时表，排期 + 瓶颈定位）
- `skills/pageforge/CHANGELOG.md`（new，skill 级 dev 史单一真相）
- streaming-safety 加「大文档分页拉 + 即写」段（治飞书大文档单次 fetch ~270s socket 崩）

**二期影响文件**（自 onlychat-agg-tuning worktree 回落）：

| 区域 | 文件 |
|---|---|
| agents（new） | `nw-verifier.md` |
| pageforge scripts | `nw-slicer.mjs`（new）、`dead-state-scanner.mjs`（new）、`import-resolver.mjs`（new）、`pageforge-prep.mjs`（new）、`xref-closure.mjs`（new）、`dag-validator.mjs`、`schema-validator.mjs`、`footprint-extractor.mjs`、`README.md` |
| pageforge schemas | `nw-slice.schema.json`（new）、`component-graph.schema.json`（new）、`forbidden-patterns.schema.json`（new）、`nw-components.schema.json`、`README.md` |
| pageforge 其它 | `SKILL.md`、`references/nw-components.md`、`references/estimates.md`（new）、`CHANGELOG.md`（new） |
| 其它 skill | `code-baseliner/SKILL.md`、`figma-analyzer/README.md`、`get-background-img/README.md`、`origin-prd-gen/skill.md`、`prd-analyzer/skill.md`、`prd-analyzer/template.md` |
| agents（改） | `page-logic-gen.md`、`page-template-gen.md`、`tech-solution-generator.md`、`visual-analyzer.md`、`project-baseliner.md`、`prd-clarifier.md`、`prd-api-fetcher.md`、`_common/streaming-safety.md`、`_refs/page-template-gen/4-1-brownfield.md`、`_refs/tech-solution-generator/tech-fe-schema.md` |

> **保留未删**：`agents/workflow-evaluator.md`（一期加入的能力评估元 Agent）仍在；worktree 当前无此文件、亦无引用，回落时按"不主动删"保留。

---

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
