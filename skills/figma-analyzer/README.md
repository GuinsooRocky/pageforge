# Figma Analyzer (Enhanced)

通过 UI 截图和 Figma URL 综合分析设计稿，生成合理的前端组件架构建议。

## 功能概述

此技能结合视觉截图分析与 Figma 设计结构树，帮助开发者理解设计稿并规划前端组件架构。

## ✨ 新增功能 (Enhanced)

### 1. 视觉-Figma 空间匹配
- **IoU 算法**：通过交并比匹配视觉组件与 Figma 节点
- **坐标缩放**：自动处理截图与设计稿尺寸差异
- **不依赖节点命名**：即使 Figma 节点名为"Frame 123456"也能准确匹配

### 2. 组件设计规则引擎
- 自动判断哪些元素用图片实现
- 哪些元素需要组件化
- 应用前端最佳实践

### 3. 增强可视化
- 三种标签模式 (simple/verbose/none)
- 完整边框绘制（防裁剪）
- 中文字体支持
- 颜色编码 + 白色描边增强可见性

## 使用方式

在项目中使用 `/figma-analyzer` 调用此技能。

## 必需输入

| 输入 | 说明 |
|------|------|
| UI 截图路径 | 设计稿截图的本地文件路径 |
| Figma URL | 设计稿的 Figma 链接 |
| Figma 数据源 | 自动检测：优先 MCP（`mcp__figma__*` / `mcp__figma-desktop__*`），MCP 不可用时 fallback REST（需用户显式提供 token，无硬编码默认 token） |

> **数据源模式**：本 skill 双模式（MCP-preferred / REST-fallback，详见 SKILL.md）。`MCP_FIGMA` / `MCP_FIGMA_DESKTOP` 模式无需 token；仅 `REST` 模式需要 token。项目侧若有 Figma MCP 强制规则（如 onlychat `.claude/rules/figma-mcp.md` 禁用 REST），由调用方决定是否对齐。

## 工作流程

### 基础流程
1. **收集输入** - 获取截图路径、Figma URL；自动检测数据源模式（MCP / REST）
2. **解析 Figma URL** - 提取 file_key 和 node_id
3. **获取设计树** - MCP 模式用 `get_metadata` 递归拉取并 normalize；REST 模式经 Figma API 获取
4. **分析截图** - 视觉分析 UI 布局、元素类型、层级关系
5. **关联分析** - 将 Figma 节点类型映射到前端组件概念
6. **生成架构建议** - 输出组件架构报告

### 增强流程 (NEW)
7. **空间匹配** - 使用 `match_visual_to_figma.py` 通过 IoU 算法匹配视觉组件与 Figma 节点
8. **可视化标注** - 使用 `visualize_match_result.py` 生成带标注的可视化图片

## 输出内容

### 基础输出
- **组件层级图** - 可视化的组件树结构
- **组件分类** - 按原子/分子/有机体分类组件
- **组件规格说明** - 每个组件的 Props、Children、Variants
- **可复用模式** - 识别重复出现的设计模式
- **Design Tokens** - 提取颜色、字体、间距等设计变量

### 增强输出 (NEW)
- **匹配报告** - 视觉组件与 Figma 节点的匹配结果，包含 IoU 得分
- **可视化图片** - 标注了组件边界和匹配信息的截图
  - Simple 模式：只显示组件名
  - Verbose 模式：显示完整信息（组件名 + Figma 节点 + IoU + 实现方式）
  - None 模式：只显示边框
- **组件设计规则** - 基于最佳实践的实现建议（图片 vs 组件）

## 环境配置

默认走 MCP 模式，无需任何环境变量。仅当 MCP 不可用、需 fallback 到 REST 模式时才需提供 token：

```bash
export FIGMA_ACCESS_TOKEN="your-figma-access-token"   # 仅 REST fallback 模式需要
```

获取 Figma Access Token: https://www.figma.com/developers/api#access-tokens

## 关键改进 (v2.0)

### 脚本全面参数化
所有核心脚本已重构支持命令行参数，完全可配置：
- ✅ 自动读取截图和 Figma 尺寸
- ✅ 自动应用坐标缩放
- ✅ **所有输出文件默认保存到截图所在目录**（而非scripts目录）
- ✅ 支持自定义输出路径和文件名

### 核心工具

**1. fetch_figma_data.sh** - Figma 数据获取

**2. match_visual_to_figma.py** - 视觉-Figma 匹配器
通过 IoU 算法匹配视觉组件与 Figma 节点，输出匹配报告和数据。

**3. visualize_match_result.py** - 匹配结果可视化
生成标注图片，支持三种标签模式 (simple/verbose/none)。

## 文件组织

### 目录结构
```
figma-analyzer/
├── scripts/                              # 通用功能脚本
│   ├── fetch_figma_data.sh
│   ├── match_visual_to_figma.py
│   └── visualize_match_result.py
│
└── ../../test/                           # 测试用例目录
    └── case2/                            # 示例：春季之星活动页
        ├── case2.png                      # 输入：UI截图
        ├── figmaurl.md                    # 输入：Figma URL
        ├── case2_components.json          # 输入：组件配置
        ├── figma_data.json                # 中间产物：Figma API数据
        ├── visual_figma_match_report.txt  # 输出：匹配报告
        ├── match_data.pkl                 # 输出：匹配数据
        └── matched-visualization.png      # 输出：可视化图片
```

**重要**：
- ✅ scripts目录只保留通用功能脚本
- ✅ 所有case特定文件（输入、输出）都在test/caseX目录下
- ✅ `figma_data.json` 由Figma API获取，不是预置文件

## 匹配准确度

基于测试案例：
- ✅ 匹配成功率: 100% (5/5 组件)
- ✅ 平均 IoU: 82.5%
- ✅ 最高 IoU: 99.73%
- ✅ 正确识别组件关联关系（如 Hero Section 组合）
