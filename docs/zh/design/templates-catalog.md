# 模板目录与源码生命周期

模板仓库拥有清单和规范，Registry 负责聚合并发布发现数据，CLI 消费目录条目和源码引用。目录可见不等于运行资格，也不证明 Provider 支持。

`template list`、`template info` 查询可复用目录。`template init --from` 复制源码，不调用云端或执行运行时校验，因此作者可以先查看尚未受运行器支持的新清单。覆盖目录须明确确认或使用 `--force`，复制不会隐式构建或部署。

`deploy` 解析目录名称、Git 源码或本地项目，再校验受支持契约。Sandbox 模板声明服务与就绪条件；启动器准备 Provider 模板、创建一个 Sandbox 并启动完整服务集合。托管应用按显式 `application.type: agents-api` 选择，不根据 HTTP 服务存在与否或规范版本号猜测。

模板拥有仓库提供小型 profile 规范化契约，只在字段省略时补充固定机制值。显式冲突值和 null 保留给校验器拒绝；不自动补入凭据、地域、资源规格或业务策略。CLI 与 Registry 消费方固定契约来源并验证相同 fixtures。

作者可用 `template build` 准备产物，再通过部署的 `--build` 复用。复用前检查源码与目标身份；删除部署保留借用的作者产物，清理产物要求没有活跃消费者。Provider 原生模板 ID 是平台管理引用，不能普遍宣称其在所有后端都不可修改。

`template publish --tag VERSION` 要求干净且已提交的仓库、已有 GitHub remote 和新 tag，返回固定 commit 的源码引用。目录投稿仍走拥有仓库的贡献流程。

参阅[使用模板](../guide/using-templates.md)、[创作模板](../guide/authoring-templates.md)、[Provider 操作](../guide/provider-commands.md)与[模板规范](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/docs/template-spec.zh-CN.md)。
