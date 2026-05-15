---
name: api-doc-gen
description: 专门负责生成接口文档（支持远端 docs/<INTERNAL_API_PLATFORM> 输入，并与本地同名接口对比补齐字段）
allowed-tools: Read, Grep, Glob, Write, Edit, AskUserQuestion, <MCP_API_LOOKUP>, <DOC_PARSE_MCP>
---

# 接口文档生成 Skill

## 背景
该 Skill 用于把接口信息沉淀为可直接用于前端技术方案的接口文档，输出到统一文档文件。接口来源支持远端文档（doc）和 <INTERNAL_API_PLATFORM>，并且必须结合本地同名接口进行补齐校验。

## 目标
根据用户输入的远端 doc 地址或 <INTERNAL_API_PLATFORM> 地址，生成结构化接口文档并写入 `[API]`。若本地存在同名接口，必须对比并补齐缺失字段；若出现字段冲突，必须先向用户确认再落文档。

## 当前环境变量及目录规则
- [API] = '.claude/docs/api.md'

## 工作流
- [ ] 步骤 1：收集输入来源与目标接口
- [ ] 步骤 2：按来源提取远端接口信息
- [ ] 步骤 3：检索本地同名接口并做字段对齐
- [ ] 步骤 4：冲突字段向用户确认
- [ ] 步骤 5：按模板写入 API 文档
- [ ] 步骤 6：结果自检与交付说明

## 步骤 1：收集输入来源与目标接口
### 必须确认的信息
- 接口来源：`doc` 或 `<INTERNAL_API_PLATFORM>`（可多条，按输入顺序处理）
- 远端地址列表：
  - doc 来源：<INTERNAL_DOC_URL>（可多个）
  - <INTERNAL_API_PLATFORM> 来源：<INTERNAL_API_PLATFORM> 接口地址（可多个）
- 是否指定目标接口名/接口 URL（可选，未指定则按文档可识别接口顺序处理）

### 缺失信息处理
- 缺失来源或地址时，必须询问用户，不得自行猜测。

## 步骤 2：按来源提取远端接口信息
### 来源为 <INTERNAL_API_PLATFORM>
- 逐条读取用户输入的 <INTERNAL_API_PLATFORM> 地址，提取 apiId。
- 调用 `<MCP_API_LOOKUP>` 获取接口信息。
- 提取并标准化以下内容：接口名、URL、请求方法、请求入参、返回值字段、字段说明、枚举/必填信息。

### 来源为 doc
- 逐条读取用户输入的 doc 地址。
- 调用 `<DOC_PARSE_MCP>` 的 `docs-parse` 解析文档。
- 仅提取接口相关内容，忽略需求背景、排期、非接口说明。
- 标准化为与 <INTERNAL_API_PLATFORM> 一致的接口结构，便于后续合并。

## 步骤 3：检索本地同名接口并做字段对齐
### 同名接口判定规则（按优先级）
1. 接口 URL 完全一致
2. 接口名一致（忽略大小写）
3. URL 末级 path + 请求方法一致

### 本地检索范围
- `[API]`
- 本地代码中的请求定义（如 service/api 目录，按仓库实际结构搜索）

### 字段补齐规则（必须执行）
- 若远端字段缺失但本地同名接口存在该字段：补齐到当前接口文档中，并在字段描述末尾标注 `（来自本地补齐）`
- 若远端与本地字段说明互补：合并为更完整描述，避免信息丢失。
- 若外层存在 `result/data` 包裹，仅在「返回值」中展开 `data` 下字段。

## 步骤 4：冲突字段向用户确认
### 冲突判定
- 同名字段类型不一致（如 `string` vs `number`）
- 同名字段必传性不一致（必传 vs 非必传）
- 同名字段语义冲突（描述指向不同业务含义）
- 枚举值集合冲突（枚举项不一致或含义不一致）

### 冲突处理（强制）
- 列出冲突清单（字段名、远端值、本地值、差异说明）
- 调用 `AskUserQuestion`，让用户逐项选择：
  - 采用远端定义
  - 采用本地定义
  - 合并（给出合并规则）
- 用户未确认前，禁止写入最终冲突结论到 `[API]`。

## 步骤 5：按模板写入 API 文档

### 模板选择（按 [CODE_BASELINE] M6.api_style 分流）

读 [CODE_BASELINE] M6 的 `api_style` 字段，按下表选择对应模板：

| api_style | 适用模板 | 触发条件 |
|-----------|---------|---------|
| `rest` | `template-rest.md` | 项目使用传统 RESTful API（GET/POST/PUT/DELETE + URL path） |
| `trpc` | `template-trpc.md` | 项目依赖 `@trpc/server` / `@trpc/client` |
| `graphql` | `template-graphql.md` | 项目依赖 `graphql` / `@apollo/client` / `urql` 等 |
| `grpc` | `template-grpc.md` | 项目依赖 `@grpc/grpc-js` / `@connectrpc/connect` / `grpc-web` 等 |
| `unknown` 或缺失 | 询问用户选择 | 兜底 |

**多 api_style 项目**：按当前接口的实际风格选模板，同一文档允许混用（如 REST 接口用 template-rest，gRPC 接口用 template-grpc）。

### 写入规则
- 已存在同名接口章节：更新并补齐，不重复新增章节。
- 不存在同名接口章节：按所选模板追加新章节。
- 多接口处理顺序：严格按用户输入地址顺序。

## 步骤 6：结果自检与交付说明
### 自检清单
1. 每个接口都包含：接口名、URL、方法、入参、返回值
2. 远端地址已回填
3. 本地补齐字段已标注 `（来自本地补齐）`
4. 所有冲突字段均有用户确认记录

### 最终交付必须包含
- 新增/更新的接口清单（接口名 + URL）
- 每个接口的数据来源（docs/<INTERNAL_API_PLATFORM> + 地址）
- 本地补齐字段摘要
- 冲突确认结果摘要（用户选择了哪种方案）

## 工具使用结束条件
- 用户明确要求跳过该 Skill
- 目标接口文档已写入 `[API]` 且冲突项已完成确认
