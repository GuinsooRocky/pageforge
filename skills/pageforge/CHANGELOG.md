# pageforge CHANGELOG

> SKILL.md / agents 的现状描述里只留「为什么这么做」的当下原因；历史动因（哪轮 fresh run 失败、为什么加上某机制、又为什么砍掉）放这里。

---

## 2026-05-21 · fresh-run #2 实战暴露的 7 摩擦 → 4 主题架构收敛（非 7 补丁）

**怎么发现的**：从 step0 全量重跑世界卡 PRD（结果 ~60-62/100，vs v2 45），过程中 7 处摩擦全是**本次 run 自身**暴露的（脚本 fail-fast / 崩溃事件 / agent 自检 / 产物 grep），非看 world 分支。修复时**刻意按结构性根因归 4 主题、不逐条打补丁**（防屎山）：

**主题 A — 产出↔解析格式漂移（覆盖：manifest header 反 / template-summary 列错 / status 语义）**
- 根因：多处「agent 手写产出 → 脚本严格解析」接缝靠双方记得对齐，必漂。
- 收敛：**新增 `pageforge-prep.mjs` 产出规范化层**（`normalize-manifest` 把 `## NW-001 name` 统一成 `## N name（NW-001）`；`init-summary` 从 manifest 自动生成 template-summary 骨架，主 Agent 不手写）。step2 后置 normalize、step4 前 init-summary。**不在 nw-slicer/dag 各加容错正则**（那才是累加）。

**主题 B — 标记生命周期混乱（覆盖：建议再拆不清 / F2-P9 冲突）**
- 根因：标记杂（建议再拆 / TODO-* / figma-token-missing…），产生→消解→识别无统一语义。
- 收敛为**两类语义**：① 待决标记（建议再拆）= 某 step **必须消解**否则守卫 fail → tech-solution-generator 步骤 5.5 强制消解；② 欠债标记（TODO-*）= 允许残留、入账本、扫描器**豁免**。dead-state **P9 改在 raw 源判定**：带 TODO 注释体的延期 handler 自动豁免（已被 5-C 第一关计入、不重复报），只命中**裸空体无标记**。F2 措辞改对（"带 TODO 注释体 = 诚实欠债 + P9 豁免"）。

**主题 C — 调度缺确定性数据源（覆盖：同波父子契约漂移）**
- 根因：§B.5 说按拓扑分层分波，但 dag-validator 不输出分层 → 主 Agent 按编号瞎分波 → 父子（NW-015/017）切进同波并行、互不可见、prop 漂移。
- 收敛：**dag-validator 加 `--emit-layers`**（输出 `{layer_count, layers}`，owner 浅层/consumer 深层）；§B.5 改成**主 Agent 必须据 `--emit-layers` 分波、禁按编号自分**。实测世界卡 5 层：NW-017 在 L2 / NW-015 在 L3 → 照层分波天然不同波、不漂。注意 `--emit-layers`（轻量分层）≠ 已砍的 `--emit-edges`（重 per-NW 边图）。

**主题 D — 大文档 IO 不安全（覆盖：PRD/clarify fetch socket 崩）**
- 根因：单次拉大飞书文档全文 → ~270s 超时崩（实测连崩 4 次，分块 Write 救了内容但 fetch 本身反复崩）。
- 收敛：**streaming-safety.md 加「大文档读取：分页拉 + 即写」段**（与既有「分块写」对称合一处）；origin-prd-gen 拉取步骤 + prd-clarifier 引用同一处，不各写。

**净变化**：加 1 新脚本（pageforge-prep）+ dag 加 1 个轻量 flag（--emit-layers）；其余全是**改既有 / 收敛 / 删散落容错**。7 摩擦 → 4 结构收敛，无新增第三套并行机制。

---

## 2026-05-21 · 半量实测验证 P0②（Stage 1/2）+ 实测回灌 F1-F6

