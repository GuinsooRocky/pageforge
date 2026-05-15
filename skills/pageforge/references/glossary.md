# §G Glossary（核心术语对照）

> pageforge 专有术语集中定义。主 Agent 第一次接触某术语时按需 Read，常用流程不必装入主 context。
> 主入口：[`../SKILL.md`](../SKILL.md)

本 workflow 内部的专有术语在此集中定义，避免散文里多义混用：

- **现有足迹（footprint）**：tech-solution-generator §4.0 的固定六类操作性定义——「组件库引用 / 埋点调用 / i18n key / 业务过滤逻辑 / 响应式策略 / 暗色模式覆盖」。brownfield 模式下被改文件已经依赖的隐性约束，新代码必须保留（除非 §4.6 已登记授权删除）。
- **内联复用（inline usage）**：step 3 Phase 2 E 类探测的结论之一，指"该组件没有独立 state / useEffect / 副作用 / 多步事件协调，可不新建文件，直接在调用方内联使用"。**不要叫"降级内联"**，"降级"在前端 = graceful degradation，跟这里无关。
- **brownfield / greenfield / mixed**：项目模式枚举。brownfield = 改造已有页面；greenfield = 新建页面；mixed = 多页面同时混合（页数 ≥ 2 且既有 brownfield 又有 greenfield）。**Mode single source of truth = [TECH_FE] frontmatter `模式:` 字段**（由 step 3 写入）。
- **§4.0 / §4.6**：[TECH_FE] 文档内章节编号——§4.0 是现有足迹基线（brownfield 必填），§4.6 是足迹删除授权清单。
- **scaffold slot / placeholder**：step 4 page-template-gen 在 page.tsx 留下的 `<div data-placeholder="ComponentName" />` 占位标记。**正常路径下由 step 4-C 收尾子步骤（aggregator）直接替换为真实 `<ComponentName />` 引用 + import**；仅当 step 4-B 产 NW-* 骨架失败、[TEMPLATE_SUMMARY] nw_components 表标 `status=skeleton-failed` 时，placeholder 才在 page.tsx 中保留作为人工复跑入口。
- **strict equality only**：design token 映射约定——Figma 提供的 rgba/hex/px 值**仅在严格等值时**映射到项目 token，不允许近似估算（不允许 `#1a1a1a` → `bg-gray-900`）。
