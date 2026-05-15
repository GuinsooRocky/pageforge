# pageforge schemas

跨 agent 共享的产物 schema 定义，JSON Schema Draft-07 格式，**单一真相 (single source of truth)**：

- `schema-validator.mjs` 启动时从本目录加载，做运行时校验
- sub-agent prompt 直接引用本目录文件路径，让 sub-agent 知道产物精确格式（避免 prompt 里手抄 schema 漂移）
- 文档（SKILL.md / agents/*.md）展示时引用本目录，避免文字描述与实际校验逻辑不同步

## 设计原则

1. **零外部依赖**：不引入 `zod` / `ajv` / `joi` 等运行时 schema 库。schema-validator.mjs 用 node 内置 + 本目录 JSON 文件
2. **声明式 + 静态**：本目录文件都是静态 JSON Schema 文档，可被任意工具消费（IDE 提示 / CI 校验 / docs 站点）
3. **`x-*` 扩展字段记录领域约束**：JSON Schema spec 允许 `x-*` 字段；用来记录"哪个 step 产出"、"哪个 step 消费"、"lifecycle invariant" 等下游 dispatch 信息
4. **修改流程**：本目录任何文件改动 → 必须同时同步 SKILL.md 对应章节（§[MANIFEST] status 受控集合 / [TEMPLATE_SUMMARY] schema / 等）；schema-validator.mjs 不需要改（它从本目录加载）

## 文件清单

| 文件 | 用途 | 消费者 |
|------|------|-------|
| `manifest-status.schema.json` | [MANIFEST] 组件 status 9 枚举 | schema-validator step 2/3 + visual-analyzer + tech-solution-generator |
| `nw-components.schema.json` | [TEMPLATE_SUMMARY] nw_components 表 row schema | schema-validator step 4 + page-template-gen + page-logic-gen |
| `tech-fe-mode.schema.json` | [TECH_FE] frontmatter `模式:` 枚举 | schema-validator step 3 + page-template-gen |

## 引用方式（sub-agent prompt）

```markdown
**产出约束**：组件 status 字段必须严格属于 `[SCHEMAS_DIR]/manifest-status.schema.json` 的 `enum` 集合。
合法值见该文件 `enum` 数组；语义见 `x-producer-by-value`。
```

## 与 schema-validator.mjs 的关系

schema-validator.mjs 在 `loadSchemas()` 启动函数里同步读本目录 3 个 JSON 文件，把 `enum` 数组转成 JS `Set` 做 O(1) 校验。**本目录文件就是 schema-validator 的真相源**：

```
schemas/*.schema.json  ←—— 修改这里
        │
        ▼ loadSchemas() in scripts/schema-validator.mjs
        │
        ▼ runtime validation on sub-agent return
```

## 未来扩展

- 加 schema 时建议跟随同款 `x-*` 扩展约定（`x-producer` / `x-consumer` / `x-lifecycle-invariant` 等）
- 如果未来产物从 markdown 改成 JSON object（不太可能但开口子），本目录 JSON Schema 可以直接对接 ajv 之类的校验器，无需重写
- 如果 sub-agent 数量翻倍（>15）或 NW-* 数量上 100+ 时再评估是否值得引入运行时 schema 库
