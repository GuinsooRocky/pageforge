# 4.M 混合路径（mixed · per-page 分发）

> page-template-gen 4.M 路径详细规范。何时 Read：[TECH_FE] `模式: mixed` 且含 `pages:` 列表时。

## 触发条件

[TECH_FE] frontmatter `模式: mixed` 且含 `pages:` 列表（每项含 `id` / `name` / `mode` / `path`）。

## 执行逻辑

0. **边界检查**：解析 `pages[]`，若数组为空 → **报错并停**（输出 `"❌ mixed 模式但 pages[] 为空，请检查 [TECH_FE] frontmatter"`），不进入后续步骤
1. 解析 `pages[]`，按 `mode` 字段拆分两组：
   - `mode: brownfield` 的页面 → 收集该页面相关的 §4.2 / §4.3 / §4.4 条目（按 `page_id` 字段归属），**走 4.1 改造路径**（外科手术 + 删除清单）→ Read `_refs/page-template-gen/4-1-brownfield.md`
   - `mode: greenfield` 的页面 → 收集该页面相关的 §4.2 新建条目，**走 4.2 新建路径**（TSX 骨架 + 占位清单）→ Read `_refs/page-template-gen/4-2-greenfield.md`
2. 条目归属规则：以 [TECH_FE] §4 表格的 `page_id` 字段判定（由 tech-solution-generator 写入）；跨 page 共用的组件（如全局 layout、共享组件）归属到 brownfield 组优先处理。
3. 两组按页面顺序串行执行，互不干扰；任一子页面失败不影响其他子页面已完成的产物。
4. **每个 greenfield 子页面独立 placeholder 锚点校验**：4-A 阶段后，对每个 greenfield 子页面的 page.tsx，单独跑 `grep -c 'data-placeholder' <page.tsx>`，必须 ≥ 该子页面在 [TECH_FE] §4.2 表格中归属为本 page_id 的组件类条目数；任一子页面校验失败立即报错并停（不继续后续子页面）。4-C 阶段后另做"对每个 nw_components.status=ok 的 NW-* 验证 placeholder 已替换"校验，规则同非 mixed 模式。
5. **nw_components 状态表 mixed 模式扩展**：表格新增 `page_id` 列，按子页面归属——4-B loop 内每个 NW-* 处理结束写入时附带其 page_id；step 5-B 按 page_id 分组消费，便于复跑入口定位。

## 产物汇总

`.claude/docs/template-gen-summary.md` 按页面分组汇总，每个 page 单独一节并标注其执行路径：

```markdown
# Step 4 产物摘要（mixed）

## page-chat（聊天页 · 4.1 改造）
### 新建文件（N 个）
| 路径 | 职责 | TODO 项数 |
### 改动文件（M 个）
| 路径 | 改动类型 | Edit 次数 |

## page-discover（发现页 · 4.2 新建）
### 新建文件（K 个）
| 路径 | 职责 | 占位组件数 |
### 占位清单
（同 4.2 placeholder-list.md 子集）

## Step 5 待填逻辑清单（合并所有页面）
| 文件 | 所属 page | TODO 描述 |

## §5 待决项（合并所有页面）
| 文件 | 所属 page | 类型（upstream-gap / step5-pending） | 描述 |
|---|---|---|---|

## nw_components 状态表（合并所有页面）
| nw_id | page_id | path | status | is_client | failure_reason |
|---|---|---|---|---|---|
| <NW-id> | page-<id> | <abs path> | ok / skeleton-failed | true / false | - / 失败原因 |

## 复跑指引（仅 status=skeleton-failed 时填）
按 page_id 分组列出失败 NW-*；重跑 step 4-B + step 5-B 后改 status=`ok`，再重跑 step 4-C + step 5-C。
```

greenfield 子页面的 placeholder 仍写入 `.claude/docs/placeholder-list.md`，**mixed 模式下必须按以下 schema 写入**：

```markdown
# Placeholder List

模式：mixed

## page-<id>（<page name>）
| placeholder | data-node-id | 目标路径 | page_id |
|---|---|---|---|
| ComponentName | x:xxx | <path> | page-<id> |

## page-<其他 id>
（同上格式）
```

非 mixed 模式（纯 greenfield）省略顶层 `## page-<id>` 节，直接平铺一张表（无 `page_id` 列）。step 5-B 按本 schema 选择性消费。
