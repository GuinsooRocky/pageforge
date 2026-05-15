---
name: figma-analyzer
description: Analyze UI screenshots combined with Figma design data to recommend optimal frontend component architecture. Use this skill when the user provides a UI screenshot and Figma URL. Supports two data-source modes (auto-detect, MCP-preferred, REST-fallback)：(1) MCP mode using mcp__figma__* or mcp__figma-desktop__* tools; (2) REST API mode using user-provided Figma access token (no hardcoded token). 项目侧规则冲突由调用方决定（worktree 内不强制对齐 onlychat 的 figma-mcp 规则）。
allowed-tools:
  - Read
  - Write
  - Bash
  - WebFetch
  - Glob
  - Grep
  - Task
metadata:
  category: frontend-development
  requires: figma-access-token-or-mcp
---

# Figma Design Analyzer (Enhanced)

Analyze UI designs by combining visual screenshot analysis with Figma's design structure tree to recommend optimal frontend component architecture.

## Key Features

- ✅ **Visual-to-Figma Matching**: Use IoU (Intersection over Union) algorithm to match visual components with Figma nodes
- ✅ **Component Design Rules**: Apply frontend best practices (image vs component decisions)
- ✅ **Coordinate Scaling**: Automatically handle different dimensions between screenshots and Figma designs
- ✅ **Relationship Detection**: Identify component associations (e.g., Hero Section patterns)
- ✅ **Enhanced Visualization**: Generate annotated images with customizable label modes

## Related Skills

- **visual-screenshot-analyzer**: A standalone skill that performs Step 4 (screenshot visual analysis) independently, without requiring Figma access. It outputs a `components.json` file that can be directly consumed by this skill's `match_visual_to_figma.py --config` parameter. Use it when you only have a screenshot and no Figma URL.

## Prerequisites

Before running this skill, ensure you have:

1. **数据源（二选一，自动检测优先 MCP）**：
   - **MCP 模式（优先）**：当前 CC 进程内任一 Figma MCP 工具可用：
     - 优先 `mcp__figma__*`（如 `mcp__figma__.get_design_context` / `get_metadata` / `get_screenshot` / `whoami`）
     - 次选 `mcp__figma-desktop__*`（同名工具集，桌面端 MCP）
   - **REST API 模式（fallback）**：MCP 都不可用时，必须由用户**显式提供** Figma Access Token：
     - 优先级：用户在调用本 skill 时直接传入 token > 环境变量 `FIGMA_ACCESS_TOKEN` > 用户在 `.claude/.figma-token` 中放置
     - **禁止硬编码 token 到 SKILL.md / agent / 任何源文件**
   - **都没有**：写 `task/pending.md` 的一条 CHK-XXX 等用户提供 MCP 配置或 token，**不做猜测、不用截图替代**
2. **UI Screenshot**: Path to the screenshot image file, default path is `.claude/ui-screenshots/single/single.png`
3. **Background Image (KV)**（可选）: `.claude/ui-screenshots/kv/header-kv.png` - 用于判断哪些元素处于背景图上。**在背景图上的元素不得拆分为独立组件，应作为背景图的一部分处理；叠在背景图上方的应该抽成单独的组件，即不在Background Image上的元素应抽成独立组件**。
4. **Figma URL**: The Figma file/frame URL for the design

## 产物目录规范
- [产物目录]: `.claude/docs/fig_meta/`

## References 索引（按需 Read，避免一次进 context）

| Step | Reference 文件 | 何时 Read |
|---|---|---|
| Step 3 详情 | `references/step-3-fetch-design-tree.md` | 开始 Step 3 拉数据时（缓存不存在）|
| Step 4 详情 | `references/step-4-screenshot-rules.md` | 开始 Step 4 截图分析时 |
| Step 6 详情 | `references/step-6-iou-pipeline.md` | 开始 Step 6 IoU 匹配时 |
| Step 8 详情 | `references/step-8-mcp-enrichment.md` | mode = MCP 且 Step 6 完成时 |

## Workflow

