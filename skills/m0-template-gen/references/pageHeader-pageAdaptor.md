> ⚠️ **DEPRECATED（2026-05-03）**：本文件是 m0-template-gen Vue 时代的参考文档。
> m0-template-gen 已改造为 React 版（输出 React TSX 而非 Vue SFC），React 流程不再依赖本文件。
> 本文件仅保留作为 Vue 项目历史参考；若后续 pageforge 重新引入 Vue 子模板，可基于本文件扩展。
> React 项目的"layout-shell 类组件"由 [CODE_BASELINE] M4 显式声明（如项目级 Layout / PageContainer / Shell），不再使用本文件描述的 PageAdaptor / PageHeader 概念。

# PageHeader + PageAdaptor 组件描述（用于模板代码生成 — Vue 版，已 deprecated）

## 1. 前置背景

本项目的 H5 页面使用 `<UI_LIB_BASE>` 提供的两个基础组件协同完成页面布局：

- `PageAdaptor`：**整页主体容器**（页面适配层），承载 header + body 的连续内容区域。
- `PageHeader`：`PageAdaptor` 内部的**顶部 KV/Header 布局**，用于承载返回/规则/入口等四角控制位与 KV 主体内容。

本文档指导"模板代码生成"阶段。基于 **澄清后的 PRD、API 文档、组件解析（nodeId → 组件映射）、Figma 结构信息** 生成页面代码时，将两者视为同一块页面主体容器的一部分。

## 2. 组件职责

### 2.1 `PageAdaptor`

- **语义**：页面主容器（Page Shell）。
- **核心作用**：负责顶部适配样式（负 `marginTop`、`minHeight` 补偿），让整页内容在不同容器/状态栏下位置正确。只做容器包裹与样式适配，业务内容全部来自默认插槽。
- **生成含义**：`PageAdaptor` 代表整页主体，从页面顶部 KV 到内容结束（不含外部底部 Tab 宿主），是最外层 wrapper。

### 2.2 `PageHeader`

- **语义**：页面顶部 KV / Header 布局组件。
- **核心作用**：
  - 提供一个 `relative` 的头部容器，默认插槽用于放 KV 背景图/标题等；
  - 四个角插槽（`leftTop / leftBottom / rightTop / rightBottom`）用于放返回/规则/入口 icon 等，内部以 `absolute` 定位覆盖在头部之上。
- **生成含义**：`PageHeader` 是 `PageAdaptor` 内部的唯一业务节点，内联在页面 SFC 中，不单独生成子组件文件。

### 2.3 默认插槽的分层约定

`PageHeader` 默认插槽内采用**背景层 + 内容层**分层结构：

1. **背景层**：默认插槽最前面放一个背景 div（`position: absolute; z-index: 0`），不在 `PageAdaptor` 层放置。
2. **内容层**：业务内容统一放在 `.page-content` 包裹 div 内（`position: relative; z-index: 2`），确保浮在背景层之上。
3. `PageAdaptor` 内部只有一个 `<PageHeader>`，`</PageHeader>` 之后不再有平行兄弟节点。

## 3. 强约束（违反即输出不合格）

### 3.1 必须满足

