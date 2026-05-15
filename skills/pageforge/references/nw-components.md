# §M2 [TEMPLATE_SUMMARY] nw_components 状态表 schema

> step 4 page-template-gen 写入；step 4-C / step 5-B / 手工复跑入口都按本表 status 字段 dispatch。
> 主入口：[`../SKILL.md`](../SKILL.md)。权威 JSON Schema：[`../schemas/nw-components.schema.json`](../schemas/nw-components.schema.json)。

[TEMPLATE_SUMMARY] = `.claude/docs/template-gen-summary.md`，由 step 4 写入。除原有"新建文件 / 改动文件 / Step 5 待填逻辑清单 / §5 待决项"外，**强制包含**一节 `## nw_components 状态表`：

> **权威定义（new0.0.4 起）**：`[SCHEMAS_DIR]nw-components.schema.json` 是本表 row schema 的 single source of truth（字段名/类型/约束/正则）。下表是人类可读的镜像；改本表必须同步那个 JSON 文件。

| 字段 | 类型 | Producer | 说明 |
|---|---|---|---|
| `nw_id` | string | step 4.2 | 来自 [TECH_FE] §4 表格 NW-* 编号 |
| `path` | string | step 4.2 | NW-*.tsx 绝对路径（基于 [CODE_BASELINE] M2 source_root） |
| `status` | enum | step 4.2 | `ok` / `skeleton-failed` |
| `is_client` | bool | step 4.2 | 'use client' 4 条件判定结果（hooks / browser API / event handler / imports client）|
| `failure_reason` | string? | step 4.2 | status=`skeleton-failed` 时填，简述失败原因（一行） |

step 4-C / step 5-B / 后续手工复跑入口都按本表 status 字段 dispatch。

## §M2.1 模板片段

```markdown
## nw_components 状态表

| nw_id | path | status | is_client | failure_reason |
|---|---|---|---|---|
| NW-002 | /abs/path/NW-002.tsx | ok | true | - |
| NW-003 | /abs/path/NW-003.tsx | skeleton-failed | - | Figma node 解析超时 |
```
