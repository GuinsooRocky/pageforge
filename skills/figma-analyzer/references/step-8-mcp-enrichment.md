# Step 8: MCP 精读补强（详细规范）

> 主 SKILL.md Step 8 的展开。何时 Read：mode = `MCP_FIGMA` / `MCP_FIGMA_DESKTOP` 且 Step 6 完成进入精读阶段时。REST-only 模式不需要读本文件。

**触发条件**：Step 1 决定的 mode = `MCP_FIGMA` 或 `MCP_FIGMA_DESKTOP`（即任一 Figma MCP 可用）。`REST` 模式或无 MCP 时整步**自动跳过**，且必须在交付摘要里说明跳过原因。

**目标**：对 IoU 检查后**幸存**（≥ 50%）的每个组件，用 MCP 拿到 REST 拿不到或拿不准的数据：design tokens / variables / 高质量 screenshot / 自动生成的 reference code 片段，落到 per-component 文件。

**输入**：Step 6 清理后的 `components.json`（每条带匹配的 Figma `nodeId`）

## 对每个幸存组件

1. **拉精读上下文**：
   ```
   mcp__figma-desktop__get_design_context(
     nodeId = "<节点 ID, 形如 10376:83416>",
     artifactType = "COMPONENT_WITHIN_A_WEB_PAGE_OR_APP_SCREEN",
     clientFrameworks = "<由 [CODE_BASELINE] M1.framework 拼装；如 'react,next' / 'react,vite' / 'vue' / 'react-native'>",
     clientLanguages = "<由 [CODE_BASELINE] M1.language 拼装；如 'typescript,tsx,css' / 'typescript,vue,css' / 'javascript,jsx'>"
   )
   ```
   返回结构化数据（reference code / design tokens / variables / dependencies / 当前节点的精简层级）。

2. **拉高质量截图**：
   ```
   mcp__figma-desktop__get_screenshot(nodeId = "<节点 ID>")
   ```
   返回 PNG 数据。

3. **写两个产物**：
   - `[产物目录]/per_component/<sanitized_name>.json` —— 把 design_context 返回值的关键字段（`tokens` / `variables` / `metadata` / `code` 截断到 < 5KB）整理后落盘
   - `[产物目录]/per_component_screenshots/<sanitized_name>.png` —— get_screenshot 返回的 PNG

`<sanitized_name>` = components.json 里的 `name` 去掉空格 / 中文 / 特殊字符（snake_case 化），保证文件名安全。

## 精读批量与异常处理

- 若组件数量 > 20，先做提示让用户选择全部精读 / 仅前 N 个 / 跳过——避免一次发太多 MCP 调用
- 单个组件 MCP 调用失败 → 记录到 `[产物目录]/mcp_enrichment_errors.txt`，继续下一个，不阻塞整体
- 全部失败时不视为成功；摘要标 `⚠️ MCP 精读失败 X/Y 个`

## 完成后输出

```
✅ Step 8 MCP 精读完成：
- 处理组件：X 个（components.json 幸存数）
- per_component/ JSON：X 个
- per_component_screenshots/ PNG：X 个
- 失败：N 个（详见 mcp_enrichment_errors.txt）
```

REST-only 模式下输出：

```
⏭️ Step 8 跳过：当前 mode = REST，无 MCP 可用；per_component/ 与 per_component_screenshots/ 不生成。下游若需要 design tokens / variables，建议未来切到 MCP 模式重跑本 step。
```
