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
- [DAG_VALIDATOR] = '.claude/skills/pageforge/scripts/dag-validator.mjs'  ← NW-* 组件依赖环检测；[MANIFEST] 出现 `- **deps**: [NW-XXX, ...]` 字段时调用（DFS 三色标记找环 + 修复建议；零 deps 字段时自动 pass 向后兼容；可选 `--json` 输出）
- [SCHEMAS_DIR] = '.claude/skills/pageforge/schemas/'  ← 跨 agent 受控枚举/字段约束的 single source of truth（JSON Schema Draft-07 静态文件；schema-validator.mjs 启动时加载；sub-agent prompt 可引用文件路径。详见 `schemas/README.md`）

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
- 计划严格按照指定顺序执行，等当一个计划执行完毕，**必须让用户确认执行是否完成**。未完成不能自动执行下一阶段计划。
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

## §P 计划模板（7 步：0 / 0.5 / 1-5）

```markdown
0. **项目盘点 + PRD/API 原料采集**（双 agent 并行调度 — fan-out + barrier sync）：
   主 Agent 在**一条消息**里同时发出两个 Task() 调用，启动两个独立 sub-agent 在各自 context 里**真并行**跑（fan-out）；等两者都返回摘要后才进入 step 1（barrier sync）。两个 agent **input 互不依赖**（A 读项目代码，B 读 PRD/API 原料），但 step 1 的输入**同时依赖** A 和 B 的输出，因此 barrier 必须 sync。

   **Failure semantics & 重试策略**：详见 §F1（统一矩阵）。

   **A. project-baseliner agent** → [CODE_BASELINE]（项目字典）
   - 跑/不跑：① 有 `package.json` 或常见前端项目标志（`src/` / `app/` / `pages/` / `pubspec.yaml` 等）→ 必跑；② 全新空仓 → 跳过（写空字典占位）
   - 输出字段（9 大类 × 三态：`present` / `absent` / `partial`）：
     - **M1 项目元信息**（必有）：framework / language / package_manager / monorepo
     - **M2 目录约定**（必有）：source_root / rules_root（按候选路径列表探测，不写死特定项目目录）
     - **M3 设计系统资产**（可选）：tokens 来源文件 / 颜色字体 spacing 命名空间；缺标 `no design system`
     - **M4 组件库索引**（可选）：按语义标签清单（tooltip / toast / modal / button / ... 默认清单可扩展）grep；某语义 0 命中标 `needs creation`
     - **M5 状态管理资产**（可选）：state lib 类型 / 全局 store 列表 / 持久化 key；缺标 `no state management`
     - **M6 接口资产**（可选）：RPC 风格 / 入口路径 / 已有 namespace；缺标 `no api layer`
     - **M7 i18n 资产**（可选）：库类型 / locale 文件；**key 命名规则仅引用项目自带规则文档路径，不假设规则内容**；缺标 `no i18n`
     - **M8 灰度 / AB 资产**（可选）：hook / 函数入口（grep 到才填）；缺标 `no rollout framework`
     - **M9 项目级硬规则**（可选）：按候选路径列表探测（`.claude/rules/*.md` / `docs/conventions/*.md` / `CONVENTIONS.md` / `CONTRIBUTING.md` ...）；0 命中标 `no explicit rules`
   - 限制：① 仅产文档，不改任何业务代码 ② 不在 spec 里 hardcode 任何项目特定规则文字（如"add-only" / "useGradualRollout"），仅记录探测到的事实 ③ baseline 文件期望 commit 进项目，主分支为合作演进快照；新分支基于继承的 manifest 做文件级（size+content_hash）增量探测，仅重扫变化字段

   **B. prd-api-fetcher agent** → [ORIGIN_PRD] + [API]
   - 限制：不消费 [CODE_BASELINE] 与 [CLARIFY_FE]

0.5 **PRD scope-narrower（P0 防 context 爆炸）**：主 Agent 自己执行，**不调度 sub-agent**。

   **触发条件（任一命中即必须执行）**：
   - [ORIGIN_PRD] 行数 > **800 行**
   - [ORIGIN_PRD] 文件大小 > **50KB**
   - 用户在启动 pageforge 时已明确切片意图（如"只跑创建流程 / 只跑 ch8 / 只针对 X 页面"）

   **执行流程**：
   1. 主 Agent 用 Bash `wc -l [ORIGIN_PRD]` + `stat` 检测行数 / 大小（或 `awk 'END{print NR}'`）
   2. 若超阈值，**必须暂停**向用户索要 scope（用 AskUserQuestion 工具列候选切片或 "全量跑"）；用户答完才继续
   3. 若用户选了部分章节 / 部分页面：
      - 主 Agent 在 [ORIGIN_PRD] 顶部**插入** "## ⚠️ 本次 pageforge 范围" 章节，列出 In Scope / Out of Scope 章节号
      - 主 Agent 同时复制 [ORIGIN_PRD] 的对应章节内容生成 [ORIGIN_PRD_SCOPED] = `.claude/docs/origin-prd-scoped.md`
      - **下游 step 1+ 全部读 [ORIGIN_PRD_SCOPED] 而非 [ORIGIN_PRD]**（在 step 1/2/3 sub-agent prompt 里显式指明输入路径）
   4. 若用户选 "全量跑" 或 PRD 未超阈值：跳过本步骤，下游 step 1+ 直接读 [ORIGIN_PRD]

   **Failure semantics & 人工确认时机**：详见 §F1（统一矩阵）。

1. **澄清文档生成**：调用 `prd-clarifier` 子 Agent 生成澄清文档（无需接口文档输入），并保存到 [CLARIFY_FE] 中。生产完毕后需要等待用户回答待澄清问题，回答完毕才能继续执行下一步。

   - **输入路径选择**：
     - [ORIGIN_PRD_SCOPED] 存在 → sub-agent prompt 必须指明 "读 [ORIGIN_PRD_SCOPED]"
     - 不存在 → 读 [ORIGIN_PRD]（PRD 未超阈值，跳过了 0.5）
   - 限制：① 输入消费 [ORIGIN_PRD]、[CODE_BASELINE]
   - 限制：② §11/§12/§13（现有代码定位 / 复用清单 / 影响面）由 [CODE_BASELINE] 直接填，不再占位
   - 限制：③ §14 项目级澄清默认值的 **canonical store = [CLARIFY_FE] §14 自身**（跨 PRD 持续累积的项目偏好缓存）；prd-clarifier 在收到用户新答复后**直接追加**到本 §14，不需要从 [CODE_BASELINE] 同步。[CODE_BASELINE] M9 是规则文件路径索引（与本节内容不同），不要混淆
   - 限制：④ prd-clarifier 返回后，主 Agent **必须按 `agents/prd-clarifier.md` 中「主 Agent 接管指令模板」7 步执行**（§9 逐条问 / §10 confirm-or-veto / §11~§13 baseline 已填 / 收答回写 / 文档头标"已完成" / §14 抽取项目级默认 / 7 步未完不得调度 step 2）

2. **视觉分析**：调用 `visual-analyzer` 子 Agent 进行视觉分析。如果没有提供设计稿链接，必须先询问用户提供设计稿链接。
   - 限制：① 输入消费 [CLARIFY_FE]、[CODE_BASELINE]，不消费 [ORIGIN_PRD] 和 [API]
   - 限制:② 产物目录必须在 [FIG_META]
   - 限制：③ 数据源 MCP 优先 `mcp__figma__`，fallback `mcp__figma-desktop__`（遵循项目 `.claude/rules/figma-mcp.md`）；2.B brownfield 仅拉 NW-\* 节点，不做全量 IoU
   - 限制：④ 必须产出 [MANIFEST]（每个 NW-\*/RU-\* 组件的 status + design_tokens + placement，替代旧 BROWNFIELD_MAPPING）
   - 限制：⑤ IoU 视觉匹配（components.json / match_data.pkl / matched-visualization.png）按需，纯改造场景可跳
   - 必须等待该计划执行完毕才能继续下一步

