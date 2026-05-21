---
name: pageforge
description: 负责调度各种技能全自动生产前端代码的 skill。当用户需要启动的端到端整生产流程（包含项目盘点、PRD 解析、澄清、视觉分析、技术方案、代码生成、组件生产、灰度发布、测试）时调用。设计目标为跨项目通用：流程知识在 skill 内，项目知识由 step 0 baseline 产出的「项目字典」承载。
tools: Read, Write, Bash, Grep, Glob, Task
---

# 前端全自动生码工作流

启动当前计划执行工作流来调度前端计划执行技能最终得到的端相关代码。

## §D 设计原则

- **流程跨项目通用**：skill / agent 内部禁止 hardcode 任何项目特定资产名（如 `TooltipV2`、`CoUI Toast`、`audioAutoPlayAtom`）。具体项目映射由 step 0 产出的「项目字典」翻译。
- **维度正交**：以三个独立维度判定每步行为——① 项目成熟度（全新仓 / 早期 / 成熟）② 需求范围（新页面 / 改造 / 跨页 / 单组件）③ 复用粒度（全新建 / 改现有 / 复用 / 跨项目共享）。step 4 的 4.1/4.2 分支是"项目成熟度 × 需求范围"两个维度的常见组合，不是二元对立。
- **分层不漂**：SKILL.md / `agents/*.md` 永远是**流程编排薄层**，不写硬活；硬活全进 `scripts/*.mjs`（脚本零外部依赖，仅用 node 内置 + `schemas/` 下的静态 JSON Schema）。判断标准：枚举/字段/路径约束这类"会变的真相" → 写进 `schemas/*.schema.json`；DFS/regex/AST 扫描这类"确定性算法" → 写进 `scripts/*.mjs`；只有"何时调谁、怎么并发、出错怎么 fallback"才进 SKILL.md / `agents/*.md`。
- **schema single source of truth**：所有跨 agent dispatch 的受控枚举/字段约束（[MANIFEST] status / nw_components 表 / [TECH_FE] 模式）权威定义在 `schemas/*.schema.json`，schema-validator.mjs 启动时加载，sub-agent prompt 引用同一份文件。修改 SKILL.md 中相关表格必须同步 `schemas/`，反之亦然。
- **PRD 截图只供早期理解**：PRD 里的截图是表意素材（step 0 vision 读成文字即用完、不落盘），用于 step 0/1 拿到需求的粗含义，**不作为像素级落地依据**；spacing/color/font 等精确值一律以 step 2 的 Figma 为准，PRD 截图与 Figma 冲突时以 Figma 为准。pageforge 不做"PRD 截图 → Figma 节点"逐图映射，只做"需求 → NW-* 组件 → Figma 节点"功能映射。

## §G Glossary

术语对照详见 [`references/glossary.md`](references/glossary.md) — footprint / 内联复用 / brownfield-greenfield-mixed / scaffold slot 等专有术语集中定义。**遇到陌生术语时按需 Read，常规流程不必装入主 context。**