| # | 约束 | 说明 |
|---|------|------|
| 1 | `PageAdaptor` 作为根容器，`PageHeader` 作为其唯一子节点 | 两者为嵌套关系，禁止平铺 |
| 2 | 顶部 Header 统一使用 `PageHeader` 组件包裹 | 返回/规则/KV 标题等通过具名插槽（`#leftTop / #rightTop / #leftBottom / #rightBottom`）和默认插槽 `#default` 承载，不拆为子组件文件 |
| 3 | 插槽位必须有功能注释 | 例如 `<!-- #leftTop: 左上返回按钮，需要交互 -->` |
| 4 | 背景层在 `PageHeader` 默认插槽内 | `position: absolute; z-index: 0`，不放在 `PageAdaptor` 层 |
| 5 | 业务内容用 `.page-content` 包裹 | `position: relative; z-index: 1`，确保浮在背景层之上 |
| 6 | 必须生成背景样式代码 | 见 [3.3 背景样式规则](#33-背景样式规则) |
| 7 | `PageHeader` 必须设置 `type="auto"` | 移除组件高度限制，让内容撑开容器高度（见代码模板第 146 行） |

### 3.2 禁止事项

| # | 禁止 | 原因 |
|---|------|------|
| 1 | 生成底部 Tab / 4tab / 吸底导航代码 | 属于外部宿主结构，不在 `PageAdaptor` 语义边界内 |
| 2 | 将 `PageHeader` 或其插槽内容拆为独立子组件文件 | 破坏插槽语义，导致代码碎片化 |
| 3 | 插槽内元素添加额外定位样式 | `#leftTop` 等插槽内禁用 `position`、`top`、`left`、`right`、`bottom`、`transform`，应依赖插槽本身的定位能力 |
| 4 | `</PageHeader>` 之后另起兄弟节点承载业务内容 | 所有内容须在 `PageHeader` 默认插槽内 |
| 5 | 过度拆分组件 | 只保留根组件，已确认为组件的区域内部不再细拆 |

### 3.3 背景样式规则

根据 figma / PRD 中的背景描述，按以下二分类处理：

- **`type: "single-image"`**：整页背景视觉连续，纹理/光效一致，无法明确分割"上图下纯色"时使用。
  在 `PageHeader` 默认插槽内生成一个背景 div，`background` 覆盖整页范围。

- **`type: "top-image-plus-solid"`**：顶部为复杂图片主视觉，底部为近似纯色（或轻纹理）连续填充时使用。
  1. 在 `PageHeader` 默认插槽内生成上半段背景图片，背景图片资源调用 **get-background-img** 技能获取，传入 figma 的 `fileKey` 和 `nodeName`，这里 nodeName 传入 `.background背景`，如果 mcp 返回了多张资源，默认使用第一张即可，直接用链接即可，不需要下载图片。
  2. 页面底色通过 `PageAdaptor` 的 `background-color` 填充！
     - **必须从 `figma数据` 的根节点（`nodeTree` 第一层节点）的 `backgroundColor` 字段直接读取颜色值**
     - 字段路径：`figma数据 → root → backgroundColor`
     - **禁止目测估算**，禁止使用设计稿截图中的近似色、禁止从子节点取色

## 4. 插槽位置示意图

> 四角 slot 悬浮在 header 上方；背景层和内容层都在 `PageHeader` 默认插槽内，通过 `z-index` 分层。

```
┌──────────────────────────────────────┐ ← PageAdaptor
│ ┌──────────────────────────────────┐ │ ← PageHeader (唯一子节点)
│ │                                  │ │
│ │ ┌─────────┐        ┌─────────┐   │ │ ← 具名插槽 (absolute 覆盖)
│ │ │ #leftTop│        │#rightTop│   │ │
│ │ └─────────┘        └─────────┘   │ │
│ │ ┌────────────┐  ┌────────────┐   │ │
│ │ │ #leftBottom│  │#rightBottom│   │ │
│ │ └────────────┘  └────────────┘   │ │
│ │                                  │ │
│ │ ┌──────────────────────────────┐ │ │ ← #default (默认插槽)
│ │ │ ┌──────────────────────────┐ │ │ │
│ │ │ │ .background              │ │ │ │ ← 背景层
│ │ │ │ 背景图 / 渐变 (z-index: 0)│ │ │ │   position: absolute
│ │ │ └──────────────────────────┘ │ │ │   z-index: 0
│ │ │                              │ │ │
│ │ │ ┌──────────────────────────┐ │ │ │ ← 内容层
│ │ │ │ .page-content            │ │ │ │   position: relative
│ │ │ │ (position: relative;     │ │ │ │   z-index: 1
│ │ │ │  z-index: 1)             │ │ │ │
│ │ │ │ ┌──────────────────────┐ │ │ │ │
│ │ │ │ │ 页面主体业务内容区   │ │ │ │ │
│ │ │ │ └──────────────────────┘ │ │ │ │
│ │ │ └──────────────────────────┘ │ │ │
│ │ └──────────────────────────────┘ │ │
│ └──────────────────────────────────┘ │
└──────────────────────────────────────┘
```

## 5. 代码生成上下文说明

生成模板代码时，应综合以下三类上下文信息：

### 5.1 澄清后的 PRD

- 明确页面核心功能与业务逻辑（如：礼物赠送、解锁状态判断、Tab 切换等）
- 确认哪些区域是条件显示（`v-if`）、哪些是列表渲染（`v-for`）、哪些需要事件绑定。
- PRD 中的"返回"、"规则"、"分享"等入口对应 `PageHeader` 的具名插槽位置。

### 5.2 组件解析（nodeId → 组件映射）

- 通过 Figma nodeId 与组件库的映射关系，确认当前区域应使用哪个组件。
- `INSTANCE` 节点优先查找已有组件，避免重复实现。
- 无对应组件的区域，根据 Figma 节点类型（FRAME/GROUP/RECTANGLE 等）决定生成 `div` 还是语义化标签。

### 5.3 Figma 结构信息

- 节点层级、尺寸、颜色、字体、间距等设计数据作为 CSS 样式生成依据。
- 名字带 `@` 符号的节点都是图片。
- `RECTANGLE [IMAGE]` → `background-image` 或 `<img>`；`GRADIENT_LINEAR` → CSS `linear-gradient`。
- 节点 `width/height` 对应 CSS 尺寸（2× 设计稿需除以 2）。
- `TEXT` 节点的字体名称、字号、颜色直接映射到 `font-family`、`font-size`、`color`。

## 6. 代码生成模板

```html
<script setup lang="ts">
import { PageAdaptor, PageHeader } from '<UI_LIB_BASE>';

// 根据 API 文档定义数据类型与请求逻辑
// const { data } = useXxxApi();
</script>

<template>
  <PageAdaptor class="page-adaptor-container">
    <PageHeader class="page-header" type="auto">  <!-- ⚠ 必须设置 type="auto" 让内容撑开高度 -->
      <!-- #leftTop: 左上返回按钮，需要交互 -->
      <template #leftTop>
        <div class="back-btn" @click="handleBack"></div>
      </template>
      <!-- #rightTop: 规则/分享入口，需要交互 -->
      <template #rightTop>
        <div class="rule-btn" @click="handleRule"></div>
      </template>

      <!-- 背景层: position: absolute, z-index: 0 -->
      <!-- 类型1 single-image: 整图背景 -->
      <div class="background"></div>
      <!-- 类型2 top-image-plus-solid: 上图 + 下纯色，底色用 .page-header 的 background-color -->
      <!-- <div class="background-top"></div> -->

      <!-- 内容层: position: relative, z-index: 2 -->
      <div class="page-content">
        <!-- 页面主体内容区: 根据 PRD + API 文档 + 组件解析结果生成 -->
      </div>
    </PageHeader>
  </PageAdaptor>
</template>

<style lang="less" scoped>
.page-adaptor-container {
  // ⚠ 颜色/渐变必须从 figma数据 → root → backgroundColor 字段读取
  // 禁止目测估算或从截图近似色中选取
  //
  // 纯色场景：
  //   background-color: #xxx;  ← 填写 root.backgroundColor 的值
  //
  // 渐变场景（background 值包含 linear-gradient / radial-gradient）：
  //   background: linear-gradient(...);  ← 直接填写 root.backgroundColor 的值
  //   注意：渐变时用 background 而非 background-color
}

.background-kv {
  position: absolute;
  top: 0;
  width: 100%;
  z-index: 0;
  height: 100%;
  background: url('./pageHeader.png') top / 100% no-repeat;
}

.page-header {
  min-height: 100vh !important;
  // 由于 pageAdaptor 上移了 30px，因此 page-header 内部需要向下 30px，保证位置正确
  padding-top: 30px;
}

// ⚠ margin-top 计算公式（禁止目测估算，所有值均从 figma_essentials.json 读取）
//
// 【margin-top】
// 基准节点 = 占位列表（IoU 匹配命中节点，排除 pageHeader 插槽节点/背景图节点）中 absoluteBoundingBox.y 最小的节点
// margin-top = 基准节点.absoluteBoundingBox.y - root.absoluteBoundingBox.y
// 例：基准节点 y=83，根节点 y=-7 → margin-top = 83 - (-7) = 90px
//
// ⚠ 注意：必须用 margin-top 而非 top
//   - top: 视觉偏移，不参与父元素高度计算，会导致 page-header 无法被内容撑高
//   - margin-top 把 .page-content 整体下推，page-header 可被内容正常撑高
.page-content {
  position: relative;
  z-index: 1;
  margin-top: 【基准节点y - 根节点y】px;
  display: flex;
  flex-direction: column;
  align-items: center;
}

// 【各占位块 margin-top 计算公式】
//
// ⚠ .page-content 已设置 display:flex + flex-direction:column + align-items:center
//   子节点水平方向由 flex 自动居中，无需计算 margin-left
//
// ⚠ 必须先判断父容器的定位方式，再选用对应公式：
//
// ─────────────────────────────────────
// 情况 A: 父容器为 position: absolute（绝对定位）
// ─────────────────────────────────────
//   每个子节点独立从父容器顶部量起，兄弟节点之间互不影响：
//   margin-top = nodes[id].absoluteBoundingBox.y - nodes[_parentId].absoluteBoundingBox.y
//
//   示例：父容器 y=347；子节点 y=448
//   → margin-top = 448-347 = 101px
//
// ─────────────────────────────────────
// 情况 B: 父容器为流式布局（position: relative / static，即 .page-content）
// ─────────────────────────────────────
//   子节点在文档流中从上到下依次叠放，每个节点的 margin-top
//   = 该节点与【上一个兄弟节点底部】之间的间距，而非距父容器顶部的距离。
//
//   第一个子节点（无上方兄弟）：
//     margin-top_first = first.y - parent.y
//
//   后续子节点（prev 为紧邻上一兄弟）：
//     margin-top = curr.y - (prev.y + prev.height)
//
//   ⚠ 计算结果允许为负数：Figma 中相邻元素可能存在视觉重叠（curr.y < prev.y + prev.height），
//   此时 margin-top 为负值，CSS 中负 margin-top 完全合法，表示元素向上覆盖上方内容。
//   **禁止将负值强制归零（→ 0px）**，必须按公式结果直接写入。
//
//   示例：
//     parent.y=83；
//     A.y=83，A.height=248 → margin-top_A = 83-83 = 0px
//     B.y=347              → margin-top_B = 347-(83+248) = 16px ✅
//     ❌ 错误做法（绝对坐标差）：margin-top_B = 347-83 = 264px（把 A 的高度重复计入了）
</style>
```
