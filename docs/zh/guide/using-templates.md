# 使用模板

template list/info 查看公共目录。需要定制时先复制源码：

```bash
abx template list python
abx template info python-hello
abx template init ./hello --from Alibaba-Agent-Sandbox/awesome-templates//python-hello
abx deploy ./hello --name hello --plan
abx deploy ./hello --name hello --yes
abx status hello
```

部署准备命名模板、静态卷和 Serving。业务服务按模板文档启动；普通服务模板提供 run.py，托管应用发布外置 Gateway。应用部署名称不等于动态沙箱实例 ID。

源码支持 owner/repository//subdirectory@COMMIT，固定提交便于复现。私有 GitHub 源使用已有 GitHub 认证；获取源码不创建云资源。没有源码的托管目录条目不能复制编辑。

[编写模板](authoring-templates.md) · [构建和清理](deploy-and-build.md) · [托管应用](managed-applications.md)
