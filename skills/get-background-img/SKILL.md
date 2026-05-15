---
name: get-background-img
description: 调用 ones figma-api (node-name-child-images) 按 fileKey + nodeName 获取背景/子图资源。nodeName 固定为「头部背景」。
allowed-tools:
  - Read
  - Write
  - mcp__get-figma-source__fetch_figma_images
context: fork
metadata:
  category: frontend-development
---

## Skill 执行流程

### Step 0: 确认入参

从用户输入中提取以下参数：

| 参数 | 默认值 | 说明 |
|------|-------|------|
| `fileKey` | 见下方解析规则 | 资源区 Figma 文件 key，可由用户覆盖 |
| `nodeName` | `头部背景` | 节点名称，**固定值，不可更改**，始终传 `头部背景` |

> **注意**：`nodeName` 固定为 `头部背景`，不支持传入 `nodeId` 或其他节点名称。

**fileKey 解析规则**（按优先级）：

1. **用户直接提供**：若用户在输入中明确给出 `fileKey`，直接使用。
2. **从 plan.md 提取**：若用户未提供 `fileKey`，读取 `.claude/task/plan.md`，找到 `## 输入信息` 下的「设计稿」字段，从 Figma URL 中提取 `fileKey`。
   - Figma URL 格式：`https://www.figma.com/design/<fileKey>/...` 或 `https://www.figma.com/file/<fileKey>/...`
   - 提取两段斜杠之间的字符串即为 `fileKey`
   - 示例：`https://www.figma.com/design/qySTkstSICVKjpfMq5AMUk/xxx` → `fileKey = qySTkstSICVKjpfMq5AMUk`

---

### Step 1: 调用 get-figma-source MCP 获取背景图

直接调用 `fetch_figma_images` 工具，**不需要执行任何脚本**：

```
fetch_figma_images(
  fileKey = <fileKey>,        // 用户提供或默认
  nodeName = "头部背景"        // 固定值，不可更改
)
```

---

### Step 2: 解析结果，输出图片 URL

返回结构为：

```json
{
  "content": {
    "code": 0,
    "data": {
      "children": [
        { "id": "3:931", "name": "节点名", "imageUrl": "https://..." }
      ]
    }
  }
}
```

从 `content.data.children` 数组中提取所有子图，按如下格式整理输出：

```
子图列表（共 N 张）：
  [1] id=3:931  name=生成特定风格图片  url=https://...
  [2] id=3:932  name=Rectangle ...    url=https://...
```

---

### Step 3: 写入使用建议

如有多张子图，说明各自对应的节点名称和用途，默认使用第一张。
