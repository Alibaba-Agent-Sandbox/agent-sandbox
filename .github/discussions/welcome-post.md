# 👋 Welcome to Agent Sandbox Community!

Hey everyone! Welcome to the **Agent Sandbox** community — we're thrilled to have you here! 🎉

## What is Agent Sandbox?

Agent Sandbox is a CLI (`abx`; the Python SDK lives in the `python-sdk` repository) for creating, managing, and deploying cloud sandboxes for AI agents. The Python SDK's method names are E2B-shaped to ease migration; this is not an E2B-protocol drop-in.

## 🗂️ How to Use This Community

We want to keep things organized so everyone can find what they need:

| What you need | Where to go |
|---------------|-------------|
| 💡 **Feature Requests** | [Discussions → Ideas](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions/categories/ideas) — suggest new features or improvements |
| 🐛 **Bug Reports** | [Issues](https://github.com/alibaba-agent-sandbox/agent-sandbox/issues/new/choose) — report bugs using our issue templates |
| 💬 **Q&A / Help** | [Discussions → Q&A](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions/categories/q-a) — ask questions and get help |
| 🎉 **Show and Tell** | [Discussions → Show and Tell](https://github.com/alibaba-agent-sandbox/agent-sandbox/discussions/categories/show-and-tell) — share what you've built! |

## 🚀 Quick Start

```bash
pip install agent-sandbox   # Python SDK (python-sdk repository)
```

```python
from agent_sandbox import Sandbox

async def main():
    async with await Sandbox.create(template="python-base") as sb:
        result = await sb.run_code("print('Hello from sandbox!')")
        print(result.text)  # Hello from sandbox!
```

Or use the CLI:

```bash
npm install -g @agent-sandbox/cli
abx create --template python-base
abx exec <sandbox-id> "echo hello"
```

## 📚 Key Links

- 📖 **[README & Docs](https://github.com/alibaba-agent-sandbox/agent-sandbox#readme)**
- 🏗️ **[Design Document](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/docs/zh/DESIGN.md)**
- 📦 **[Community Templates](https://github.com/alibaba-agent-sandbox/awesome-templates)**
- 📝 **[Contributing Guide](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/.github/CONTRIBUTING.md)**
- 🔒 **[Security Policy](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/.github/SECURITY.md)**

## 🤝 Code of Conduct

We're committed to fostering a welcoming and inclusive environment. Please take a moment to review our [Code of Conduct](https://github.com/alibaba-agent-sandbox/agent-sandbox/blob/main/.github/CODE_OF_CONDUCT.md). Be kind, be constructive, and help us build something great together.

---

We'd love to hear what you're building with Agent Sandbox — feel free to introduce yourself and share your use case in the replies! 👇

Happy sandboxing! 🏖️
