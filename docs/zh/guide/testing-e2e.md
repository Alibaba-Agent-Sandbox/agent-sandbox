# 测试与完成定义

`abx` 如何做端到端验证,以及判定一项变更"算完成"的规则。

> English version: [../../en/guide/testing-e2e.md](../../en/guide/testing-e2e.md)

## 三层验证

| 层 | 工具 | 真实组件? | 凭据 | 典型耗时 |
|---|---|---|---|---|
| 单元测试 | `make test`(vitest) | 否(mock) | 无 | 几秒 |
| 差分工具 | `node parity/diff/diff.mjs` | 否(stub 云端),但使用两个真实二进制 | 无 | 约 1 分钟 |
| 黑盒 E2E | `npm run e2e` | **是**(真实云端、真实二进制、真实文件系统) | `.env` 或环境变量 | 5 到 10 分钟 |

只有第三层才能关闭完成定义中的"E2E"一项。

## 运行 E2E 套件

```bash
cp .env.example .env            # 填入真实凭据;.env 已被 git 忽略
ABX_BIN="node dist/bin/abx.js" npm run e2e     # 先 npm run build
npm run e2e:offline                            # 无需凭据
npm run e2e:cleanup                            # 清理遗留沙箱的 dry-run janitor
```

套件与语言无关:它以隔离的 HOME、无 CI 变量、脱敏输出和可追踪的清理来运行 `ABX_BIN` 指定的任意二进制。创建的每个沙箱都会被销毁,
最后的 `leak-check` 场景会在有沙箱残留时使运行失败。套件、场景格式与环境变量见
[`e2e/README.zh-CN.md`](../../../e2e/README.zh-CN.md)。已记录的结果见 [`e2e/BASELINE.md`](../../../e2e/BASELINE.md)。

## 对比两个二进制

```bash
ABX_ORACLE=abx ABX_BIN="node dist/bin/abx.js" node parity/diff/diff.mjs --verbose
```

相同的 argv 会在两个二进制和 stub 云端上运行;比较退出码、规范化输出、写入的文件与 HTTP 流量。详见
[`parity/diff/README.zh-CN.md`](../../../parity/diff/README.zh-CN.md)。

## 凭据

真实凭据只存放在被 git 忽略的 `.env` 文件或环境变量中（`ABX_SANDBOX_API_KEY`、`ABX_SANDBOX_BASE_URL`、`ABX_SANDBOX_DOMAIN`、`ALICLOUD_ACCESS_KEY_ID`/`ALICLOUD_ACCESS_KEY_SECRET`、
`ACR_NAMESPACE`、`ABX_LLM_API_KEY`、`ABX_LLM_BASE_URL`）。绝不打印、记录或提交；套件会对捕获的所有内容脱敏。

## 完成定义

只有同时满足以下全部条件,变更才算完成:

1. 已新增/更新单元测试且通过;
2. 已针对真实组件执行 E2E;
3. 结果记录在 `.agents/evidence/verify/<date>-<topic>.md`(无密钥、无泄漏资源);
4. 在 `.agents/notes/{proposed,implemented}/<category>/<date>-<slug>.md` 有 ADR/笔记,且 `Status:` 与所在目录一致;
5. 已更新中英文文档;
6. `CHANGELOG.md` 的 `[Unreleased]` 下有条目。

若 E2E 无法运行,变更是**受阻**而不是完成。含证据与 ADR 模板的完整规则见
[`.agents/notes/DEFINITION-OF-DONE.md`](../../../.agents/notes/DEFINITION-OF-DONE.md)。