3. **技术方案生成 + 实现层探测**：调用 `tech-solution-generator` 子 Agent（两阶段）：Phase 1 生成 tech-fe.md §1~§9 Q-T\* 列表（**brownfield / mixed-brownfield 强制做 step 2.1 Footprint Extract**：先调 [FOOTPRINT_EXTRACTOR] 脚本对被改文件做六类结构化提取，输出 `[FIG_META]/footprint.json`；LLM 读 JSON 直接填 §4.0，不再自由扫源码；删除任何足迹必须在 §4.6 登记 [CLARIFY_FE] 授权依据，未登记的足迹新代码必须保留）；Phase 2 在同一 context 对 §9 做 grep 探测并更新 [MANIFEST] status。等待其执行完成后再继续下一步。
   - 限制：① 输入消费 [CLARIFY_FE]、[API]、[MANIFEST]、[CODE_BASELINE]
   - 限制：② 业务知识库来自 [CODE_BASELINE]（不读旧 MARTIAL / LOGIC_MARTIAL）
   - 限制：③ §4.0 Footprint Extract **必须**先调 [FOOTPRINT_EXTRACTOR] 脚本，再 LLM 读 footprint.json 填表；脚本调用失败 → fail-fast，禁止退化为 LLM 自由扫源码（除非 [CODE_BASELINE] 显式标 `footprint_script_disabled: true`）