**怎么验的**：复用 step 0-2 旧产物、从 step 3 重跑（隔离变量：只换 step3-5 新 spec），跑写回簇 6 个组件（NW-016 owner + NW-004/007/020 消费方）+ nw-verifier V5。

**验证结论（P0② 端到端成立）**：
- step 3 可靠产出 §5.5 契约表（11 行、enum、写回义务）→ nw-slicer 注入 B9 → 生成 sub-agent 据 B9 写对 → nw-verifier V5 判 `verify-pass`。事前注入 + 事后核对闭环走通。
- v2 两个真 bug 在真实代码上被修：NW-004 ImportWorldModal 从「229 行零写回」→ writeBackDraft 写回 7 字段；NW-016 store `visibility:'public'` 字面量 → proto enum + 补 publishStatus/pendingNoteOps；NW-020 visibility 分流字面量 → enum，并揪出 v2 凭空发明的 `e.status` 幽灵字段。
- 草稿 vs 已发布多态（v2 漏判根因）被 step 3 §5 多态识别 + FSM 承接捕获（NW-005/006/007/008/011/020 全写 discriminator）。
- P0① 新 P9（handler-noop）实测抓到 `handleSaveAll = () => {}` 裸空体。

**实测挖出的问题 → 本轮全修（F1-F6）**：

- **F1（核心）§5.5 enum 数值不该让 LLM 手写**：step 3 手抄 proto 数值**全抄错**（`Visibility.PRIVATE` 写 `=1` 实为 `=2`、`NoteType.CHARACTERS=0` 实为 `=1`、`CharacterGender` 实为 `WorldCardCharacterGender`）——等于亲手造它要防的 #3。靠"回 proto 找真值"纵深防御救场。**改**：§5.5/B9 enum 形状只写 **proto 源路径 + 成员名、严禁数值**；消费方一律 import proto 成员；nw-verifier V5 enum 口径改为「核是否 import proto（非字面量/非手编数值）+ 成员语义对」，**不拿 B9 数值判对错**。全链路改：tech-fe-schema / tech-solution-generator §2.4 / nw-slicer B9 渲染 / nw-verifier V5 / page-logic-gen + page-template-gen。
- **F2** deferred handler 必须留 `() => { /* TODO step5-pending */ }` 注释体，禁裸 `() => {}`（否则被 P9 误判 + 看不出是延期还是漏写）。改 page-logic-gen。
- **F3** §5.5 非字段型 atom（boolean/计数器）写回义务写动作语义；nw-slicer B9 渲染区分「写回字段」vs「执行动作」（防 `必须写回字段 true(改动时)` 这种别扭文案）。改 tech-fe-schema / nw-slicer。
- **F4** owner 形状变更失效传播：改了某 owner 的 §5.5/deps.provides 形状 → 所有消费方 NW-* 必须连带重生成（实测：改 NW-016 形状后未重跑的 sibling EntryFormFields 仍写旧 `title/content/imageUrl` → typecheck 炸）。部分重跑要显式列连带失效清单。改 SKILL.md §B.5。
- **F5** nw-verifier 写 cache 的 greenfield/brownfield 口径以切片 B3 为准、不自判（曾 cache 写 greenfield 但 B3 实为 brownfield）。改 nw-verifier。
- **F6** B9 写回义务落点判定：写回落在真正拿到数据处（hook 解析成功分支），纯展示组件别塞无源 `useSetAtom`（= B8 死接线）。实测 NW-004 写回正确落 useWorldImport hook、modal 不动。改 page-logic-gen。

**没给精确分数**：这是写回簇半量实测（非全量 21 + 深度打分），证明的是「拖垮 v2 的 #3/#4 bug 类被新机制确定性修复并过 V5」，比一个数字更硬。精确 45→? 待全量 Stage 3。

---

## 2026-05-21 · P0 真涨分四条 + 配套清理收尾

**配套清理（上一轮欠债，全清）**：

