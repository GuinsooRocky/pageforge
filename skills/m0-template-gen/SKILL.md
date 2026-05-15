---
name: m0-template-gen
description: 基于澄清 PRD + 组件解析（nodeId->组件） + Figma 结构信息，按 [CODE_BASELINE] M4 标记的 layout-shell 类组件（如项目级 Layout / PageContainer / Shell 等）生成 React 页面 UI 骨架，命中组件节点用虚线框占位。适用于 React + Next.js App Router / Vite + React 项目；其他框架（Vue / RN / Svelte）请由调度方按 framework 选用对应骨架生成器。
allowed-tools:
  - Read
  - Grep
  - Glob
  - Write
  - Task
  - TodoWrite
---

# Figma 设计稿 UI 生成（React 版，组件占位）

## 适用框架

| [CODE_BASELINE] M1.framework | 是否适用 |
|----------------------------|--------|
| `react+next`（Next.js App Router）| ✅ 默认主战场，输出 `page.tsx` |
| `react+vite`（Vite + React）| ✅ 输出 `<route>.tsx`，由 baseline M2 路由约定决定 |
| `react+remix` / `react+other` | ⚠️ 部分适用（顶层 `'use client'` 等 RSC-only 部分跳过），文件名按框架约定 |
| `vue` / `react-native` / `svelte` / `flutter` | ❌ **不适用**——本 skill 是 React-only。调度方（如 pageforge page-template-gen 4-A）应按 `[CODE_BASELINE] M1.framework` 判定后再决定是否调本 skill；非 React 项目调用应被 framework 门禁拦截 |

## 必读

执行本技能前**必须先读取**：
- [CODE_BASELINE] M2 source_root + M4 layout-shell 类组件清单 + M1.framework
- 设计稿 Figma URL + 目标 nodeId（由调度方传入）

## 本技能目标

- 命中组件解析（`nodeId → 组件`）的区域：**不实现真实组件**，用**虚线框占位**（带 `data-placeholder` / `data-node-id` 属性 + JSX 注释）。
- **⚠ 禁止 import 任何实业务组件**——只允许 import `[CODE_BASELINE] M4` 标 `layout-shell` 类的项目布局壳组件（如 Layout / PageContainer / Shell / PageAdaptor 等，具体名由 baseline 提供）；其他业务组件位置一律用占位 div。
- 非组件区域：按 Figma 结构用基础 DOM 还原布局。
- 坐标与尺寸：**SCALE 判断规则（严格按以下步骤，禁止用图片文件名中的 `2x` 后缀推断）**：
   1. 读取 `figma_essentials.json` 中 `root.absoluteBoundingBox.width`（由 extract-figma-essentials.js 从根节点提取）
   2. 若该值 ≈ 414 → `SCALE = 1`；若该值 ≈ 828 → `SCALE = 0.5`
   3. 图片导出文件名中出现 `2x` 仅表示图片物理像素密度，**与设计尺寸无关，不得用于 SCALE 判断**
   4. 所有占位块 `width/height` = `nodes[id].absoluteBoundingBox.width/height` × SCALE

## 输入

1. 技术方案（取自 `.claude/docs/tech-fe.md`，若不存在则降级读取 `.claude/docs/clarify-fe-prd.md`）
2. 组件解析文档（取自 `.claude/docs/fig_meta/visual_figma_match_report`；若不存在则根据 PRD 和 Figma 节点树推断 `nodeId → 组件映射`）
3. Figma 精简数据：**优先读取 `.claude/docs/fig_meta/figma_essentials.json`**（由 extract-figma-essentials.js 生成；若不存在则先执行步骤0生成它，**禁止直接读取 `figma_raw.json`**（上下文消耗很大）
4. [CODE_BASELINE] M2.source_root + M4.layout-shell 类组件清单 + M1.framework（决定文件名 + 是否加 `'use client'`）

## 执行步骤（仅本技能增量）

0. **⚠ Figma 数据预提取（必须优先执行）**：从组件解析文档中收集所有目标 nodeId，运行以下脚本生成精简数据文件：
```bash
node .claude/skills/m0-template-gen/scripts/extract-figma-essentials.js \
  --ids <所有目标 nodeId, 逗号分隔>
```
- 输出 `.claude/docs/fig_meta/figma_essentials.json`（< 5KB），包含根节点 `absoluteBoundingBox` / `backgroundColor` 和各目标节点的 `absoluteBoundingBox` / `_parentId`
- 后续所有 SCALE、margin 计算均从 `figma_essentials.json` 读取，禁止读 `figma_raw.json`

1. **确定输出文件路径**：
   - `framework=react+next`（App Router）→ 输出 `<source_root>/<route>/page.tsx`，顶层 `'use client'` 的判定由 page-template-gen 的 4 条件判定（非本 skill 职责）
   - `framework=react+vite` → 输出 `<source_root>/<route>.tsx` 或 `<source_root>/<route>/index.tsx`（按 baseline M2 路由约定）
   - 其他 React 变体 → 按 baseline M2 决定

2. 解析组件解析文档与 Figma，得到完整占位列表：`nodeId`、`componentName`、`slotKey?`、`absoluteBoundingBox`。
   - **占位列表必须同时包含两类节点**：
     - ① IoU 匹配命中的内容区组件
     - ② 项目布局壳组件（来自 [CODE_BASELINE] M4 layout-shell 类）的具名子区域节点

3. 忽略在 IoU 空间匹配结果中没有匹配的组件（具名子区域节点不受此限制，直接纳入），只让能够匹配到 figma 节点的组件占位生成