## §V 当前环境变量及目录规则
- [PLAN] = '.claude/task/plan.md'
- [PENDING] = '.claude/task/pending.md'
- [CODE_BASELINE] = '.claude/docs/code-baseline.md'  ← 新增（step 0 产出）
- [PLACEHOLDER_LIST] = '.claude/docs/placeholder-list.md'
- [API] = '.claude/docs/api.md'
- [TECH_FE] = '.claude/docs/tech-fe.md'
- [ORIGIN_PRD] = '.claude/docs/origin-prd.md'
- [ORIGIN_PRD_SCOPED] = '.claude/docs/origin-prd-scoped.md'  ← PRD 切片产出，超过阈值时启用（详见 §P 计划模板 0.5 子步骤）
- [CLARIFY_FE] = '.claude/docs/clarify-fe-prd.md'
- [FIG_META] = '.claude/docs/fig_meta'
- [MANIFEST] = '.claude/docs/fig_meta/component-manifest.md'  ← step 2 产出，替代旧 brownfield_mapping + per_component/*.json
- [TEMPLATE_SUMMARY] = '.claude/docs/template-gen-summary.md'  ← step 4 产出（含 nw_components 状态表）
- [LOGIC_SUMMARY] = '.claude/docs/logic-gen-summary.md'  ← step 5 产出
- [FOOTPRINT_EXTRACTOR] = '.claude/skills/pageforge/scripts/footprint-extractor.mjs'  ← step 3 §2.1 调用（六类结构化提取，替代 LLM 自由扫源码）
- [D_CLASS_PROBER] = '.claude/skills/pageforge/scripts/d-class-prober.mjs'  ← step 3 Phase 2 步骤 5 调用（NW-* 新建路径存在性 + 同功能候选枚举，替代 LLM 自己跑 ls + grep）
- [PAGE_AGGREGATOR] = '.claude/skills/pageforge/scripts/page-aggregator.mjs'  ← step 4 4-C aggregator 调用（page.tsx placeholder → 真实组件 + import 批量加 + 'use client' OR 聚合 + 内置校验，替代 LLM 跑 N 次 Edit）
- [SCHEMA_VALIDATOR] = '.claude/skills/pageforge/scripts/schema-validator.mjs'  ← step 2/3/4 sub-agent return 前自检调用（Postcondition 自检模式，发现 schema 违规自己改完再校验，pass 才 return；exit 0 时 stdout 输出 `validator-pass-token:` 必须带回主 Agent return summary 作为校验通过证明）
- [XREF_CLOSURE] = '.claude/skills/pageforge/scripts/xref-closure.mjs'  ← step 0.5 末尾调用（PRD scope 引用闭包扩展）。解析 [ORIGIN_PRD_SCOPED] 正文里所有 `§X.X` 引用，BFS 闭包扩展把被引但未入选的章节自动补入 scoped 文件（标 `> ⚠️ [补 · 因 §X.X 引用 / depth=N]`）。默认 max-depth=3 防失控。零外部依赖、单纯正则 + BFS。**根治**: 切片只复制了入口章节、被引章节漏覆盖（下游 sub-agent 生码时硬编 placeholder 或盲写 import 的源头）
- [IMPORT_RESOLVER] = '.claude/skills/pageforge/scripts/import-resolver.mjs'  ← step 5-C postcondition 第二关调用（防"幽灵 import"——sub-agent 凭空 import 未交付的下游子组件导致编译期硬崩）。脚本扫产物 .tsx 的所有 import 路径（相对 + alias），检查目标文件是否在磁盘上存在；alias 从 `tsconfig.json` `compilerOptions.paths` 自动抽（兼容 jsonc 注释 + trailing comma），可通过 `--alias '@/=src/'` 显式覆盖；bare 包名（react / jotai / 等）默认 skip（包管理器领域，不在 pageforge 边界）。边界 = path/file-existence only，**不**做 typecheck / export 名解析 / lint / JSX 检查；exit 0 时 stdout 输出 `import-resolver-pass-token:<hash>` 必须带回 5-C return summary 作为通过证明。broken 时退出码 1 + 输出 broken 列表（owner / spec / attempt 路径），主 Agent 据此把修正指令喂回对应 NW-* 的生成 sub-agent 重生成（≤2 次，同 §B.7 verify-failed 重生成上限）
- [DEAD_STATE_SCANNER] = '.claude/skills/pageforge/scripts/dead-state-scanner.mjs'  ← step 5-C postcondition 第四关调用（软警告，nw-verifier 旧「对抗扫描」维度被砍后的确定性替代；注意现 nw-verifier V5 是「契约对账」judge 维度，与旧对抗扫描无关）。脚本扫产物 .tsx 的 9 类死状态 lexical pattern：回调 prop 显式 undefined / 空函数 / console-only stub；useState setter 从未调用（state stuck 初值）；空槽 state `[, setX]`（write-only）；`useMemo(() => [], [])` 硬编码空数组 memo；`const X = []` 被 .map/.length 消费且从未 mutate（list forever empty）；`const X = ''` 后被 `if (X)` 走死分支；具名处理器空体 `const handleX = () => {}`（接好线却 no-op）。**软警告语义**：命中 **不** fail-fast、**不** 触发 NW-* 重生成（避免旧对抗维度死循环——LLM adversary + retry ≤ 2 cap = 必不收敛），主 Agent 把每条命中追加到 [LOGIC_SUMMARY] 阻塞账本（文件 / 行 / pattern / 片段）。脚本退出码恒 0，stdout 末尾打印 `dead-state-scanner-found:<N>`（N=命中数），主 Agent 据此提取。边界 = 正则 only，不做 AST / typecheck / 跨文件流分析
- [DAG_VALIDATOR] = '.claude/skills/pageforge/scripts/dag-validator.mjs'  ← NW-* 组件依赖图工具。**职责**：① 找环 + dangling-dep（解析 [MANIFEST] `deps` 块建有向图、DFS 三色标记 + 修复建议；step 3 Postcondition 自检调）② **`--emit-layers <out>` 输出拓扑分层** `{layer_count, layers:[[id...]...]}`（owner 浅层、consumer 深层），供 §B.5 调度按层分波（主题 C）。可选 `--json`。deps 结构权威定义见 `schemas/component-graph.schema.json`。**注**：`--emit-layers`（轻量分层数组、调度用）≠ 已砍的 `--emit-edges`（重 per-NW-* edges.json，5-D/B6 体系 2026-05-21 整套砍）
- [PAGEFORGE_PREP] = '.claude/skills/pageforge/scripts/pageforge-prep.mjs'  ← **产出规范化层（主题 A）**：消除「agent 手写产出 ↔ 脚本严格解析」格式漂移。两子命令：① `normalize-manifest --manifest <p>` 把 visual-analyzer 产的 manifest header 规范成下游唯一认的 `## N name（NW-NNN）` 形态（step 2 产出后、跑 dag/schema-validator 前由主 Agent 调一次，幂等）② `init-summary --manifest <p> --out <p> --project-root <dir>` 从 [MANIFEST] 自动生成 [TEMPLATE_SUMMARY] 骨架（列序对齐 nw-components.schema、path 绝对，主 Agent 不手写、杜绝列错；status/is_client 留 step 4-B 回填）
- [NW_SLICER] = '.claude/skills/pageforge/scripts/nw-slicer.mjs'  ← lever ② 切片器；step 4-B/5-B 每个 NW-* dispatch 前由主 Agent 调用，从整份 [TECH_FE]/[MANIFEST]/[CODE_BASELINE]/[TEMPLATE_SUMMARY] 抽出 per-NW-* 精确切片（产物结构见 `schemas/nw-slice.schema.json`，锚点契约见 `_refs/tech-solution-generator/tech-fe-schema.md` 文末）。组件依赖契约由切片 B5 sibling 目录 + manifest deps 块（dag-validator 仅做找环 + dangling-dep 校验）承载，B6/edges 体系 2026-05-21 已砍
- [SLICE_DIR] = '.claude/docs/_slices/'  ← lever ② per-NW-* 切片临时产物目录（`NW-xxx.slice.md`）；生成 sub-agent 与 nw-verifier 共享，pageforge 结束后可清
- [NW_VERIFIER] = '.claude/agents/nw-verifier.md'  ← lever ③ 语义校验子 Agent（`model: opus`）；step 4-B-verify / 5-B-verify dispatch，拿切片 + 成品做 §5逻辑/token/PRD/足迹/跨NW-*契约对账 五类核对（V1~V5，单组件 verify — judge 模式）
- [VERIFY_CACHE] = '.claude/docs/_verify-cache/'  ← per-NW-* verify 跨轮 memory 目录（`<NW-id>.json`）。Reflexion 模式：每轮 nw-verifier 判 verify-failed 时把 fail_items（行号 / spec 原文 / 修复指令）写入该 NW-* 的 cache；重生成 dispatch 时主 Agent Read cache 把上轮 fail items 注入 prompt；下一轮 verifier 优先核对「上轮 fail 是否已修」而非翻新挑剌。**根治** verify-fix 不收敛。**项目规模条件分支**：开关由 §B.9 项目规模档位统一控制（小项目 NW-*<10 默认关，cache 空跑无价值；大项目必开）。pageforge run 结束后可清。文件格式：`{ nw_id, attempts: [{round, verdict, fail_items:[...], timestamp}] }`
- [SCHEMAS_DIR] = '.claude/skills/pageforge/schemas/'  ← 跨 agent 受控枚举/字段约束的 single source of truth（JSON Schema Draft-07 静态文件；schema-validator.mjs 启动时加载；sub-agent prompt 可引用文件路径。详见 `schemas/README.md`）。含 `component-graph.schema.json` —— NW-* 组件依赖图 `deps` 块（`provides` / `consumes`）的权威结构定义，由 tech-solution-generator 产、dag-validator 解析
- [AGENTS_DIR] = '.claude/agents/'  ← 8 个子 Agent prompt 文件（project-baseliner / prd-api-fetcher / prd-clarifier / visual-analyzer / tech-solution-generator / page-template-gen / page-logic-gen / nw-verifier，均含 `model:` frontmatter）+ `_common/` 共用片段 + `_refs/` 按需引用片段。**注意：本目录在 skill 根目录之外（与 `.claude/skills/` 同级），引用 agent 文件一律走 [AGENTS_DIR] 前缀，不要写成 skill 相对路径 `agents/xxx.md`。worktree 内 `.claude/agents/` 未注册为可选 subagent_type，dispatch 时须 Read 文件内容包进 `subagent_type=general-purpose` 的 prompt（见 §B.6）。**dispatch 时还必须读取该 agent frontmatter 的 `model:` 值，作为 Agent 工具的 `model` 参数显式传入**——`general-purpose` 载体不会继承专名 agent 的 `model:`，漏传则该 sub-agent 跑成主 Agent 的模型，漏传 = 要么白烧钱要么不够准。**

## §R 职责范围
严格按照用户指定顺序来调度计划执行子 Agent 最终生成前端代码。

## §C Git 约束（强制）

**workflow 全程严禁在 PROJECT_ROOT 内执行任何 git 命令**，包括但不限于：
`git checkout` / `git switch` / `git branch` / `git stash` / `git reset` / `git restore` / `git commit` / `git push`

当前分支 / worktree 由用户在调用 workflow 前自行负责。workflow 只负责在当前 checkout 状态下读写文件，不干预 git 状态。step 4/5 写代码时落到哪个分支，完全取决于用户启动 workflow 时 PROJECT_ROOT 所在的分支。

## §M1 [MANIFEST] status 受控集合

跨 agent dispatch 的 9 个 status 枚举 + producer ownership + lifecycle 不变量详见 [`references/manifest-status.md`](references/manifest-status.md)；权威 JSON Schema 见 [`schemas/manifest-status.schema.json`](schemas/manifest-status.schema.json)。**主 Agent / sub-agent dispatch 时按需 Read。**

## §X 执行规则
- 用户每次新开启对话时，需要让用户确认是否初始化 [PLAN] 内容，如果需要初始化，需要将 plan 里面的计划和状态信息清除。
- 严格按照当前文件里的 [PLAN] 生产对应的计划任务，并将所有计划任务后写到 [PLAN] 中。
- 计划严格按照指定顺序执行。**默认全自动推进：一个 step 完成后立即自动启动下一个 step，不停下来等用户确认。**每个 step 完成只输出简短总结（耗时 / 产物 / validator token / 关键发现）后直接继续。
- **除各 step spec 自身明确要求的暂停（§X 首条 plan 初始化确认、0.5 scope 切片、step 2 step2_mode 选择、step 1 QA 等）外，step 之间额外允许暂停的只有以下 3 类**（其他一律自动推进）：
  1. **QA / 澄清**：step 1 prd-clarifier 产出待确认项需用户回答；或下游 step 发现需用户拍板的决策分歧
  2. **缺输入**：必需的 prompt / figma 链接 / 接口文档 / 仓库路径未提供
  3. **机制故障**：sub-agent socket 中断 / validator 反复 fail / 脚本调用失败等需用户决策"续跑 vs 重跑 vs 跳过"
- 纯粹的"step N 完成 → step N+1 启动"**禁止用 AskUserQuestion 问"要不要继续"** —— 用户已明确表示停下来只能回"继续"、没有自动化感（2026-05-15 用户指令）。
- 每个计划执行完毕后，必须更新 plan.md 文件中的任务执行状态，并对该任务进行总结。

## §I 用户输入
1. prd 链接/截图
2. 接口文档/`<INTERNAL_API_PLATFORM>`
3. figma 链接（生产计划时不允许读取 figma 链接里的内容）
4. 目标项目仓库路径（用于 step 0 baseline）

## §O 输出格式
- 输出给用户的确认信息需要以下述方式增加前缀：✅ 确认 'xx' 计划执行完成
- 未开始执行的计划格式：⭕ 执行 xx 计划
- 正在执行的计划格式：⚡ 执行 xx 计划
- 执行失败的计划：❌ 执行 xx 计划
- 执行成功的计划：✅ 执行 xx 计划
- 跳过执行的计划：⏭️ 跳过 xx 计划（按需步骤）
- **欠债收尾的计划**：⚠️ 执行 xx 计划完成，欠 N 项 upstream-gap（未达可运行）—— 仅 step 5 收尾时阻塞账本非空才用此态。语义：run 已结束、产物已落盘，但「假绿」现形——主流程因 N 个上游缺口（后端 mutation / atom 契约 / hook API 未定）不可端到端运行。账本清空（上游补齐）后重跑 5-C 才能升级为 ✅。⚠️ 态不算失败、不回滚，是诚实标注的「未完成的完成」。

## §P 计划模板（7 步：0 / 0.5 / 1-5）

```markdown
0. **项目盘点 + PRD/API 原料采集**（双 agent 并行调度 — fan-out + barrier sync）：
   主 Agent 在**一条消息**里同时发出两个 Task() 调用，启动两个独立 sub-agent 在各自 context 里**真并行**跑（fan-out）；等两者都返回摘要后才进入 step 1（barrier sync）。两个 agent **input 互不依赖**（A 读项目代码，B 读 PRD/API 原料），但 step 1 的输入**同时依赖** A 和 B 的输出，因此 barrier 必须 sync。

   **Failure semantics & 重试策略**：详见 §F1（统一矩阵）。

   **A. project-baseliner agent** → 调度 project-baseliner，产 [CODE_BASELINE]（项目字典）。M1-M9 九大类字段 schema、三态定义、跑/不跑判定详见 `[AGENTS_DIR]project-baseliner.md`「输出字段 schema」节。

   **B. prd-api-fetcher agent** → [ORIGIN_PRD] + [API]
   - 限制：不消费 [CODE_BASELINE] 与 [CLARIFY_FE]

0.5 **PRD scope-narrower（P0 防 context 爆炸）**：主 Agent 自己执行，**不调度 sub-agent**。

   **触发条件（任一命中即必须执行）**：
   - [ORIGIN_PRD] 行数 > **800 行**
   - [ORIGIN_PRD] 文件大小 > **50KB**
   - 用户在启动 pageforge 时已明确切片意图（如"只跑创建流程 / 只跑 ch8 / 只针对 X 页面"）
   - **PRD 为形态 B（聊天形态，含附件截图）**：此时 [ORIGIN_PRD] 的 .md 行数 / 大小**不能反映真实体量**（截图不转成文字行），`wc -l` / `stat` 判据天然失真——故形态 B 一律触发本步骤。**不数图、不按图估体量**（PRD 截图多为表意、非落地依据），直接让用户拍 scope（执行流程同下，AskUserQuestion 必带「全量跑」选项，小 PRD 用户点一下即过）

   **执行流程**：
   1. 主 Agent 用 Bash `wc -l [ORIGIN_PRD]` + `stat` 检测行数 / 大小（或 `awk 'END{print NR}'`）；**形态 B 时该数值仅供参考、不作为跳过依据**（见触发条件第 4 条——形态 B 必触发，主 Agent 由自己收到的用户输入判定形态，无需 prd-api-fetcher 回传）
   2. 若超阈值，**必须暂停**向用户索要 scope（用 AskUserQuestion 工具列候选切片或 "全量跑"）；用户答完才继续
   3. 若用户选了部分章节 / 部分页面：
      - 主 Agent 在 [ORIGIN_PRD] 顶部**插入** "## ⚠️ 本次 pageforge 范围" 章节，列出 In Scope / Out of Scope 章节号
      - 主 Agent 同时复制 [ORIGIN_PRD] 的对应章节内容生成 [ORIGIN_PRD_SCOPED] = `.claude/docs/origin-prd-scoped.md`
      - **下游 step 1+ 全部读 [ORIGIN_PRD_SCOPED] 而非 [ORIGIN_PRD]**（在 step 1/2/3 sub-agent prompt 里显式指明输入路径）
   4. 若用户选 "全量跑" 或 PRD 未超阈值：跳过本步骤，下游 step 1+ 直接读 [ORIGIN_PRD]
   5. **xref-closure 闭包扩展（[ORIGIN_PRD_SCOPED] 写入后必跑）**：主 Agent 调 `node [XREF_CLOSURE] --origin-prd [ORIGIN_PRD] --scoped [ORIGIN_PRD_SCOPED]`，脚本 BFS 扫所有 `§X.X` 引用、把被引但未入选的章节追加到 scoped 文件尾部（标 `> ⚠️ [补 · 因 §X.X 引用 / depth=N]`）。stdout 报告新增章节数 + 来源引用；exit 2（深度超限）→ 主 Agent 暂停并把 unresolved refs 列给用户拍板补不补。**根治**：PRD 章节互相 cross-reference 时切片只复制入口章节、被引章节漏覆盖（下游 sub-agent 看不到这段、要么硬编 placeholder 要么盲写 import）。step 4 跳过该步骤时不跑闭包扩展（PRD 未超阈值，全量已含）。

   **Failure semantics & 人工确认时机**：详见 §F1（统一矩阵）。

1. **澄清文档生成**：调用 `prd-clarifier` 子 Agent 生成澄清文档（无需接口文档输入），并保存到 [CLARIFY_FE] 中。生产完毕后需要等待用户回答待澄清问题，回答完毕才能继续执行下一步。

   - **输入路径选择**：
     - [ORIGIN_PRD_SCOPED] 存在 → sub-agent prompt 必须指明 "读 [ORIGIN_PRD_SCOPED]"
     - 不存在 → 读 [ORIGIN_PRD]（PRD 未超阈值，跳过了 0.5）
   - 限制：① 输入消费 [ORIGIN_PRD]、[CODE_BASELINE]
   - 限制：② §11/§12/§13（现有代码定位 / 复用清单 / 影响面）由 [CODE_BASELINE] 直接填，不再占位
   - 限制：③ §14 项目级澄清默认值的 **canonical store = [CLARIFY_FE] §14 自身**（跨 PRD 持续累积的项目偏好缓存）；prd-clarifier 在收到用户新答复后**直接追加**到本 §14，不需要从 [CODE_BASELINE] 同步。[CODE_BASELINE] M9 是规则文件路径索引（与本节内容不同），不要混淆
   - 限制：④ prd-clarifier 返回后，主 Agent **必须按 `[AGENTS_DIR]prd-clarifier.md` 中「主 Agent 接管指令模板」逐步执行**（§9 逐条问 / §10 confirm-or-veto / §11~§13 baseline 已填 / 收答回写 / 文档头标"已完成" / §14 抽取项目级默认 / 接管模板全部步骤未完不得调度 step 2）

2. **视觉分析**：如果没有提供设计稿链接，必须先询问用户提供设计稿链接。**主 Agent Read `[AGENTS_DIR]visual-analyzer.md`「模式三档判定表」节 → 按 auto 判定表算建议默认值 → 主 Agent 自己执行 `AskUserQuestion` 让用户选定 `step2_mode`（2.A / 2.B / 2.C）→ 带 `step2_mode` 参数调度 `visual-analyzer` 子 Agent**。注意：AskUserQuestion 必须由主 Agent 做（sub-agent 隔离上下文无法跟用户对话），不能委托给 visual-analyzer。visual-analyzer 内部按 mode 走对应分支。

   - 限制：① 输入消费 [CLARIFY_FE]、[CODE_BASELINE]，不消费 [ORIGIN_PRD] 和 [API]
   - 限制:② 产物目录必须在 [FIG_META]
   - 限制：③ 数据源 MCP 优先 `mcp__figma__`，fallback `mcp__figma-desktop__`（遵循 [CODE_BASELINE] M9 索引到的 figma 相关项目规则，若有）
   - 限制：④ 必须产出 [MANIFEST]（每个 NW-\*/RU-\* 组件的 status + design_tokens + placement）；**2.C / 2.A 模式必须 inline design_tokens 真值到 manifest**，2.B 模式 inline 只对 mapped 节点（保持轻量）
   - 限制：⑤ IoU 视觉匹配（components.json / match_data.pkl / matched-visualization.png）仅 2.A 模式产出
   - 限制：⑥ `step2_mode` 写入 [MANIFEST] frontmatter `step2_mode: 2.A | 2.B | 2.C` 字段，step 4 sub-agent 读此字段决定是否强制读 inline tokens
   - **Postcondition（主题 A，强制）**：visual-analyzer 返回后，主 Agent **立即调 `node [PAGEFORGE_PREP] normalize-manifest --manifest [MANIFEST]`** 把组件 header 规范成下游唯一认的 `## N name（NW-NNN）` 形态——visual-analyzer 默认产 `## NW-NNN name` 格式与 dag-validator/nw-slicer 解析正则不符（实测踩坑：status-gate-reject / 0 切片），规范化一次后下游统一消费、不在各解析脚本里散加容错。规范化后再跑 schema-validator step 2。
   - 必须等待该计划执行完毕才能继续下一步

