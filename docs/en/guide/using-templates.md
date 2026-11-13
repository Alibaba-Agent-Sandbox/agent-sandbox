# Use a template

`template list` and `template info` inspect the public catalog. Copy source to customize its resources:

```bash
abx template list python
abx template info python-hello
abx template init ./hello --from Alibaba-Agent-Sandbox/awesome-templates//python-hello
abx deploy ./hello --name hello --plan
abx deploy ./hello --name hello --yes
abx status hello
```

Deploy prepares named templates/static volumes and Serving. Run the template's documented business startup separately; ordinary service templates provide `run.py`, while managed applications publish an external Gateway. Do not use a deployment name as if it were a dynamic Sandbox ID.

Repository sources accept `owner/repository//subdirectory@COMMIT`. Pin a commit for reproducibility. Private GitHub sources use configured GitHub authentication; acquiring source creates no cloud resources. A source-free managed catalog entry cannot be copied for editing.

[Authoring](authoring-templates.md) · [Build and cleanup](deploy-and-build.md) · [Managed applications](managed-applications.md)
