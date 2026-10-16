# 代码贡献与仓库健康检查

先通过 `npm ci` 安装锁文件依赖，再运行 `make ci` 与
`bash scripts/check-repo-health.sh`。健康检查使用现有 TypeScript 工具链解析
真正的导入语法；字符串与注释中的示例不属于导入。产品代码中的 Python 文件
仍会被拒绝，`parity/` 下的对照工具与 `tests/fixtures/` 下明确的测试素材除外。

源码仓库与 Issue 地址必须精确匹配项目的真实地址。
可运行 CLI 示例见 [examples](../../../examples/README.zh-CN.md)。

历史采集与已接受的记录保持原文。经过 review 的小型登记文件
`scripts/repository-health-history.json` 将具体历史问题绑定到原文件的精确
SHA256，并注明迁移后的归属或确实缺失的历史采集。每项仍输出 warning；
`--strict` 会因 warning 失败。修改原文或引入未登记问题后，普通门禁仍失败。
登记不代表缺失的历史采集曾通过，也不能豁免当前产品文件。新增的本机路径、
断链与失效 ADR 引用仍然失败。

每个发生变更的仓库分别保留 note、验证证据、中英文文档与 changelog。
合并前核对最新 head 的完整 CI 与所需真实组件验收。
[English](../../en/guide/contributing-code.md)
