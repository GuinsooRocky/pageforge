# 接口文档生成模板（tRPC 风格）

> 适用场景：[CODE_BASELINE] M6.api_style = `trpc`
> 特征：procedure-based RPC，无 HTTP 动词概念，schema 由 Zod 等定义，input/output 直接是类型化对象
> 状态：占位（首次跑 tRPC 项目时按下方骨架补齐细节）

------以下是接口文档生成模板------

# Procedure 名：xxx
- 例如 character.getProfile

// 远端文档地址（如有）：用户输入的远端 procedure 文档地址，否则写无

## Router 路径：
- 例如：character / message / user
## 调用类型：query / mutation / subscription
## Input schema（Zod）：
字段名、类型（z.string() / z.number() / z.enum() / z.object() 等）、是否可选、含义、约束（min/max/regex）
## Output schema：
返回字段名、类型、含义、约束；嵌套对象逐层展开
## 副作用 / Context 依赖：
（如果 mutation：是否写库 / 是否触发 webhook / 是否需要 session ctx）

// 注意：tRPC 没有 result/data 包裹，类型即结构

------以上是接口文档生成模板------
