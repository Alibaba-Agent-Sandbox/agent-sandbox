---
title: "Welcome to Agent Sandbox Community!"
labels: []
---

👋 **Welcome to the Agent Sandbox community!**

We're excited to have you here. Agent Sandbox is a CLI (`abx`; the Python SDK lives in the `python-sdk` repository) for creating, managing, and deploying cloud sandboxes for AI agents. The Python SDK's method names are E2B-shaped to ease migration; this is not an E2B-protocol drop-in.

## 🗂️ Community Guide

Please use the right channel for your needs:

| Need | Where |
|------|-------|
| 💡 **Feature Request** | [Discussions → Ideas](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions/categories/ideas) |
| 🐛 **Bug Report** | [Issues](https://github.com/alibaba-agent-sandbox/agent-sandbox/issues/new/choose) |
| 💬 **Questions & Help** | [Discussions → Q&A](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions/categories/q-a) |
| 🎉 **Show and Tell** | [Discussions → Show and Tell](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions/categories/show-and-tell) |

## 🚀 Quick Start

```bash
npm install -g @agent-sandbox/cli
abx create --template python-base
```

Or use the Python SDK (`pip install agent-sandbox`, in the `python-sdk` repository):

```python
from agent_sandbox import Sandbox

async def main():
    async with await Sandbox.create(template="python-base") as sb:
        result = await sb.run_code("print('Hello from sandbox!')")
        print(result.text)
```

## 📚 Resources

- 📖 [Documentation](https://github.com/alibaba-agent-sandbox/agent-sandbox#readme)
- 🏗️ [Design Doc](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/zh/DESIGN.md)
- 📦 [Community Templates](https://github.com/alibaba-agent-sandbox/awesome-templates)
- 📝 [Contributing Guide](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/.github/CONTRIBUTING.md)

## 🤝 Code of Conduct

Please be respectful and constructive. We follow the [Contributor Covenant Code of Conduct](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/.github/CODE_OF_CONDUCT.md).

---

Happy sandboxing! 🎉
