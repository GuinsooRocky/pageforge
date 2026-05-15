# 接口文档生成模板（gRPC 风格）

> 适用场景：[CODE_BASELINE] M6.api_style = `grpc`
> 特征：基于 protobuf 定义，rpc method 风格，binary frame，常通过 grpc-web / connect-rpc 桥接到浏览器
> 状态：占位（首次跑 gRPC 项目时按下方骨架补齐细节）

------以下是接口文档生成模板------

# RPC 名：xxx
- 例如 UserService/GetProfile

// 远端 .proto 文件路径（如有）：用户输入的 protobuf 文件路径或 buf registry 地址，否则写无

## Service：
- 例如：grpc.user.v1.UserService
## RPC 方法：
- 例如：GetProfile
## RPC 类型：unary / server-streaming / client-streaming / bidirectional
## Request message（protobuf）：
字段名、protobuf 类型（string / int32 / bool / repeated X / message Y / oneof）、tag number、含义、是否 optional（proto3）
## Response message：
字段名、protobuf 类型、tag、含义；嵌套 message 逐层展开
## 错误码：
gRPC status codes（OK / NOT_FOUND / PERMISSION_DENIED / ...）+ 业务侧 error detail（如有）

// 注意：gRPC 没有 result/data 包裹；前端通过 grpc-web / connect-web 调用时类型由 codegen 提供

------以上是接口文档生成模板------