- **修了一个真 bug**：`nw-slicer.mjs` 的 `manifestConsumes()`（B7 import 白名单来源 1）一遇到组件内 `### design_tokens` 子 header 就 `break`，永远到不了 `### e_probe` 之后的 `deps.consumes` 块 → **B7 来源 1 全程为空，防幽灵 import 白名单等于失效**。把 break 边界从「任意 `#` header」收紧为「下一个顶层 `## ` 组件 header」后修复（NW-008 现正确读出 consumes NW-009/010/016）。
- 物理删 `nw-slicer.componentGraphEdges`（76 行孤儿函数）+ `edgesDir` ctx 残留；`dag-validator.emitEdges` 函数 + `--emit-edges` 全链路 + 孤儿 `path` import；component-graph / nw-slice schema + README + tech-solution-generator / page-template-gen / page-logic-gen 里的 edges/B6 spec drift。`--edges-dir` / `--emit-edges` 参数保留为容忍即忽略（向后兼容旧调用）。

**P0①（dead-state-scanner 第 9 类 pattern）**：

- 加 `handler-noop`：具名处理器空体 `const handleX = () => {}` / `function handleX() {}` / 空 `useCallback(() => {}, [...])`（区别于 P2 的 JSX 内联空回调）。直接命中 v2 真 bug #5（handleSubmit 接好线却 no-op）—— tsc 永远抓不到。
- **没按原路线图砍 P5-P8**：复评后认定 ESLint/gts 默认规则**并不能**替代 P6 write-only state / P7 const 空数组被消费 / P8 const 空串守门——这些需常量传播/数据流分析，砍掉=白丢覆盖且无替代。保留。
- **没加路线图的 P9 hook-return-shape×destructure**：那是跨文件语义，单文件词法不可靠且与 P0② 契约对账重复，归 P0② 处理。

**P0②（跨 NW-* 契约对账，事前注入 + 事后核对）**：

- 收敛了路线图的「新建对账表 + V6（~300 行）」过度设计。复评发现 nw-verifier **V1 早已覆盖 atom 写回检查**（"§5 说写 atom A 但代码只 setLocalState"），真正缺的是**切片没把跨 NW-* 契约的精确形状带进去**。改用 B7/B8 同款「事前注入」：
  - step 3 产 **§5.5 跨 NW-* 契约对账表**（`契约符号 | kind | owner | 形状 | 写回义务`，enum 形状带 proto 数值防 #3，写回义务按 `NW-xxx:字段` 登记防 #4）。
  - nw-slicer 解析 §5.5 → 注入每个 NW-* 切片 **B9 节**（写回义务 / 消费形状 / owner 导出三视角）。生成 sub-agent 据此精确消费、不臆造字段、不写错 enum。
  - nw-verifier 加 **V5 契约对账** judge 维度（据 B9 逐字段对账：写回字段齐全 / 消费形状不臆造 / owner 导出齐全）。
- **命名注意**：旧 V5 是「对抗扫描」维度（2026-05-20 砍，由 dead-state-scanner 替代）；现 V5 = 契约对账，二者无关。dead-state-scanner / SKILL 里旧引用已去 V5 编号。
- 配套：s5Chunks 的 §5 切片 end 边界先于 §5.5 截断（防 §5.5 表格 bleed 进最后一个 NW-* 的 A2）；forbidden-patterns / nw-slice schema 同步 9 类 + B9 节。

**P0③（origin-prd-gen 抓取健壮性）**：

- **URL 预分类 + 解析后确认**：分支 A 加 step 0——按路径段判 URL 类型（docx/sheet/base/slides/wiki），并标 wiki URL 高危（自动解析的底层文档可能 ≠ 字面预期，实测 2026-05-20 wiki 解出「个人页UI优化」而非用户要的「世界卡创建流程」docx）。拉取后先只取标题 + 顶层目录回报用户确认匹配，再全量搬运；不符即停。治「抓错文档」。
- **大文件分块 Write**：长 PRD 禁止一次性大 Write（实测数千行单次 Write 崩 socket / 截断 / 丢 heading）。改先 Write 骨架、再按章节 Edit 逐块追加（≤300 行/块），写完跑第 10 条 heading 自检。治「origin-prd 平文化 / Write 崩」。

