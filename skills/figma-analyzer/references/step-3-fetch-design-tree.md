# Step 3: Fetch Figma Design Tree（dual-source 详细规范）

> 主 SKILL.md Step 3 的展开。何时 Read：开始 Step 3 时；本地缓存 `.claude/docs/fig_meta/figma_raw.json` 不存在时。

**目标**：产出统一格式的 `.claude/docs/fig_meta/figma_raw.json`（兼容 IoU 脚本现有 schema），无论数据从 REST 来还是 MCP 来。

**优先检查本地缓存**: 在拉取数据前，先检查 `.claude/docs/fig_meta/figma_raw.json` 是否存在。

```bash
ls .claude/docs/fig_meta/figma_raw.json 2>/dev/null && echo "EXISTS" || echo "NOT_FOUND"
```

- 文件存在 → 直接复用，跳过本步，继续 Step 4
- 文件不存在 → 按 Step 1 决定的 mode 拉取：

## Step 3.A — `REST` 模式（用户提供 token）

```bash
# 全文件
curl -H "X-Figma-Token: ${FIGMA_ACCESS_TOKEN}" \
  "https://api.figma.com/v1/files/{file_key}" \
  -o .claude/docs/fig_meta/figma_raw.json

# 单节点（Figma URL 带 node-id 时优先这条，体积小很多）
curl -H "X-Figma-Token: ${FIGMA_ACCESS_TOKEN}" \
  "https://api.figma.com/v1/files/{file_key}/nodes?ids={node_id}" \
  -o .claude/docs/fig_meta/figma_raw.json
```

注意：URL 里的 node-id 形如 `10376-83416`，REST 调用时改为 `10376:83416`（横杠改冒号）。

token 来源优先级：
1. 用户在调用时直接传入
2. 环境变量 `FIGMA_ACCESS_TOKEN`
3. `.claude/.figma-token` 文件第一行

任一存在即用；都没有时不能继续——回到 Step 1 写 pending checkpoint。

## Step 3.B — `MCP_FIGMA` / `MCP_FIGMA_DESKTOP` 模式（无 REST token）

调用对应 MCP 工具集递归拉节点，结果 normalize 成 REST 风格 schema 后写入 `figma_raw.json`：

```
mcp__figma-desktop__get_metadata(nodeId="<节点 ID>")  // 或对应的 mcp__figma__.get_metadata
  → 返回当前节点 + 直接子节点的精简 XML（含 id / type / name / 位置 / 大小）
```

`get_metadata` 给的是**单层结构**——要拿全树必须**递归调用**：自顶向下，对每个 FRAME / GROUP / COMPONENT / INSTANCE 子节点继续 `get_metadata(nodeId=子节点)`，直到叶子节点（TEXT / RECTANGLE / VECTOR / IMAGE 不再展开）。

normalize 规则（MCP XML → REST JSON）：

| MCP XML 字段 | REST JSON 字段 |
|---|---|
| `id="..."` | `id` |
| `type="..."` | `type`（保持大写：FRAME / GROUP / TEXT / ...）|
| `name="..."` | `name` |
| `x` / `y` / `width` / `height` | `absoluteBoundingBox: { x, y, width, height }` |
| 子节点列表 | `children: [...]` |

最小可用 schema（MCP 模式产出的 `figma_raw.json` 至少包含这些）：

```json
{
  "document": {
    "id": "0:0",
    "name": "Document",
    "type": "DOCUMENT",
    "children": [
      {
        "id": "10376:83416",
        "name": "...",
        "type": "FRAME",
        "absoluteBoundingBox": { "x": 0, "y": 0, "width": 375, "height": 812 },
        "children": [...]
      }
    ]
  },
  "_source": "mcp_figma_desktop_get_metadata",
  "_normalized": true
}
```

`_source` / `_normalized` 是新加的元字段，下游 IoU 脚本不读，但便于调试 / 后续 step 知道数据来源。

## Step 3 通用说明

- 无论 mode = REST 还是 MCP，本步**只负责拿到 `figma_raw.json`**；不在本步做精读 / 抓 screenshot
- `figma_raw.json` schema 必须与 REST 全文件 schema 兼容，确保 Step 6 的 `match_visual_to_figma.py` 不用改
- design tokens / variables / 渲染图等"MCP 才有的丰富数据"**留到 Step 8 做精读时再拉**——避免无谓全量拉取浪费 token