> **重要**: 本技能执行完成后，必须在[产物目录]目录下生成以下文件：
> 1. `figma_raw.json` - 全文件 / 子节点设计树（Step 3 产出，REST 直接 / MCP normalize）
> 2. `components.json` - 视觉组件边界定义 (Step 4 产出)
> 3. `visual_figma_match_report.txt` - IoU 匹配报告 (Step 6 产出)
> 4. `match_data.pkl` - 匹配数据 (Step 6 产出，供 Step 7 使用)
> 5. `matched-visualization.png` - 直观可视化图 (Step 7 产出)
> 6. **`per_component/<name>.json`** - 每个 IoU 命中组件的精读数据（design tokens / variables / 属性）— **仅 MCP 可用时**生成（Step 8 产出）
> 7. **`per_component_screenshots/<name>.png`** - 每个 IoU 命中组件的高质量渲染图 — **仅 MCP 可用时**生成（Step 8 产出）
> 8. `figma_essentials.json` - 精简版（由 m0-template-gen 调 `extract-figma-essentials.js` 生成；本 skill 不直接产）
>
> Step 1-5 完成数据采集与视觉分析，Step 6-7 生成量化匹配结果和可视化，**Step 8 用 MCP 对幸存组件做精读补强**（dual-source 设计的"MCP 那一半"）。Step 8 在 REST-only 模式下自动跳过。

### Step 1: Gather Inputs

Collect the following from the user:
- **Screenshot path**: Local path to the UI screenshot image
- **Figma URL**: The Figma design URL (e.g., `https://www.figma.com/file/{file_key}/...` or `https://www.figma.com/design/{file_key}/...`)
- **数据源决策（自动）**：按 Prerequisites 1 的优先级检测当前进程：
  - 有 `mcp__figma__*` → mode = `MCP_FIGMA`
  - 没有但有 `mcp__figma-desktop__*` → mode = `MCP_FIGMA_DESKTOP`
  - 都没有但 `FIGMA_ACCESS_TOKEN` 环境变量存在 / 用户显式传入 token / `.claude/.figma-token` 存在 → mode = `REST`
  - 都没有 → 写 `task/pending.md` checkpoint，halt
- **Figma Access Token**：仅 mode = `REST` 时需要；不再有"默认 token"

### Step 2: Extract Figma File Key and Node ID

Parse the Figma URL to extract:
- **File Key**: The unique identifier for the Figma file
- **Node ID** (optional): Specific frame/component ID if targeting a specific section

URL patterns:
- `https://www.figma.com/file/{file_key}/{file_name}?node-id={node_id}`
- `https://www.figma.com/design/{file_key}/{file_name}?node-id={node_id}`

### Step 3: Fetch Figma Design Tree（dual-source）

**目标**：产出统一格式的 `.claude/docs/fig_meta/figma_raw.json`，兼容 IoU 脚本 schema。

**核心流程**：
1. 先检查本地缓存 `figma_raw.json` 是否存在 → 存在则跳到 Step 4
2. 不存在按 Step 1 决定的 mode 拉取：
   - **`REST` 模式**：`curl https://api.figma.com/v1/files/{file_key}` 带 `FIGMA_ACCESS_TOKEN`
   - **`MCP_FIGMA` / `MCP_FIGMA_DESKTOP` 模式**：递归 `get_metadata(nodeId)` → normalize 成 REST schema
3. 产物只产 `figma_raw.json`，不在本步做精读 / 抓 screenshot

> 完整流程（curl 命令 / token 优先级 / MCP normalize 规则 / 最小 schema 示例）：**Read** `references/step-3-fetch-design-tree.md`

### Step 4: Analyze the Screenshot and Generate components.json

**核心约束**（背景图过滤 / 头部识别 / 左右按钮拆分）：
- 在背景图（KV）覆盖区域内的元素**不拆分**为独立组件
- 叠在 KV 上方的所有可交互/视觉主元素**必须**识别为独立组件
- 头部左右两侧按钮**必须**单独拆分（永远不能合并、不能与背景图合并）