3. **技术方案生成 + 实现层探测**：调用 `tech-solution-generator` 子 Agent（两阶段）：Phase 1 生成 tech-fe.md §1~§9 Q-T\* 列表（brownfield / mixed-brownfield 强制做 §4.0 Footprint Extract）；Phase 2 在同一 context 对 §9 做 grep 探测并更新 [MANIFEST] status。等待其执行完成后再继续下一步。§4.0 Footprint Extract 六类提取流程、埋点二级保险（`tracking_calls` 不可删，优先级高于 §4.6）等细节详见 `[AGENTS_DIR]tech-solution-generator.md` 步骤 2.1。
   - 限制：① 输入消费 [CLARIFY_FE]、[API]、[MANIFEST]、[CODE_BASELINE]
   - 限制：② 业务知识库来自 [CODE_BASELINE]（不读旧 MARTIAL / LOGIC_MARTIAL）
   - 限制：③ **内聚性复核**：E 类判「内联复用」前须过步骤 4.0 绝对内聚性复核（≥2 个「该独立」信号则禁内联 / 标「建议再拆」）；判据与历史 component count、人工实现文件数无关（数数法已作废）。源头颗粒度由 prd-clarifier §12 内聚性复核先标，tech-solution-generator step 3 接力，详见两 agent 文件