**P0④（§B.6 watchdog 3min 主动探活）**：

- 旧 watchdog 真相诊断只覆盖「漏收」（notification 已到没收，600s 回收兜底）与「status=failed」。补第三类：**notification 永不到达的真挂起**——主 Agent 维护 in-flight dispatch 起跑时刻，对超 ~3min 无 notification 的主动 `TaskOutput` 探活：有 streaming 增长判活、连续两次零增长/status=failed 判挂 → `TaskStop` + §B.3/B.4 幂等续跑。把真挂起最坏检出延迟从「600s / 无限等」压到 ~3-4min。

**收尾批 A-D（同日，补 P0 之外的剩余问题）**：

- **A（修真悬空）**：上轮砍 state-extractor 时承诺「FSM/多态识别承接给 prd-clarifier §14 + tech-solution-generator §5」，但 prd-clarifier 那半**从没建**（§14 是 [CLARIFY_FE] 项目默认值存储、不是扫描动作），导致 tech-solution-generator.md:238 引用一个不存在的「prd-clarifier §14 FSM 启发式」。本轮在 prd-clarifier 执行流程**补建 step 3.2 FSM/多态扫描**（扫「状态对照表 / 草稿态 vs 已发布 / A态vs B态 / 状态机」信号 → 命中且 §9 未覆盖就前移成待确认 + 已知 enum/proto 路径登记 §14），并把 tech-solution-generator.md:238 的悬空引用对齐到 step 3.2。根治 v2「草稿/已发布 7 维度被压扁」的上游真空。
- **B（项目规模自适应）**：新增 **§B.9 项目规模档位**——按 NW-* 总数 N 统一控重机制开关（小项目 N<10：verify_cache 默认关 / step 0.5 按自身阈值自跳 / K=4；大项目 N>20：cache 必开 / K 上调）。verify_cache def 的散落 note 改为指向 §B.9 单一真相。proto-enum 锚定一半进 §5.5、一半进 step 3.2。
- **C（roadmap 对齐）**：roadmap 末尾加「实施记录」节，保留原辩论裁定不动，标注 P0① 实际偏离（保留 P1-P8 + 只加 handler-noop=9 类，hook-return 移 V5）+ P0② 收敛实现 + 理由。
- **D（pending 销账）**：pending.md「G 状态归属 wire 验证」「F 关键常量校验」标记被 P0② V5 + step 3.2 覆盖，划掉。

**整体方法论**：这一轮严守 2026-05-20/21 减法教训——P0① 拒绝砍掉 ESLint 不能替代的 P5-P8、拒绝加重复 P0② 的脆弱词法 P9；P0② 把路线图的「新建表 + V6 ~300 行」收敛成复用 deps/slice/verifier 既有基建的「§5.5 表 + B9 注入 + V5 维度」事前注入方案。涨分靠事前注入精确契约（B7/B8 验证有效的路子），不靠事后 opus 反复挑刺。

---

## 2026-05-21 · 第二波减法：砍 5-D integration-verifier + step 2.5 state-extractor

**砍了什么**：

1. **5-D integration-verifier 整套**（spec ~25 行 + 1 agent 文件 + EDGES_DIR / --emit-edges / nw-slicer --edges-dir / 切片 B6 节 整链路）
2. **step 2.5 state-extractor 独立 sub-agent**（spec ~8 行 + 1 agent + state-matrix.schema.json + state-matrix.md 产物 + tech-solution-generator 步骤 4.0 第 ④ 信号）
3. **dag-validator `--emit-edges` 子模式**（无下游消费方）