**输出**：将识别出的组件区域保存为 `components.json` 到[产物目录]，schema：

```json
[
  {
    "name": "组件名称",
    "bbox": {"x": 0, "y": 0, "width": 100, "height": 100},
    "semantic_type": "hero | selector | action | list | banner",
    "implementation": "整图 | 背景图+组件 | 完全组件化",
    "reasons": ["实现方式的理由"]
  }
]
```

`bbox` 坐标为截图像素坐标系（不是 Figma 坐标）。

> 完整截图分析规则（KV 覆盖判断细则 / 头部非 KV 元素强制识别清单 / 头部按钮命名约定 / Tip：复用 visual-screenshot-analyzer）：**Read** `references/step-4-screenshot-rules.md`

### Step 5: Correlate Figma Structure with Visual Analysis

> **背景图约束延续**：在对照 Figma 结构时，同样遵守「不在背景图上的才能被拆分为独立组件」原则。如果发现中间区域不在背景图中，必须作为独立组件输出。
> **头部非KV元素强制识别**：在对照 Figma 结构时，头部区域内所有叠在KV背景图上方的元素（按钮、图标、文字、Tab等任何可视元素）必须作为独立组件输出，不得遗漏。逐节点扫描头部区域的 Figma 子节点，不得因位于KV范围内而跳过。
> **头部两侧按钮约束**：在对照 Figma 结构时，如果发现头部区域（页面顶部）存在左右两侧按钮节点，左侧按钮节点和右侧按钮节点必须分别作为独立组件输出，不得合并。

**`@` 节点特殊规则**：
> ⚠️ 如果某个 Figma 节点的名称以 `@` 开头（如 `@icon`、`@avatar`），则该节点及其所有子节点视为**一张整图**，不再向下检索子节点。IoU 匹配时仅以该节点本身的边界框参与计算，子节点不参与匹配。

**父节点已成为独立组件时，子节点不再拆分规则**：
> ⚠️ 如果某个 Figma 节点已被确认为独立组件 (IoU 得分 ≥ 50%)，则该节点的**所有后代子节点**均不应再被拆分为独立组件。无论子节点自身的 IoU 得分多高，均应视作得分 < 50% 处理，不作为独立组件输出。
> **原则**：父节点整体成为独立组件后，其内部实现细节（子节点）属于该组件的内部结构，不应在组件层级体系中重复拆分。

Map the Figma design tree to the visual elements:

**Figma Node Types to Frontend Concepts:**
| Figma Type | Potential Component |
| FRAME | Container, Section, Card, Modal |
| GROUP | Logical grouping, may not need component |
| COMPONENT | Reusable component candidate |
| INSTANCE | Component usage |
| TEXT | Text component, Label, Heading |
| RECTANGLE | Box, Card background, Button |
| VECTOR | Icon, Illustration |
| IMAGE | Image component |

### Step 6: IoU 空间匹配验证（三阶段流水线）

**核心**：用 IoU 算法把 Step 4 的视觉组件与 Figma 节点空间匹配。**单步执行不直接删除低分组件**——三阶段保证「先标记 → 再调优 → 最后裁定」的确定性流程。

**入口命令**：

```bash
cd scripts
python3 match_visual_to_figma.py \
  -s <截图路径> \
  -f <figma_raw.json路径> \
  -c <components.json路径> \
  --max-depth 4 \
  --save-data
```

**三阶段一句话概述**：
- **Phase 1: Flag** —— 主脚本跑完，sub-50% 组件 flagged 但**未删除**
- **Phase 2: Tune** —— Strategy 1（max-depth 4→8 升级）+ Strategy 2（坐标原点重锚定）调优重试
- **Phase 3: Finalize** —— 按 Phase 2 分类执行：类 A 保留 / 类 B 真删除 / 父节点已独立组件的子节点清理

> 完整三阶段实现（Strategy 1/2 的命令 + 坐标原点修正方法 + 清理 components.json / report.txt 的精确步骤 + 完成确认输出格式）：**Read** `references/step-6-iou-pipeline.md`

