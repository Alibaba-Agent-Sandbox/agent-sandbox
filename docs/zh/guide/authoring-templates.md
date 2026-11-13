# 编写与发布模板

模板是可复用源码。先创建或复制项目，再修改资源配置，构建、部署或发布。

```bash
abx template init ./my-template --template python
abx template init ./my-copy --from owner/repo//template@COMMIT
abx template init ./my-template --prompt "一个 Python 数据分析服务"
abx template init --adopt ./app --dry-run
```

`--from` 复制源码；`--prompt` 和 `--adopt` 使用配置的编码模型。生成或替换前应检查候选文件，自动化需要 --yes，覆盖已有模板需要 --force。源码包含 template.yaml、Dockerfile、业务代码与 README，具体结构见[资源配置](template-workflows.md)。

```bash
abx template build ./my-template --yes
abx deploy --build BUILD_FILE --name my-app --yes
abx status my-app
```

构建准备 Sandbox 模板和静态卷，执行声明的 Serving 构建动作，不部署 Serving、不创建动态实例。构建记录默认在 .abx，--out 可选其他未占用文件。记录保留资源归属与源码摘要；复用时源码目录必须存在且内容未改变，原生组件构建文件仍在项目中。修改源码后重新构建。无需单独复用时直接 `abx deploy ./my-template --name my-app --yes`。

业务服务通过自己的 SDK、HTTP 或模板提供的 run.py 运行。模板部署不会隐式启动业务沙箱。

提交源码到已有 GitHub remote 后发布：

```bash
git add template.yaml Dockerfile README.md
git commit -m "feat: add analysis template"
abx template publish . --tag v1.0.0 --yes
```

发布创建固定源码版本并返回提交引用，不部署应用或自动添加目录条目。Git 使用已有认证。已指向其他提交的远端 tag 不能复用。目录投稿遵循[模板仓库贡献指南](https://github.com/Alibaba-Agent-Sandbox/awesome-templates/blob/main/CONTRIBUTING.zh-CN.md)。

删除应用使用 `abx delete my-app --yes`；借用的独立构建保留，删除其全部消费者后再 `abx template build --clean BUILD_FILE --yes`。需要保留的卷、已有借用资源和镜像按清理结果处理。
