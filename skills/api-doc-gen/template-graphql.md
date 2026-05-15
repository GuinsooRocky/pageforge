# 接口文档生成模板（GraphQL 风格）

> 适用场景：[CODE_BASELINE] M6.api_style = `graphql`
> 特征：schema-first，operation 分 Query / Mutation / Subscription，强类型 SDL
> 状态：占位（首次跑 GraphQL 项目时按下方骨架补齐细节）

------以下是接口文档生成模板------

# Operation 名：xxx
- 例如 GetUserProfile

// 远端 schema 文档地址（如有）：用户输入的 GraphQL schema explorer / playground 地址，否则写无

## Operation 类型：Query / Mutation / Subscription
## Endpoint URL：
- 例如：/api/graphql
## 请求 SDL（变量 + 选择集）：
```graphql
query GetUserProfile($userId: ID!) {
  user(id: $userId) {
    id
    name
    email
  }
}
```
## 变量（$variables）：
变量名、GraphQL 类型（如 ID! / String / Int!）、是否必传、含义
## Response（基于 SDL）：
返回字段树，标注每个字段类型、可空性、含义；nested object 逐层展开

// 注意：GraphQL response 默认包在 `{ data: ... }` 里，error 在 `{ errors: [...] }`；只展开 data 下字段

------以上是接口文档生成模板------