4. **⚠ 节点层级校验**：直接读取步骤 0 生成的 `figma_essentials.json`，通过各节点的 `_parentId` 字段判断占位嵌套关系：
   - 若节点 A 的 `_parentId` 等于节点 B 的 `id`（且 B 也在占位列表中），则 `placeholder-A` 必须嵌套在 `placeholder-B` 内部
   - 若仍需可视化输出，可运行 `extract-node-hierarchy.js`，但非必须

5. 确定 `SCALE`（从 `figma_essentials.json` 读取），计算占位块 CSS 尺寸时直接用 `nodes[id].absoluteBoundingBox` 字段。

6. **生成 React TSX**：在布局壳组件内**一律用占位 div**，不引入任何真实业务组件；具名子区域注释说明用途。

7. 输出组件占位清单表格 `.claude/docs/placeholder-list.md`：
   - 表格标题：`# 组件清单`，列：`组件名称 | 组件说明 | Figma 链接`
   - **Figma 链接拼装**：直接拼 `https://www.figma.com/design/<fileKey>?node-id=<nodeId>`（不依赖任何外部工具，nodeId 中的 `:` 转 `%3A`）
   - 具名子区域节点必须纳入清单
   - 生成的页面壳本身也作为一行：组件名称为"页面容器"，组件说明为"页面整体容器占位"，Figma 链接为根 nodeId
   - **Figma 链接格式**：列值必须是**纯 URL 文本**（如 `https://www.figma.com/design/xxx?node-id=3%3A2598`），禁止使用 `[文字](url)` Markdown 链接语法
   - **nodeId 格式**：每行的组件名称列必须以 `` `nodeId` `` 反引号格式附带 nodeId，例如：`` `3:2598` 返回主页按钮 ``

8. 运行校验脚本 `scripts/check-component.py` 检验代码和清单组件是否遗漏

## 占位块实现要点（生成要求）

- **禁止使用 `Array.map` 批量渲染占位块**（避免校验与后续替换不稳定）。
- 必须按**一组件一元素**输出：每个命中的 `nodeId` 组件占位，都生成一个独立的 JSX 元素（如 `<div className="..." data-placeholder="ComponentName" data-node-id="3:929" />`），**不在 JSX 内部写文本内容**。
- 每个占位元素必须带一段就近 JSX 注释，至少包含：`nodeId`、`componentName`、`slotKey`（若属于 layout-shell 子区域）。示例：

```tsx
{/* [placeholder] nodeId=3:929 component=PageHeader slot=default */}
<div
  className="absolute h-[88px] w-[750px] border border-dashed border-white"
  style={{ left: 0, top: 0 }}
  data-placeholder="PageHeader"
  data-node-id="3:929"
/>
```

- 占位块**禁止使用 padding 属性**（影响占位区布局精准度）。
- 占位块的样式：
  - **优先用 Tailwind class**（onlychat 等项目用 Tailwind；arbitrary value `w-[88px] h-[42px]` 直接对应 Figma 像素值）
  - 若项目非 Tailwind（按 [CODE_BASELINE] M3 判定），用内联 `style` 或 CSS Modules
  - 边框颜色统一：`border border-dashed border-white`（Tailwind）或等价 inline style
  - 占位信息**通过 `data-placeholder` 属性表达**，不再用伪元素 `::after`（DOM 属性更易被 step 4-C 替换流程识别）

## 输出物

- **React TSX 入口文件**（按 framework + baseline 决定文件名 + 路径）：含布局壳 import + 占位 div + JSX 注释；本技能只保证占位与对齐逻辑落地，业务实现由 step 4-B/4-C/5-A/5-B 后续填充
- **组件占位清单文档**：生成内容放置到 `.claude/docs/placeholder-list.md`

## 生成后校验（必须执行）

生成 TSX 文件和 `placeholder-list.md` 后，**必须运行以下校验脚本**：

```bash
python3 .claude/skills/m0-template-gen/scripts/check-component.py \
   --report .claude/docs/fig_meta/visual_figma_match_report.txt \
   --component <输出目录>/page.tsx \
   --md     .claude/docs/placeholder-list.md
```

> `--component` 参数兼容 `.tsx` / `.jsx` / `.vue`（脚本内部按文件后缀提取占位注释）。旧版 `--vue` 参数已废弃；脚本同时保留 `--vue` 兼容旧 Vue 项目（标 deprecated）。

脚本会输出每个已匹配组件在 TSX 模板和 MD 清单中的占位状态（`✅` / `❌`），并给出最终 `PASS` 或 `FAIL` 结论。

**⚠ 结果处理规则（由模型判断，不自动跳过）**：
- `PASS`：所有已匹配组件均已生成占位，无需额外处理。
- `FAIL`：出现 `❌` 缺失项时，需逐项分析原因：
  - 若缺失节点是 **layout-shell 整体容器**（如根 layout，节点深度第 1 层，整体作为 `<Layout>` 组件承载），如果认为该缺失属于**预期行为**，则不需要补充 `[placeholder]` 注释，可忽略。
  - 若缺失节点是**业务内容组件**（按钮、卡片、列表等），则**自我分析**是否需要加上组件以及对应的占位 div 和 `[placeholder]`。

## 与 Vue 旧版的关系

m0-template-gen 早期版本是为某 Vue 项目（含 PageAdaptor + PageHeader + Vue SFC）写的，本次（2026-05-03）整体改造为 React 版。Vue 时代的参考文档 `references/pageHeader-pageAdaptor.md` 已**标 deprecated**，仅供后续若需要支持 Vue 项目时翻查；新建项目走 React 流程，不再依赖该文档。