### Step 7: 生成匹配可视化图

基于 Step 6 产出的 `match_data.pkl`，在截图上绘制组件边界框：

```bash
cd scripts
python3 visualize_match_result.py \
  -s <截图路径> \
  -d <match_data.pkl路径> \
  -l verbose \
  -o matched-visualization.png
```

标签模式 (`-l`) 可选：
- `simple` - 仅显示组件名称（默认）
- `verbose` - 完整信息（组件名 + Figma 节点 + IoU + 实现方式）
- `none` - 仅边框，无标签

Features:
- **Color-coded borders** with white outline for visibility
- **Coordinate scaling** applied automatically
- **Border clipping prevention** - ensures complete rectangles
- **Chinese font support** - automatic fallback to available fonts
- **Customizable labels** - three display modes

### Step 8: MCP 精读补强（仅 MCP 可用时执行）

**触发条件**：mode = `MCP_FIGMA` / `MCP_FIGMA_DESKTOP`。`REST` 模式整步**自动跳过**，必须在交付摘要里说明。

**目标**：对 IoU 检查后**幸存**（≥ 50%）的每个组件，用 MCP 拿 design tokens / variables / 高质量 screenshot / reference code，落 per-component 文件。

**核心调用**（每个幸存组件 2 次 MCP）：
1. `mcp__figma-desktop__get_design_context(nodeId, artifactType, clientFrameworks, clientLanguages)` → 拉精读上下文
2. `mcp__figma-desktop__get_screenshot(nodeId)` → 拉高质量截图

**产物**：`per_component/<sanitized_name>.json` + `per_component_screenshots/<sanitized_name>.png`

> 完整精读流程（clientFrameworks/clientLanguages 参数从 [CODE_BASELINE] 拼装规则 / 批量 > 20 时的提示策略 / 单组件失败的错误日志格式 / 完成输出模板 / REST-only 跳过文案）：**Read** `references/step-8-mcp-enrichment.md`

## Best Practices

1. **Favor composition over inheritance**: Recommend smaller, composable components
2. **Identify repeated patterns**: Mark components that appear multiple times as high-priority for abstraction
3. **Consider state management**: Note which components likely need local vs. global state
4. **Responsive considerations**: Highlight components that may need responsive variants
5. **Accessibility**: Flag components that need special accessibility attention (forms, modals, navigation)
6. **Use spatial matching**: When Figma node names are non-semantic, rely on Step 6's IoU matching instead of name-based inference

## Error Handling

- **REST 403**: Token 无效 / 无权限。**禁止** fallback 到任何硬编码 token，必须让用户提供新 token
- **REST 404**: file key 错或文件未共享给 token 拥有者
- **node_id 无效**: 退化到全文件拉取（注意全文件可能很大）
- **MCP whoami 显示账号错误**: 停下来让用户切对账号，**禁止**强行 fallback 到 REST（这是 onlychat 项目级规则的精神，agg 也尊重）
- **MCP 调用失败 / 工具掉线**：写 `pending.md` checkpoint 让用户重启 Figma desktop / MCP server；若用户同时给了 REST token，可询问是否临时切到 REST 模式
- **Step 8 单组件 MCP 失败**: 记录到 `mcp_enrichment_errors.txt` 不阻塞，整体继续

## Example Usage

```
User: Analyze this design for component architecture
- Screenshot: /path/to/design-screenshot.png
- Figma URL: https://www.figma.com/design/abc123/MyDesign?node-id=10376-83416
- Source: 自动检测（优先 MCP）；如需 REST，提供 FIGMA_ACCESS_TOKEN 环境变量
```

The skill will:
1. Fetch the Figma design tree via API, parse tree structure (`figma_tree.txt`)
2. Read and analyze the screenshot visually, output `components.json`
3. Correlate visual elements with Figma structure
4. Run IoU spatial matching, output `visual_figma_match_report.txt` + `match_data.pkl`
5. Generate annotated visualization, output `matched-visualization.png`