4. **页面模板 + 组件骨架生成**：调用 `page-template-gen` 子 Agent，按 [TECH_FE] §4 产出 page.tsx + 所有 status=`不存在，需新建` 的 NW-* 骨架文件，并在收尾子步骤把 page.tsx 装配为可直接渲染的 JSX。内部三时间阶段（4-A page-skeleton / 4-B component-skeleton / 4-C 收尾 aggregator）、token-fidelity 硬约束、'use client' 4 条件判定、partial success fallback、nw_components 6 字段行数据等 handler 内部细节详见 `[AGENTS_DIR]page-template-gen.md`。**4-B-verify（lever ③ 语义校验子阶段）由主 Agent 在每个 NW-* 骨架产出后 dispatch [NW_VERIFIER] 执行**（V1 结构/props/§5 + V2 design_token 保真；verify-failed → 修正指令喂回重 dispatch ≤2 次；仍不过标 verify-failed-giveup），详见 §B.7 与 [NW_VERIFIER]。
   - 限制：① 输入消费 [TECH_FE]、[MANIFEST]、[CODE_BASELINE]
   - 限制：② mode 分支（brownfield / greenfield / mixed）由 [TECH_FE] frontmatter `模式:` 字段决定（mode single source of truth）
   - 限制：③ 背景图片走 `get-background-img` 技能获取
   - 限制：④ 4-B 单次单文件 loop，**禁止单次产多个 NW-***（避免 token 爆且利于 partial success 隔离）
   - 限制：⑤ greenfield 子页面 4-A 必须使用 `m0-template-gen`
   - 限制：⑥ 4-B **一律 batch=1**：每个 status=`不存在，需新建` 的 NW-* 各起一个独立 sub-agent dispatch（不再分批）。dispatch 前主 Agent 调 [NW_SLICER] 抽该 NW-* 切片，sub-agent 只 Read 切片、禁读整份 [TECH_FE]/[MANIFEST]。N 个 NW-* 由主 Agent K 并发槽并行调度（§B.8），状态表由主 Agent 单一收口（§B.2）。中断按 §B.3/§B.4 单 NW-* 幂等续跑。详见 §B（§B.1 成本 / §B.2 并行收口 / §B.6 dispatch 模板 + watchdog / §B.7 三 lever 接缝 / §B.8 补槽调度）
   - 限制：⑦ status=`内联重写` 的 NW-*（step 3 步骤 2.0.5 最小改造判定产出）step 4 **整体跳过**：不建文件、不进 4-B loop、不留 placeholder；其逻辑由 step 5 在宿主文件内展开（见 page-logic-gen step 3 的 5-A 额外职责）