**根因**（v2 评分 45/100 + 三方 opus 辩论 2026-05-21）：

- **Agent B 三方共识**：5-D 实测信号 ≈ 0（CHANGELOG 2026-05-20 已自承"verdict=pass / 0 broken 但实际 5 处 import 硬崩"），v2 揭露的 5 类真 bug（tsc / trigger mode 三态 / 分类 fake / Rating 不持久 / NameWorldModal no-op）**没一条是 4 类边能抓的** —— 跨组件接线断裂物理不存在，全是 NW 内部 props/atom 写回逻辑
- **state-extractor**：opus dispatch ≈ 50-220s 成本，本轮跑出 5 SM 后下游 tech-solution-generator step 3 第 ④ 信号 + nw-slicer A9 节注入的实际效果**未在 v2 上观察到**（草稿/已发布 7 维度仍然有 4 维度被压扁）；学术依据 SpecGPT FSM extraction 场景是协议 / 电路 FSM，不是 web 业务的 boolean discriminator
- **设计教训**：CHANGELOG 2026-05-20 自己已说「对抗扫描应该用确定性脚本，不是让 opus 反复挑刺」—— 这次的减法**继续守住这条原则**：跨组件契约由 baseline / clarifier §14 / manifest deps（让 sub-agent grep）承载，不需要单独 sub-agent / 单独脚本 / 单独产物

**新机制替代**（路线图 P0②，本次未实施留下轮）：

- 跨 NW-* 契约校验由 step 3 产出「契约对账表」(hook return shape / enum / 字段→atom 三类) + nw-verifier 新加 V6「写回路径核对」承担
- FSM 状态机识别由 prd-clarifier §14 章节扫描启发式承担（PRD 含「状态对照表」字样时把 FSM 列入澄清问题）

**剩余配套清理**（本次未做，留下轮）：

- `nw-slicer.mjs` 仍接受 `--edges-dir` 参数（向后兼容，不报错），可选清掉
- `page-template-gen.md` / `page-logic-gen.md` 内 B6 节引用仍存在（spec drift，下次清）
- `tech-solution-generator.md` 步骤 4.0 第 ④ 信号描述仍在（下次清）

**净 spec 减少**：~23 行（SKILL.md 340 → 317）+ 删 4 文件（2 agent + 1 schema + 1 docs）

---

## 2026-05-20 · 砍 V5 对抗 verifier + §B.5 历史兼容分支

**砍了什么**：

1. **nw-verifier V5「对抗核对 / 疑罪从有」段**（约 40 行）。stance 从「adversary + judge 合体」回退到纯 judge 模式：核 spec 落地是否到位，不主动假设组件会崩。
2. **§B.5「零 deps 的历史 manifest 自动 pass」向后兼容分支**。dag-validator 现在统一走 deps 块解析路径。
3. **修复 A3 / 修复 A4 注脚**（散见 SKILL.md），合并成现状描述。

**根因**（来自 fresh-run 2026-05-19 实测）：

- V5 对抗扫描设计为「主动找崩点 + 疑罪从有」，每轮 verifier 可以翻新质疑（A 轮挑列表恒空 → B 轮挑 loading → C 轮挑回调 undefined）。retry ≤ 2 上限内永远不收敛——5-B-verify 7 个 NW-* 里 **4 个 verify-failed-giveup**，烧 opus × 8 轮换 0 个真正修复。
- 同时 5-D integration-verifier 报 0 broken 但实际 5 处 import 硬崩 —— 说明 spec 设计的「对抗 verify 体系」对真实事故覆盖率极低。
- 真正抓住事故的是新增的 import-resolver.mjs（5-C 第二关，250 行确定性脚本）。

**新机制接管**：

