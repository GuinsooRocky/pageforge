# 接口文档生成模板（REST 风格）

> 适用场景：[CODE_BASELINE] M6.api_style = `rest`
> 特征：基于 HTTP 动词（GET/POST/PUT/DELETE）+ URL path + JSON body/response 的传统 RESTful API

------以下是接口文档生成模板------

# 接口名：xxx
- 例如 home

// 远端 <INTERNAL_API_PLATFORM>/doc 地址：如果用户输入了远端 <INTERNAL_API_PLATFORM>/doc 地址，则把输入的地址回填到这里，否则写无

## 接口功能：一句话总结描述
## 接口 Url：
- 例如：/webapi/live/revenue/operation/activity/sendGift/home
## 请求方法：GET/POST
## 请求入参：
参数名、参数类型、参数介绍（带枚举的话可列一下不同枚举场景）、是否必传
## 返回值：
返回参数名、参数类型、参数介绍（带枚举的话可列一下不同枚举场景）、是否必传

// 注意如果外层参数是 result、data，只需要获取 data 下方的内容作为返回值

------以上是接口文档生成模板------
