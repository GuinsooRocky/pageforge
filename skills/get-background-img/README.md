# get-background-img

通过 `get-figma-source` MCP 按节点名/节点 ID 提取背景图资源。

## 核心用途

调用 `fetch_figma_images` MCP 工具，支持 `fileKey + nodeName` 或 `fileKey + nodeId`。

## 参数说明

| 参数 | 必填 | 说明 |
|------|------|------|
| `fileKey` | 可选 | Figma 资源区文件 key，默认 `fyxc82DlwNPx6oMG8sV0mg` |
| `nodeName` | **优先** | 节点名称，可与设计师约定好，默认 `头部背景` |
| `nodeId` | 备选 | 节点 ID，仅在明确指定时使用 |

> **优先级**：`nodeName` > `nodeId`，两者都未指定时默认 `nodeName=头部背景`

## 示例

```
# 最简用法（使用默认 fileKey 和 nodeName）
> 帮我获取头图

# 指定节点名称（推荐，与设计师约定）
> 帮我获取 nodeName=主题 的背景图

# 指定 fileKey 和节点名
> fileKey=fyxc82DlwNPx6oMG8sV0mg, nodeName=主题 KV 图

# 兜底：只知道 nodeId 时
> nodeId=3:929 的背景图
```

## 注意事项

- 优先使用 `nodeName`，可与设计师提前约定节点命名规范，省去查 nodeId 的步骤
- `fileKey` 取资源区的 Figma 文件 key（非页面 key）