- 「import 目标不存在」类编译期硬崩 → 5-C 第二关 [IMPORT_RESOLVER] 抓
- 「空输入 / 列表恒空 / 回调 undefined / loading 态」类死状态 → 主 Agent 在 5-C 后置跑几条 grep pattern（如 `onConfirm={undefined}`、`useState\(\[\]\)` 后从未 setState），命中即登记到 [LOGIC_SUMMARY] 阻塞账本，**不**触发 verify 重生成
- 「§5 / token / PRD / 足迹 是否在代码里有对应实现行」→ nw-verifier V1~V4（judge 模式）

**设计教训**：对抗扫描这件事本身有价值，但应该用「确定性脚本 / 固定 grep pattern」实现，**不**应该让 opus 子 agent 反复挑刺——LLM 的"创造性"在 retry 上限有限的场景下是负资产。

---

## 2026-05-19 · fresh run 改版后重测（pageforge-vs-manual-diff 38/100）

**结果**：本轮 pageforge 总分 38/100（vs 手工 78），3 大根因：

1. **盲写 import → 编译崩**：5 处 import 指向不存在符号（`EditorPublishBar` / `EntryCharCountBanner` / `PriorityLevelField` / `PreviewSyncBanner` / `ChevronDownIcon`），4 文件编译期硬崩。
2. **5-C grep 公式误匹配**：`TODO (step5|...)` 子串匹配 `step5.5 figma-review` → grep-failed 虚报。
3. **i18n 标签分裂**：`TODO i18n-gap` vs `TODO i18n` 两种写法并存，下游统计失真。

**这一轮加了什么**（2026-05-20 落地）：

- 🆕 `scripts/import-resolver.mjs`（约 210 行，零外部依赖，jsonc-aware tsconfig paths 解析）—— 5-C 第二关
- ✏️ `page-logic-gen.md` 步骤 4.1：grep 公式 `step5([^.]|$)` 修 bug；新增第二关（import-resolver）+ 第三关（i18n 反向校验）；步骤 3 前置加「防幽灵 import 硬约束」
- ✏️ `page-template-gen.md` 4-B：加「import 完整性硬约束」小节
- ✏️ `SKILL.md` §V：加 [IMPORT_RESOLVER]；§P step 5-C 同步三关 spec

---

## 2026-05-18 · M4 并行化 (K 槽 + watchdog)

> 详见 SKILL.md §B（仍然现行）。socket 中断从常态变罕见后，batch=1 单 NW-* 真干活 ~50s（§B.1）；K=4 并发槽通过 continuous batching 把 wall-clock 砍 ~3x。

---

## 2026-05-17 · 修复 A 系列（dependency graph）

> 已合入主流程，SKILL.md §B.5 + §B.7 即为最终形态。原 "修复 A1 / A2 / A3 / A4" 编号已退场，现状描述不再标编号。

- A1：tech-solution-generator §2.3 产 deps 块（component-graph.schema.json）
- A2：dag-validator 找环 + dangling 检查
- A3：dag-validator `--emit-edges` + nw-slicer `--edges-dir` 注入 B6 切片节
- A4：step 5-D integration-verifier 沿边查集成断裂（**注**：本机制实测信号几乎为 0，下一轮 fresh run 后可能砍掉，见 2026-05-20 设计教训）

---

## 2026-05-15 · 修复 B（阻塞账本）

> 已合入主流程，SKILL.md §P step 5 收尾态判定即为最终形态。原 "修复 B" 编号已退场。

step 5 的 upstream-gap 不再「数完即放行」，改为逐条进 [LOGIC_SUMMARY]「## 阻塞账本」节；账本非空 → step 5 收尾态 ⚠️ 而非 ✅。

---

## 2026-05-13 · 修复 D（内聚性复核）

> 已合入主流程，prd-clarifier §12 + tech-solution-generator 步骤 3 即为最终形态。原 "修复 D" 编号已退场。

判 E 类「内联复用」前过绝对内聚性复核（≥2 个「该独立」信号则禁内联 / 标「建议再拆」）；数数法（按 component count / 人工实现文件数）已作废。