4. **页面模板 + 组件骨架生成**：调用 `page-template-gen` 子 Agent，按 [TECH_FE] §4 三阶段产出 page.tsx + 所有 status=`不存在，需新建` 的 NW-* 骨架文件，并在收尾子步骤把 page.tsx 装配为可直接渲染的 JSX。**注：内部三阶段（4-A/4-B/4-C）是时间阶段；mode 分支（brownfield / greenfield / mixed）是横向分支，由 page-template-gen 内部按 [TECH_FE] frontmatter `模式:` 字段决定，正交于阶段层。**
   - **4-A page-skeleton**：page.tsx 顶层骨架（结构 / token / 顶层 import）+ 对每个 status=`不存在，需新建` 的 NW-* 在 page.tsx 留 `<div data-placeholder="X" />` 锚点
   - **4-B component-skeleton**：对每个 status=`不存在，需新建` 的 NW-*，**按 NW-* loop 单次单文件**生成 NW-name.tsx 骨架（结构 + design token → Tailwind + import 路径 + props 类型 + 'use client' 4 条件判定）；判定结果与产出状态写入 [TEMPLATE_SUMMARY] 的 `nw_components 状态表`（含 nw_id / path / status=`ok`/`skeleton-failed` / is_client / failure_reason 字段，schema 见下文）
   - **4-C 收尾 aggregator**：(a) 对 nw_components.status=`ok` 的，把 page.tsx 里 `<div data-placeholder="X" />` 替换为 `<X />` + 在 import 块末尾加 import；status=`skeleton-failed` 的保留 placeholder div 不替换 (b) OR 聚合所有 status=`ok` 的 NW-* `is_client` → 改 page.tsx 顶部 'use client' 指令（任一子组件 client → page client；仅 RSC 项目适用）
   - **partial success fallback**：4-B 单个 NW-* 失败 → 不抛主流程，自动产 placeholder div + TODO 注释 + 写 nw_components.status=`skeleton-failed` + failure_reason；后续 step 5-B 自动跳过该 NW-*，[LOGIC_SUMMARY] 末尾记复跑入口
   - 限制：① 输入消费 [TECH_FE]、[MANIFEST]、[CODE_BASELINE]
   - 限制：② mode 分支（brownfield / greenfield / mixed）由 [TECH_FE] frontmatter `模式:` 字段决定（mode single source of truth）
   - 限制：③ 背景图片走 `get-background-img` 技能获取
   - 限制：④ 4-B 单次单文件 loop，**禁止单次产多个 NW-***（避免 token 爆且利于 partial success 隔离）
   - 限制：⑤ greenfield 子页面 4-A 必须使用 `m0-template-gen`

5. **页面 + 组件逻辑填充**：调用 `page-logic-gen` 子 Agent 把 step 4 留下的 `// TODO step5` 占位填实，5-C 仅做生码自身完整性校验。
   - **5-A page-logic**：对 page.tsx 填顶层状态机 / hooks / 子组件 props 传递
   - **5-B component-logic**：对 [TEMPLATE_SUMMARY] nw_components.status=`ok` 的每个 NW-*.tsx，**按 NW-* loop 单次单文件**填业务逻辑（hooks / event / state）；status=`skeleton-failed` 的整组跳过，[LOGIC_SUMMARY] 登记复跑入口
   - **5-C postcondition**：`grep -c "TODO step5"` 跨 page.tsx + 所有 status=`ok` 的 NW-*.tsx，残留计数必须 = 已登记 step5-pending + C 类 + upstream-gap 之和；不等 → fail-fast
   - 限制：① 输入消费 [TECH_FE]、[MANIFEST]、[CODE_BASELINE]、[TEMPLATE_SUMMARY]
   - 限制：② 状态管理 / 接口入口 / 持久化 key 命名严格按 [CODE_BASELINE] 既有约定
   - 限制：③ 不改 [TECH_FE] §4.3 改动清单以外的现有文件
   - 限制：④ 5-B 单次单文件 loop（同 4-B 原因）
   - 限制：⑤ **pageforge 单一职责 = 生码**。typecheck / lint / baseline diff / 静态分析等是项目级 CI / pre-commit 职责，不进 5-C

```

## §Q 各步在三维度下的行为对照

三维度（项目成熟度 / 需求范围 / 复用粒度）对各 step 的敏感度对照表详见 [`references/three-dimension-matrix.md`](references/three-dimension-matrix.md)。**调试 / 澄清判定时按需 Read。**

## §M2 [TEMPLATE_SUMMARY] nw_components 状态表 schema

step 4 page-template-gen 产物 nw_components 表 row schema（5 字段 + 模板片段）详见 [`references/nw-components.md`](references/nw-components.md)；权威 JSON Schema 见 [`schemas/nw-components.schema.json`](schemas/nw-components.schema.json)。

## §F Failure 处理

§F1 Failure & confirmation matrix（主 Agent 出错 / 决定要不要问用户时的总览表）+ §F2 partial success 兜底链路 详见 [`references/failure-handling.md`](references/failure-handling.md)。**主 Agent 调度遇错时按需 Read。**