5. **页面 + 组件逻辑填充**：调用 `page-logic-gen` 子 Agent 把 step 4 留下的 `// TODO step5` 占位填实，5-C 仅做生码自身完整性校验。
   - **5-A page-logic**：对 page.tsx 填顶层状态机 / hooks / 子组件 props 传递
   - **5-B component-logic**：对 [TEMPLATE_SUMMARY] nw_components.status=`ok` 的每个 NW-*.tsx，**按 NW-* loop 单次单文件**填业务逻辑（hooks / event / state）；status=`skeleton-failed` 的整组跳过，[LOGIC_SUMMARY] 登记复跑入口
   - **5-C postcondition（三关 fail-fast）**：跨 page.tsx + 所有 status=`ok` 的 NW-*.tsx 依次跑——
     - **第一关 TODO 占位对账**：`grep -cE "TODO (step5([^.]|$)|C-class|upstream-gap)"` 残留计数必须 = step5-pending + C 类 + upstream-gap 之和。grep 公式用 `step5([^.]|$)` 要求 `step5` 后面是非 `.` 字符或行末，正确排除 `step5.5 figma-review` 视觉验收延期标记，同时保留 `step5`/`step5-pending` 命中。
     - **第二关 import 目标存在性**：调 `[IMPORT_RESOLVER] --summary [TEMPLATE_SUMMARY]` 防"幽灵 import"——脚本扫每个产物 .tsx 的所有 import 路径（相对 + alias，bare 包名 skip），检查目标文件是否在磁盘上存在。broken → fail-fast，主 Agent 把 broken 列表喂回对应 NW-* 的生成 sub-agent 重生成（≤2 次，同 §B.7 上限）；修正方向二选一：① 改成 `// TODO step5-pending: 需新增子组件 X`（不允许 import 未交付的下游） ② 改成既有可解析的组件（必须命中 [MANIFEST] NW-*/RU-* 或 [CODE_BASELINE] M2/M4）。pass 后 stdout 输出 `import-resolver-pass-token:<hash>` 必须带回 5-C return summary。本关专门挡「凭空发明子组件 import」类幽灵 import（manifest deps / B5 sibling 之外的盲写）。
     - **第三关 i18n 标签规范**：`grep -cE 'TODO i18n([^\-]|$)'` 反向校验，命中即 fail——要求所有 i18n 占位统一为 `TODO i18n-gap` 单一形式，禁止 `TODO i18n`（无 -gap）或其他变体，避免下游统计与对账失真。
     - **第四关 死状态扫描（软警告）**：调 `[DEAD_STATE_SCANNER] --summary [TEMPLATE_SUMMARY]` 扫 9 类 lexical 死状态 pattern（回调 undefined / 空函数 / console stub / setter never called / write-only state / memo 空数组 / const 空数组被 .map / const 空串走死分支 / 具名处理器空体）。**命中 ≠ fail**：脚本恒 exit 0，命中条目作为 dead-state 类 upstream-gap 由主 Agent 追加进阻塞账本（同既有 upstream-gap 处理），**不**触发 NW-* 重生成——这是 nw-verifier 旧「对抗扫描」维度被砍后的确定性替代（旧对抗维度的根本问题是 LLM adversary + retry ≤ 2 cap 必不收敛，新机制改成"确定性 grep + 软警告 + 人工修"；勿与现 V5「契约对账」judge 维度混淆）。stdout 末尾 `dead-state-scanner-found:<N>` 给主 Agent 提取。
     - **阻塞账本**：5-C 还须在 [LOGIC_SUMMARY] 产出固定的「## 阻塞账本」节——把全部 upstream-gap（含 step5-pending + 第四关 dead-state 命中）逐条登记成累进阻塞账本（每条列 文件 / 符号 / 缺什么 / 欠谁补），账本非空时 step 5 收尾态判 ⚠️ 而非 ✅
   - 限制：① 输入消费 [TECH_FE]、[MANIFEST]、[CODE_BASELINE]、[TEMPLATE_SUMMARY]
   - 限制：② 状态管理 / 接口入口 / 持久化 key 命名严格按 [CODE_BASELINE] 既有约定
   - 限制：③ 不改 [TECH_FE] §4.3 改动清单以外的现有文件
   - 限制：④ 5-B 单次单文件 loop（同 4-B 原因）
   - 限制：⑤ **pageforge 单一职责 = 生码**。typecheck / lint / baseline diff / 静态分析等是项目级 CI / pre-commit 职责，不进 5-C。**注意**：5-C 第二关查的是「import 目标文件是否在磁盘上」（path/file-existence only），不查 export 名 / 类型 / JSX 元素——后者要进 typecheck 才能办，仍排除在 pageforge 边界外。
   - 限制：⑥ 5-B **一律 batch=1**：每个 status=`ok` 的 NW-* 各起一个独立 sub-agent dispatch，主 Agent K 并发槽并行调度（§B.8）。dispatch 前主 Agent 调 [NW_SLICER]（`--step 5`）抽切片，sub-agent 只 Read 切片。每个 NW-* 逻辑填完后立即 dispatch [NW_VERIFIER] 做 **5-B-verify**（V1 §5 逻辑 + V3 PRD 约束 + V4 足迹；V2 仅当 5-B 改了 className 才重做）；verify-failed 处理同 4-B-verify（≤2 次重生成、仍不过标 `verify-failed-giveup`）。状态行由主 Agent 收口（§B.2）。中断按 §B.3/§B.4 续跑。详见 §B.7 / §B.8

   **step 5 收尾态判定（阻塞账本决定 ✅ vs ⚠️）**：5-C postcondition 三关 fail-fast + 第四关软警告通过后，主 Agent 读 [LOGIC_SUMMARY]「## 阻塞账本」节判收尾态——
   - 账本**为空**（0 项 upstream-gap）→ step 5 输出 `✅ 执行 step 5 计划`，pageforge 真·完成。
   - 账本**非空**（N 项 upstream-gap，含 step5-pending + dead-state）→ step 5 **不输出 ✅**，按 §O 输出 `⚠️ 执行 step 5 计划完成，欠 N 项 upstream-gap（未达可运行）`，并把账本 N 条摘要回报用户。
   - **不卡死**：⚠️ 不阻塞 pageforge 收尾、不回滚、不重跑——账本清空（后端补 mutation / 上游定 atom 契约后）由用户重跑 5-C 升级为 ✅。

5.5 **视觉验收 figma-review（step 5 完成 + 5-C postcondition pass 后自动跳）**：主 Agent 跳脚 `/figma-review` skill（项目已存在于 `.claude/skills/figma-review/` 或全局 skill），对所有 `nw_components.status=ok` 的 NW-*.tsx 与 [MANIFEST] 中的 figma_node 做事后对照，产 diff 表落到 `.claude/docs/figma-review-diff.md`。**不修代码**，仅产 diff + 优先级 + 建议改法清单，由用户自行 polish。
   - 触发条件：step2_mode == 2.C 或 2.A 时**默认开**；2.B 模式时 `AskUserQuestion` 让用户选是否跑（轻量模式精度低，跑 figma-review 收益最大）
   - 输入：[MANIFEST] + 所有 status=ok 的 NW-*.tsx 路径
   - 输出：`.claude/docs/figma-review-diff.md`（含每个 NW-* 的 light/dark/PC/mobile 四轨视觉 gap + 文件路径 + 行号 + 建议 className 改法）
   - 失败 fallback：figma-review skill 不存在或执行失败 → 主 Agent 提示用户手动跑 `/figma-review`，不阻塞 pageforge 结束
   - 跳过条件：用户在 AskUserQuestion 选 `跳过` / 或 step 5 产物 ≤ 5 个 NW-*（小范围改造，事后人眼扫即可）

