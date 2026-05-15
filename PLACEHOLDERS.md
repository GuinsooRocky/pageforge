# 占位符词典（用于本套 agg 流水线的去具体化）

本目录下所有 Skill / Agent / Doc 中已用以下占位符替换原项目特定 token，方便讨论改造时不被原业务术语干扰。

| 占位符 | 原始含义 | 用途 |
|--------|--------|------|
| `<INTERNAL_API_PLATFORM>` | 公司内部 API 管理平台 | 提供"按 apiId 查询接口入参/出参/枚举"的统一接口元信息平台 |
| `<MCP_API_LOOKUP>` | 上述平台的 MCP 工具调用名 | 用于在 skill 里通过 apiId 拉接口元数据 |
| `<DOC_PARSE_MCP>` | 公司内部在线文档解析 MCP 服务 | 提供 docs-parse 等接口，从在线 PRD URL 拉文档全文 |
| `<INTERNAL_DOC_URL>` | 公司内部在线 PRD/技术文档 URL | 由用户输入，作为 PRD 远端来源 |
| `<UI_LIB>` | 项目自带的内部 UI 组件库 | 提供 PageAdaptor / PageHeader 等页面壳组件，以及业务通用组件 |
| `<UI_LIB_BASE>` | UI 库基础组件入口（原 `@xxx/base`） | 对应 PageAdaptor / PageHeader 的 import 来源 |
| `<UI_LIB_ACTIONS>` | UI 库的 actions 模块（原 `@xxx/actions`） | 提供 request 等数据请求封装 |
| `project-rule.md` | 团队代码规范文件 | 路径/尺寸/颜色/z-index/字体等约束的总入口（原文件名带项目特定前缀） |
| `<EXAMPLE_MODULE>` | 模块名示例 | 原本是节日/送礼类活动短周期页面的具体名（如 horse-gift / valentine） |
| `<APP_NAME>` | 应用根目录名 | 项目应用的根目录名 |
| `<EXAMPLE_PROJECT>` | 工程示例顶层目录 | 原本是带年月后缀的活动工程名 |
| `<EXCLUDED_DOMAIN_CATEGORIES>` | 项目特定的"与当前页面无关"内容类别清单 | 用于在原始 PRD 沉淀时过滤噪音；原始清单是项目特定的几类内容 |
