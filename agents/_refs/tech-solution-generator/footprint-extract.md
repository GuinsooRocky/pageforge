# Footprint Extract（详细规范）

> tech-solution-generator 步骤 2.1 的展开。何时 Read：mode 包含 brownfield / mixed-brownfield 子页面，开始六类足迹提取时（greenfield 跳过本文件）。

**目的**：在写技术方案前，先把"被改文件已有的隐性约束"系统化提取，防止新代码静默丢失埋点 / 组件库引用 / 暗色模式 / 业务过滤逻辑等已存在的稳定性资产。

**适用范围**：

- 模式 = brownfield → 对所有"被改文件"做提取
- 模式 = mixed → 仅对 brownfield 子页面涉及的"被改文件"做提取
- 模式 = greenfield → 跳过本步骤（无现有代码可锚定）

**"被改文件"清单来源**：[CLARIFY_FE] §12 NW-\* / RU-\* 的 `insert_into` / `plan_path` / `import_from` 字段，加上 [MANIFEST] 里 `status` 为「已有需改造」/ `修改` 的所有文件路径。

## 执行步骤

1. 列出"被改文件"清单（去重，绝对路径）

2. **调脚本做结构化六类提取**（不再由 LLM 自由扫源码）：

   ```bash
   node [FOOTPRINT_EXTRACTOR] \
     --files "<file1>,<file2>,..." \
     --baseline [CODE_BASELINE] \
     --output [FIG_META]/footprint.json
   ```

   - `[FOOTPRINT_EXTRACTOR]` = `.claude/skills/pageforge/scripts/footprint-extractor.mjs`（在 pageforge/SKILL.md 环境变量节登记）
   - 脚本读 [CODE_BASELINE] 中的 `tracking_function_names` / `i18n_function_names` / `component_lib_prefixes` / `dark_mode_pattern` / `rollout_hook_pattern` 字段做项目参数化；缺失则用合理默认值
   - 输出 footprint.json schema 见 `.claude/skills/pageforge/scripts/README.md`

3. **读 footprint.json，按字段映射写入 §4.0**：

| §4.0 栏目 | 来自 footprint.json 字段 | 语义 |
|---------|-----------------------|-----|
| 组件库引用 | `files[].imports[]`（`is_component_lib=true` 优先）| import 名 + 路径 + 行号 |
| 埋点调用 | `files[].tracking_calls[]` | call + first_arg + 行号 |
| i18n key | `files[].i18n_keys[]`（脚本已 dedup）| call + key + 行号；按共同前缀分组 |
| 业务过滤逻辑 | `files[].business_filters[]` | pattern + snippet + 行号 |
| 响应式策略 | `files[].responsive.strategy` | `js-detect` / `css-breakpoint` / `mixed` / `none` |
| 暗色模式 | `files[].dark_mode[]` | dark class 字面量 + 行号 |
| 灰度框架（bonus）| `files[].rollout[]` → §4.5 | useGradualRollout / ROLLOUT_TOPIC.\* 命中 |

   **不要重复 grep**——脚本已经 100% 准确枚举完，LLM 只读 JSON 填表。

4. **脚本失败兜底**：若 `Bash` 调用返回非零退出 / footprint.json 不存在 / `files[].error` 字段非空（如 file_not_found）→ fail-fast 报错，不进入步骤 5。常见原因：被改文件路径错误 / [CODE_BASELINE] 字段格式不规范 / node 不可用。

5. **逐项判定保留 / 删除**（这一步必须 LLM 做，不是脚本能做的）：对每条足迹问"[CLARIFY_FE] 明确要求改掉它吗？"
   - **是** → 写入 §4.6 删除授权清单（必须引用 [CLARIFY_FE] 段号作为依据）
   - **否** → 默认保留，§5 逻辑方案必须说明新代码如何继承这条足迹

> **分工边界**：脚本只做枚举（看到全部事实），LLM 做语义判断（理解 + 决定保留/删除）。脚本无法识别 footprint 的业务意义（如"interest_tag_max_reached_toast 是上限校验失败提示"）；LLM 拿到完整事实清单后，注意力专注于这层语义，不再分散在"扫源码 + 提事实 + 判断意义"三件事上。

## 硬规则

- §4.6 里没有列出的足迹项，新代码**禁止**删除 / 替换 / 改写
- 如果实现时发现某条足迹无法继承（如新交互结构上不允许），必须回到 step 3 补充 §4.6 授权依据后再继续，不能在 step 4/5 静默删除
- 若 [CODE_BASELINE] M9 标记埋点不可改（项目级约束），则埋点调用一律按"禁止删除"处理——即使 PRD 明确说改也要保留原 event 并新增 event；M9 未标该约束的项目按 [CLARIFY_FE] §10 / §14 决定