```

## §E 各步预估耗时

各步预估耗时表（排期与瓶颈定位用）详见 [`references/estimates.md`](references/estimates.md)。**排期 / 瓶颈分析时按需 Read，常规流程不必装入主 context。** 实测窗口变化时同步修订该表与 §B.1。

## §Q 各步在三维度下的行为对照

三维度（项目成熟度 / 需求范围 / 复用粒度）对各 step 的敏感度对照表详见 [`references/three-dimension-matrix.md`](references/three-dimension-matrix.md)。**调试 / 澄清判定时按需 Read。**

## §M2 [TEMPLATE_SUMMARY] nw_components 状态表 schema

step 4 page-template-gen 产物 nw_components 表 row schema（6 字段含 verify_status + 模板片段）详见 [`references/nw-components.md`](references/nw-components.md)；权威 JSON Schema 见 [`schemas/nw-components.schema.json`](schemas/nw-components.schema.json)。

## §F Failure 处理

§F1 Failure & confirmation matrix（主 Agent 出错 / 决定要不要问用户时的总览表）+ §F2 partial success 兜底链路 详见 [`references/failure-handling.md`](references/failure-handling.md)。**主 Agent 调度遇错时按需 Read。**

## §B step 4/5 NW-* 的单元调度 / 并行 / 续跑机制

> **lever ① batch=1**：4-B/5-B 不「拆批」——每个 NW-* 是一次独立 sub-agent dispatch，sub-agent 内部不 loop 多个 NW-*。
> **M4 并行化（2026-05-18）**：N 个 NW-* dispatch 不再串行——主 Agent 用 K 并发槽并行调度（§B.2 + §B.8），[TEMPLATE_SUMMARY] 状态表由主 Agent 单一收口。lever ②（切片）③（verify）的接缝见 §B.7。

### §B.0 适用条件

step 4-B（组件骨架）/ 5-B（组件逻辑）**一律 batch=1**：每个 status=`不存在，需新建` 的 NW-* 各起一个独立 sub-agent dispatch。

> **socket 根因（保留，重新定位）**：sub-agent 单条流式连接开太久（> 5 min / 40-58 tool uses）会撞上游空闲超时被中断。batch>1 旧设计里一个 sub-agent 扛 8 个 NW-* ≈ 32 tool uses、贴 40 下界（实战 ~28 个即中断）；**batch=1 后单个 sub-agent ≈ 3-8 tool uses，离下界有 5-10× 余量，socket 中断从常态变罕见**。本节根因段现在解释「为何单 NW-* 安全」，而非「为何要拆批」。
> `.claude/agents/*.md` 在当前会话未注册为 subagent_type（实测 2026-05-18），dispatch 仍走 `general-purpose` 包装；故续跑仍靠「重新 dispatch 新 sub-agent + grep 自盘点」，不依赖 SendMessage。

### §B.1 单 NW-* 成本（b3e7a0c0 transcript 复盘校准 · 2026-05-19）

> Run 3 旧表把「650s」当单次成本，实为 ~50s 真干活 + ~600s 漏收空转（见 §B.6 watchdog 真相）。下表只计**真正干活**耗时（首回合 → 末条 end_turn message）。

| 步骤 | 单 NW-* 真干活耗时 | 说明 |
|---|---|---|
| 4-B 组件骨架 generate | ~7 tool uses / **~1-3.5 min**（b3e7a0c0 中位数 ~50s） | 骨架 Write + 读切片；耗时大头是 opus 推理 |
| 4-B-verify | ~3 tool uses / **~1-2 min** | 只读切片 + 成品 2 文件 |
| 5-B 组件逻辑 generate | ~4-8 tool uses / ~2-4 min（估算，待实测） | 含按 TODO 数的 Edit 往返 |
| 单 NW-* 完整闭环（generate + verify） | **~3-7 min** | 串行算；K 并发槽则 wall-clock ÷ K（§B.8） |

- 上表是收口正常（§B.6 第 4 项 `TaskOutput` 即时收）下的真耗时。**漏收 → 每个 dispatch 额外 +600s 空转**，闭环虚胖到 ~21 min/个、且占着后台 task 配额拖慢全局。
- 实测窗口变化时同步修订本表与 §E，不要在 agent prompt 里写死耗时。

### §B.2 NW-* 间并行调度（主 Agent 单一收口状态表）

主 Agent **并行 dispatch 多个 NW-***（并发度见 §B.8）。原 new0.0.x 的「严格串行」约束 **M4 起废除**——它给的两条串行理由在 batch=1 下都不成立：

1. ~~grep 自盘点竞态~~ → **不成立**：每个 NW-* 的入场自盘点（§B.3）只 `ls`/Read **它自己那一个目标文件**（NW-X 查 NW-X.tsx）。NW-* 间目标文件路径不相交，并行 worker 写各自文件互不影响；自盘点从不扫共享清单，无竞态快照。
2. ~~[TEMPLATE_SUMMARY] 写写冲突~~ → **M4 消除**：generate sub-agent **不再自己写 [TEMPLATE_SUMMARY]**，只产出自己的 .tsx + 在 return 里带回行数据（nw_id / path / status / is_client / failure_reason）。**[TEMPLATE_SUMMARY] 的唯一 producer = 主 Agent**：主 Agent 在每个 NW-* 闭环 return 后串行回写状态表一行（含 verify 后的 verify_status）。单 producer ⇒ 无并发写。

**主 Agent 职责（M4 新增）**：
- dispatch 4-B 前，主 Agent **调 `node [PAGEFORGE_PREP] init-summary --manifest [MANIFEST] --out [TEMPLATE_SUMMARY] --project-root <root>` 生成 [TEMPLATE_SUMMARY] 骨架**（主题 A：脚本从 manifest 自动产正确列序 + 绝对 path，主 Agent **不手写**——手写曾踩坑列错被 schema-validator 拒）；各 NW-* 4-B 返回后主 Agent 单一收口回填 status/is_client（§B.2）。5-B 同理在 5-A 后确认 [LOGIC_SUMMARY] 骨架就位。
- 每个 NW-* 的 generate + verify 闭环 return 后，主 Agent 解析 return 三段、`Edit` 追加/更新该 NW-* 状态行。
- sub-agent return 三段必须结构化带回行字段（见 `[AGENTS_DIR]page-template-gen.md` / `page-logic-gen.md` 的「单 NW-* 返回格式」）。

### §B.3 单 NW-* 幂等检查（续跑）

每个 NW-* 的 sub-agent prompt 内**必须包含**"先自盘点、再干活"指令：

1. **入场自盘点**：探测本 NW-* 的目标 .tsx 是否已落盘 + 完成：
   - 4-B：文件存在 + 非空骨架 → 视为已产，直接 return `already done`，不重写覆盖。
   - 5-B：文件内已无 `// TODO step5`（或残留数 = 登记的 step5-pending）→ 视为已填，return `already done`。
2. 未完成 → 处理本 NW-*（单文件）。
3. **完成即落盘 .tsx**。状态行**不由 sub-agent 写**——sub-agent 在 return 三段里结构化带回行数据，主 Agent 收口写 [TEMPLATE_SUMMARY]（4-B）/ [LOGIC_SUMMARY]（5-B）（§B.2）。.tsx 落盘后任意点中断，产物已持久化，§B.3 入场自盘点据此续跑。

### §B.4 socket 中断 / verify-failed 后的续跑

1. 某 NW-* 的 sub-agent socket 中断 → 主 Agent **直接 dispatch 同一 NW-* 的新 sub-agent**；§B.3 入场自盘点跳过已落盘部分。
2. lever ③ verify-failed 的定向重生成也走本路径（重 dispatch 同一 NW-*，把修正指令喂回，见 §B.7）。
3. 同一 NW-* ≥ 2 次中断 → 按 §F1 升级，停下问用户。
4. **barrier**：全部 NW-* 各自「生成 + verify 终结（verify-pass 或 verify-failed-giveup）」后，4-B 才进 4-C 收尾 aggregator；5-B 才进 5-C postcondition（5-C 跨全部 status=ok 文件，必须等所有 NW-* 落盘且 verify 终结）。

### §B.5 dispatch 排序守卫（deps）— 并行下按拓扑分层

step 3 起 [MANIFEST] 每个保留的 NW-* **必产**结构化 `deps` 块（`provides` + `consumes`，结构权威定义见 `[SCHEMAS_DIR]component-graph.schema.json`，由 tech-solution-generator §2.3 产出）。dispatch 前调 [DAG_VALIDATOR] 解析 deps 建有向图：拓扑排序得到**分层**——**同层 NW-* 并行**进槽（§B.8），**层间串行**（上一层全部「生成 + verify 终结」后才放下一层）。**检出环 / dangling-dep → fail-fast**：报告、要求 step 3 拆环或补漏（step 3 Postcondition 自检已先拦一道，此处兜底）。

> **分波必须据 `--emit-layers`，禁按编号自分（强制，主题 C）**：step 4-B / 5-B dispatch 前，主 Agent **必须**调 `node [DAG_VALIDATOR] --manifest [MANIFEST] --emit-layers .claude/docs/_layers.json` 拿确定性拓扑分层，**按层分波**（L0 一波 → 全终结 → L1 一波 …）。**严禁主 Agent 自己按 NW 编号顺序分波**——编号分波会把有 render/atom 依赖的父子 NW-* 切进同一波并行（如 NW-015 父 / NW-017 子），二者互不可见对方对共享 prop 契约的改动 → typecheck 漂移（实测踩坑：NW-015 传 `selectedEntry` / NW-017 收 `selectedEntryId`）。`--emit-layers` 输出 owner 在浅层、consumer 在深层，照层分波则父子天然不同波、串行不漂。同层内若仍有 render 父子（罕见），收口后做一次 prop 对账兜底。

> **dag-validator 职责**：找环 + dangling-dep + 拓扑分层（`--emit-layers` 输出 `{layer_count, layers:[[id...]...]}` 供调度）。`--emit-edges` 旧 per-NW-* `edges.json` + nw-slicer `--edges-dir` + B6 切片节体系 2026-05-21 已砍（5-D integration-verifier 同期砍）——注意 `--emit-layers`（轻量分层数组，调度用）与被砍的 `--emit-edges`（重 per-NW 入/出边图）不是一回事。组件依赖契约由 切片 B5 sibling 目录 + manifest `deps` 块（让 sub-agent 自己 grep）承载。

> **owner 形状变更 → 消费方失效传播（强制，防部分重跑漂移）**：若某 NW-* 是契约 owner（在 §5.5 / `deps.provides` 里 provides atom/type/enum），而本轮**改了它的形状**（增删字段 / 改 enum / 改类型），主 Agent **必须把所有 consume 该 owner 的 NW-* 一并标记重生成**（按 §B.5 分层：owner 在上层、消费方在下层，owner 重生成后其整条下游子树失效）。**只重生成 owner 自己、不重生成消费方 = 消费方仍按旧形状写 → typecheck 炸 / 字段漂移**（实测：改 NW-016 的 WorldCardEntry 形状后，未重跑的 sibling EntryFormFields 仍写旧 `title/content/imageUrl`）。**部分重跑/续跑**（只跑某簇）时尤其要显式列出"因 owner X 形状变更而连带失效"的消费方清单，要么一并跑、要么明确标为已知漂移待后续对齐。

### §B.6 dispatch 模板强制项（主 Agent 强制）

batch=1 把 dispatch 数从 ~7 推到 N（52 量级），叠加 §B.7 verify 重试最坏到 200+。每次 dispatch **必须**满足以下 4 项——**漏 1/2/3 项 = 跑错模型或撑爆 context；漏第 4 项 = 该 NW-* 干完后空转 600s 才被 watchdog 强杀**：

1. **挂完成信号补丁**：prompt 末尾追加 `[AGENTS_DIR]_common/streaming-safety.md` §"主 Agent 调度补丁"的「完成后立刻 STOP」文字（`.claude/agents/*.md` 未注册 subagent_type、走 general-purpose 包装、无专名 agent 退出语义）。
2. **传 model**：读被调 agent frontmatter 的 `model:`，作为 Agent 工具 `model` 参数显式传入（见 §V）。
3. **传切片**：4-B/5-B/verify 的 sub-agent prompt 只给 `NW-xxx.slice.md` 路径，不灌整份 [TECH_FE]/[MANIFEST]（见 §B.7）。
4. **后台起、即时收**：dispatch 时传 `run_in_background: true`（§B.8 连续补槽要求主 Agent 能对单个完成事件即时反应，必须后台，不能用前台批量调用）；该 dispatch 的**完成 notification 一到，主 Agent 立刻对它调 `TaskOutput` 收结果**，再解析返回三段、回写状态表、空出该槽。**`run_in_background: true` 起了就必须配对一次 `TaskOutput`**——不收 = task 留在「已完成待回收」池里空转，撞 600s watchdog 才被强杀（b3e7a0c0 实测 104 个里 93 个漏收，累计空转 15.5h）。

> **固化要求（强制，非「记得做」）**：主 Agent 必须用一个**固定 dispatch 模板**拼每次 prompt，并在 dispatch 前**自检 prompt 末尾确含「完成后立刻 STOP」串、确含 slice 路径、Agent 调用确带 model 参数与 `run_in_background: true`**；同时维护一张「已 dispatch · 未 `TaskOutput`」台账，每条完成 notification 进来即收、即销账。dispatch 数 ×N 后漏挂/漏收的期望损失线性放大，不容凭记性。

> **watchdog 真相与单 NW-* 耗时（Run 3 复盘修正，2026-05-19）**：Run 3 曾测得单个 opus dispatch wall-clock **620-650s**，据此判定「>600s 属正常、无法切薄」——**这个判定是错的**。复盘 b3e7a0c0 全部 104 个 sub-agent transcript：单 dispatch **真正干活（首回合 → 末条 end_turn message）中位数仅 ~50s**，其后是一段**精确 600s、零 tool / 零 token / 零生成的空转**，再被记一条 `[Request interrupted by user]`。即 650s ≈ ~50s 干活 + ~600s 空转。
> 空转的成因**不是** sub-agent「跑完沉默」（「完成后立刻 STOP」补丁已让它正常 end_turn return），而是 **`run_in_background` 起的 task 完成后没人 `TaskOutput` 收**——harness 对「已完成但未回收」的后台 task 有 600s 回收上限，到点强杀。b3e7a0c0 实测 104 个 sub-agent 中 93 个（89%）撞此模式，累计空转 15.5h。
> **修复 = §B.6 第 4 项**：每个后台 dispatch 完成 notification 一到立刻 `TaskOutput` 收。收了，task 在 ~50s 即回收、槽即时空出，600s watchdog 根本不触发。**故：单 NW-* dispatch 正常耗时 ≈ 50-220s；transcript 里看到 ~650s = 漏收，不是「正常」。** 真正的 stall 信号仍是「task notification 明确 status=failed 且 `<result>` 为空」。
>
> **3min 主动探活（真挂起兜底，2026-05-21 P0④）**：上面治的是「漏收」（notification 已到、没收）。还有一类极少但会卡死的：**notification 永不到达**——sub-agent 真挂在某步（死循环 / 等一个永不返回的调用），主 Agent 被动等 notification 等不到、又不像漏收那样有 task 在「待回收池」可被 600s 兜底。**故主 Agent 维护每个 in-flight dispatch 的起跑时刻，对任一「已超 ~3min 仍无完成 notification」的 dispatch 主动调一次 `TaskOutput` 探活**：① 有新增 streaming 输出（仍在生成）→ 判活、继续等；② 连续两次探活（间隔 ≥1min）输出零增长、或返回明确 status=failed → 判真挂起，`TaskStop` 杀掉 + 按 §B.3/§B.4 单 NW-* 幂等续跑重 dispatch（计入 §B.7 ≤2 重试上限）。**3min 阈值 < 600s harness 回收上限**，把真挂起的最坏检出延迟从「等到 600s 强杀甚至无限等」压到 ~3-4min。注意：探活只用于「无 notification」的 in-flight task；已收到 notification 的一律走第 4 项即时 `TaskOutput`，不重复探活。

### §B.7 三 lever 接缝约定（batch=1 / 切片 / verify）

4-B/5-B 的执行单元统一为「一个 NW-*」，`NW-* id` 是贯穿三 lever 的唯一主键。主 Agent 用 K 并发槽并行跑（§B.8），每个槽内一个 NW-* 的闭环如下（**槽内串行、槽间并行**）：

```
每个并发槽 · 一个 NW-*（按 §B.5 分层，§B.8 补槽）：
  ② nw-slicer.mjs 抽 NW-xxx.slice.md（进槽前；已存在且 [TECH_FE] 未变则复用）
  ① dispatch 生成 sub-agent（run_in_background:true），只喂该切片 + 上轮 verify cache（若存在） → 生成 NW-xxx.tsx
     完成 notification 到 → 立刻 TaskOutput 收 → 解析 return 行数据
  ③ dispatch nw-verifier（run_in_background:true），喂【同一份切片】+ 成品 + verify_cache 路径 → verify
     完成 notification 到 → 立刻 TaskOutput 收 → 解析 verify 结果
     ├─ verify-pass → 闭环终结，主 Agent 回写 nw_components 行 verify_status=verified
     └─ verify-failed → 主 Agent Read [VERIFY_CACHE]<NW-id>.json 末轮 fail_items + remediation
                        把"上轮被打回的具体行 + remediation"注入重生成 prompt
                        重 dispatch 生成（≤2 次，每次同样「起完即收」）
                        下一轮 verify 优先核对"上轮 fail 是否已修"（Reflexion 模式，§nw-verifier）
                        仍不过 → verify_status=verify-failed-giveup + 登记复跑入口
  闭环终结（① ③ 两个 dispatch 都已 TaskOutput 收掉）→ 该槽空出，主 Agent 立即补下一个 NW-* 进槽
```

- **dispatch 单元 = 切片单元 = verify 单元 = 一个 NW-* id**。
- slice（`[SLICE_DIR]NW-xxx.slice.md`）是「生成」与「verify」的共享真相源——抽一次、用两次、零漂移。
- verify_cache（`[VERIFY_CACHE]<NW-id>.json`）是「重生成」与「下一轮 verify」的共享 memory ——上轮 fail_items 喂回、下一轮 verifier 优先核对已修而非翻新挑剌。Reflexion 模式治 verify-fix 不收敛根因。
- verify 子阶段（4-B-verify / 5-B-verify）细节见 §P step 4 / step 5 与 `[AGENTS_DIR]nw-verifier.md`；切片脚本契约见 `[NW_SLICER]` 与 `schemas/nw-slice.schema.json`。
- status=`内联重写` 的 NW-* 不进本循环（§4 限制⑦）；status=`skeleton-failed` 的 NW-* 其 verify_status 记 `skipped`。

### §B.8 并发槽补槽调度（continuous batching）

主 Agent 用「K 并发槽」并行跑 4-B/5-B 的 N 个 NW-*：

- **K（并发度）**：默认 **K=4**；上游并发额度宽松时实测上调（K=6/8）。K 是 wall-clock 的直接除数——单 step 全量耗时 ≈ NW-* 数 × 单 NW-* 闭环 ÷ K。
- **补槽而非分批**（借鉴 vLLM continuous batching）：**不**「凑满 K 个发一批、等最慢的全回来再发下一批」。维持 K 个槽常满——任一槽的 NW-* 闭环（generate + verify + 可能的重生成）终结、该槽空出，主 Agent **立即**从待办队列取下一个 NW-* 进槽。槽的「空出」以**该 NW-* 收尾 dispatch 的 `TaskOutput` 已收**为准（§B.6 第 4 项），不是「notification 到了」为准——收掉才算真终结、task 才被回收。
- **进槽前现切**：slice 是 <1s 的本地脚本（[NW_SLICER]），补槽时即时切，不预切、不缓存队列。
- **槽内串行、槽间并行**：一个 NW-* 的 generate→verify 在同一槽内串行（verify 依赖 generate 产物）；不同槽的 NW-* 完全并行。并行靠 `run_in_background: true` dispatch + 完成 notification 驱动——主 Agent 起完不阻塞，转去管别的槽；哪个 dispatch 的 notification 先到就先 `TaskOutput` 收哪个、即时补该槽。**不要用「单条消息发多个前台 Agent 调用」**——前台会阻塞到这一批全回来，做不到「任一槽一空就立刻补」的连续补槽，且与本节设计冲突。
- **状态收口**：每个闭环 return 后，主 Agent 串行 `Edit` [TEMPLATE_SUMMARY]/[LOGIC_SUMMARY] 写该行（§B.2）——主 Agent 自己的写天然串行，无并发问题。
- **barrier（§B.4 不变）**：全部 NW-* 闭环终结后，4-B 才进 4-C；5-B 才进 5-C。
- **deps**：§B.5 分层时，K 槽只在「当前层」的 NW-* 间补；当前层清空才放下一层。

### §B.9 项目规模自适应档位

重机制对小项目是空转成本（一轮通过率高、context 不爆）。主 Agent 在 step 3 manifest 定稿后按 **NW-* 总数 N** 选档，统一调以下开关（避免散落各处各判一次）：

- **小项目（N < 10）**：① [VERIFY_CACHE] Reflexion 跨轮 memory **默认关**（cache 空跑无价值，verify 仍照跑只是不落 cache）；② step 0.5 PRD scope-narrower 按其自身阈值（>800 行 / >50KB）自然跳过，无需额外干预；③ K 并发槽取默认 4 即可。
- **大项目（N > 20）**：① [VERIFY_CACHE] **必开**（retry 收敛全靠它）；② 上游并发额度宽松时 K 上调 6/8（§B.8）；③ step 0.5 大概率触发，scope 切片 + xref-closure 闭包是刚需。
- **中间档（10 ≤ N ≤ 20）**：默认全开，按实际 verify 失败率决定是否关 cache。

> 档位只控「重机制开关」，不影响 batch=1 / 切片 / 三关 postcondition / dead-state 软警告 / V1~V5 核对——这些是规模无关的正确性底线，任何规模都跑。
