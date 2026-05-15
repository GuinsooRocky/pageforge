# Step 4: Screenshot 视觉分析规则（详细）

> 主 SKILL.md Step 4 的展开。何时 Read：开始 Step 4 截图分析时。

**前置步骤：加载背景图 (KV)**

在进行视觉分析前，必须先读取背景图 `.claude/ui-screenshots/kv/header-kv.png`，确定其在截图中的覆盖区域 (bbox)。

**背景图覆盖区域内的组件拆分规则（核心约束）**：
> ⚠️ 凡是位于背景图（header-kv.png）的元素，**一律不得拆分为独立组件**。如果内部元素有交互或动态内容，应将其为独立组件实现。
> 只有**不在背景图覆盖范围上**的元素，才可以被识别并拆分为独立组件（比如叠在背景图上方的元素）。

**头部区域非KV元素的强制识别规则**：
> ⚠️ **头部区域（页面顶部）**叠在背景KV图上方的所有可交互或视觉主元素，必须被识别为独立组件**。常见元素包括但不限于：按钮、图标、文本标签、徽章、Tab、搜索栏、分享按钮、关注按钮等。不得因其位于KV图范围内而被忽略——「在KV图范围内」≠「属于KV图」，叠在KV上方的元素属于独立组件。

> **务必逐一检查头部区域内的每个视觉元素**。凡不是KV背景图本身的元素，均需判断是否应单独成为独立组件。

**头部区域两侧按钮的特殊拆分规则**：
> ⚠️ 在分析背景头部图之外的元素时，如果发现头部区域（页面顶部导航栏或标题栏位置）存在两侧按钮（如返回按钮、关闭按钮、设置按钮、更多按钮等），必须遵守以下规则：
> 1. **左侧按钮**必须单独识别为一个独立组件（命名如 `HeaderLeftButton` 或 `NavLeftButton`）
> 2. **右侧按钮**必须单独识别为一个独立组件（命名如 `HeaderRightButton` 或 `NavRightButton`）
> 3. 左右两侧按钮**永远不能合并在同一组件**，也不能与背景头部图合并
> 4. 拆分左右按钮时，**绝对不包含背景头图**，背景图始终作为独立的整图处理
> 5. 即使左侧或右侧只有一个按钮，也必须被拆成为独立组件，不得归入背景图

Read and analyze the UI screenshot to understand:
- Visual layout and composition
- UI element types (buttons, inputs, cards, lists, etc.)
- Visual hierarchy and grouping
- Responsive design patterns
- Spacing and alignment patterns
- **Which elements fall within the background image (KV) bounding box** - these must NOT be split into independent components

**必须输出**：将识别出的组件区域保存为 `components.json` 文件到【产物目录】。该文件是 Step 6 IoU 匹配的必需输入。格式如下：

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

其中 `bbox` 坐标为截图像素坐标系 (不是 Figma 坐标)。

> **背景图过滤规则**：在生成 `components.json` 时，凡在 `.claude/ui-screenshots/kv/header-kv.png` 覆盖区域内的元素 (不包含叠在背景图上方的元素，叠在背景图上方的元素要抽为独立组件)，背景图**不得**作为独立条目写入。

> **Tip**：如果已通过 `visual-screenshot-analyzer` 技能生成了 `components.json`，可跳过本步骤的分析部分，直接使用已有文件。但仍须按上述背景图过滤规则对已有文件进行复查和清理。
