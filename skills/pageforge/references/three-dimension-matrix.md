# §Q 各步在三维度下的行为对照（参考）

> 调试 / 澄清"某 step 是否对某维度敏感"时按需 Read。常规流程主 Agent 不必装入。
> 主入口：[`../SKILL.md`](../SKILL.md)

> 图例：`●` = 强敏感（核心分支判定）；`▲` = 弱敏感（仅微调输出）；`×` = 不敏感（行为与该维度无关）。

| Step | 项目成熟度敏感 | 需求范围敏感 | 复用粒度敏感 |
|---|---|---|---|
| 0 baseline+fetch（双 agent 并行） | ●（A 部分核心区分）| × | × |
| 0.5 scope-narrower（new0.0.3）| × | ●（核心，按 PRD 规模触发）| × |
| 1 clarify | ▲（合并 baseline） | × | × |
| 2 visual + map | × | × | ●（产出复用决策）|
| 3 tech | ▲ | ● | ● |
| 4 template + skeleton + assemble | × | ●（4-A/4-B/4-C 三阶段）| ●（NW-* loop 单次单文件） |
| 5 logic | × | ●（5-A/5-B/5-C 三阶段）| ● |
