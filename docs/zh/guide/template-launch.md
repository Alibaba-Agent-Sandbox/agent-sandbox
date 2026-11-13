# 部署、日志与清理

```bash
abx deploy SOURCE --name my-app --plan
abx deploy SOURCE --name my-app --yes
abx status my-app
abx logs my-app --resource api
abx delete my-app --yes
```

SOURCE 可以是目录条目、本地目录或固定 Git 引用。命名资源执行器支持 Express 模板/静态卷及精确版本的 FC3 Serving。先配置已有云身份；构建镜像还需要 Docker 和可写仓库。组件保留其原生运行时、规格与地域限制。

FC 的 build、deploy、logs、remove 使用同一个原生组件加载器。组件和 Shell 诊断接入 abx 的详细程度、quiet 与 stderr 输出，交互终端显示进度，--json 保持机器可读。多个 Serving 时通过 --resource 选择；FC 运行日志需要已配置 SLS。模板准备没有动态实例日志流，查询沙箱日志需要实际运行中的实例 ID。

资源输出引用等待生产资源就绪。本机动作按声明顺序执行；应用发布由模板脚本承接。Agents API 的 FC 资源部署不等于业务验收完成，发布脚本还需要验证候选版本。旧 Session 路由和删除前 drain 见[应用模板说明](managed-applications.md)。

执行前保存归属记录。源码消失不等于可以接管同名替代资源；recover 观察已记录身份，保留未知结果。401/403 或网络错误不能证明资源已删除。镜像、retain 卷和 FC auto 资源按保留清单处理。

[资源语义](template-workflows.md) · [构建复用](deploy-and-build.md)
