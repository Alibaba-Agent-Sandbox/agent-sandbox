"""Regenerate ``golden.json``: prompts rendered by the original Python modules.

Usage (``PYTHONPATH`` must expose the original ``easy_sandbox`` package, which must be the pristine v0.2.0 source):

    python3 render_golden.py > golden.json

``tests/test_agent/*.test.ts`` compare the TypeScript renderers with these strings. The only intentional difference
is the template-guide install hint (``easy-sandbox`` -> ``easy-sandbox-server``), applied in the tests (see
``parity/KNOWN-GAPS.md``).
"""

from __future__ import annotations

import json
import sys

from easy_sandbox.agent import adopt, clarify, codegen
from easy_sandbox.agent import template_guide as tg

ASCII_DESC = "Run a Python data analysis job"
TRICKY_DESC = "  返回 {'a': {b}} 作为 json \u3000\n含 $dollar 与 %s \\n  "

ANSWERS = [
    "用 Flask，端口 8080",
    "  随便  ",
    "都行\n",
    "{braces} and $dollar",
    "",
    "   ",
]
ASKED = [
    [],
    ["要用什么框架？"],
    ["要用什么框架？", "{need} 哪个端口?", "第三个问题"],
]


def staged(copied: list[str]) -> adopt.StagedProject:
    from pathlib import Path

    return adopt.StagedProject(
        staging_dir=Path("/unused"), manifest={}, copied=tuple(copied), excluded={}, total_bytes=0
    )


def qwen_golden() -> dict:
    import tempfile
    from pathlib import Path

    from easy_sandbox.agent import qwen_code as qc
    from easy_sandbox.models.errors import QwenCodeCredentialError

    res: dict = {}

    outputs = [
        "",
        "plain text",
        "   ",
        "[]",
        "{}",
        json.dumps([{"type": "result", "result": "all done", "is_error": False}]),
        json.dumps([{"type": "result", "result": "boom", "is_error": True}]),
        json.dumps([{"type": "assistant"}, {"type": "result", "result": "first"}, {"type": "result", "result": "last"}]),
        json.dumps([{"type": "result", "result": {"a": 1, "b": [1, 2.5, None, "é"]}}]),
        json.dumps([{"type": "result", "result": 7}]),
        json.dumps([{"type": "result", "result": None}]),
        json.dumps([{"type": "result"}]),
        json.dumps([{"type": "result", "result": '{"completeness": 0.5}'}]),
        json.dumps([{"type": "result", "result": '{"completeness": 0.5}', "structured_result": {"completeness": 0.9}}]),
        json.dumps([{"type": "result", "result": "x", "structured_result": None}]),
        json.dumps([{"type": "result", "result": "[1, 2]"}]),
        json.dumps([{"type": "result", "result": "text", "session_id": "sid-1", "is_error": 0}]),
        json.dumps([{"type": "result", "result": "text", "session_id": 5, "is_error": "yes"}]),
        json.dumps([{"type": "result", "result": "text", "is_error": ""}]),
        json.dumps({"type": "result", "result": "single object"}),
        json.dumps({"type": "other"}),
        json.dumps([1, "a", None, {"type": "result", "result": "mixed"}]),
        "log line\n" + json.dumps({"type": "result", "result": "from a line"}) + "\ntrailer",
        json.dumps({"type": "system"}) + "\n" + json.dumps({"type": "result", "result": "ndjson", "session_id": "s"}) + "\n",
        "\ufeff" + json.dumps([{"type": "result", "result": "bom"}]),
        "[{broken json",
        json.dumps([{"type": "result", "result": "中文 \u2028 ok"}], ensure_ascii=True),
        json.dumps([{"type": "result", "result": "中文", "is_error": False}], ensure_ascii=False),
        json.dumps([{"type": "result", "result": {"nested": {"deep": [True, False, None]}}}], ensure_ascii=False),
        json.dumps([{"type": "result", "result": 1.5}]),
        json.dumps([{"type": "result", "result": True}]),
        json.dumps([{"type": "result", "result": [1, {"k": "v"}]}]),
    ]
    res["parse_output"] = []
    for text in outputs:
        t, e, st, sid = qc._parse_headless_output(text)
        res["parse_output"].append({"stdout": text, "result": [t, e, st, sid]})

    texts = [
        "", "  hello   world  ", "a\tb\nc", "\x1b[31mred\x1b[0m text", "\x1b]0;title\x07after", "x" * 160, "x" * 161,
        "y" * 400, "中" * 200, "tab\x00nul\x7f", "\u3000wide\u3000space", "emoji \U0001F600 " * 30, "line1\nline2\r\nline3",
    ]
    res["one_line"] = []
    for text in texts:
        for limit in (160, 10, 60, 1, 2):
            res["one_line"].append({"text": text, "limit": limit, "result": qc._one_line(text, limit)})

    cmd_cases = []
    for binary in ("/usr/local/bin/qwen", "qwen.cmd", "C:\\x\\qwen.BAT", "/opt/q.exe", "weird name/qwen"):
        for windows in (False, True):
            for kw in (
                {},
                {"max_session_turns": 30},
                {"max_session_turns": 0},
                {"session_id": "sid"},
                {"resume": "rid"},
                {"session_id": "sid", "resume": "rid"},
                {"json_schema": {"type": "object", "properties": {"q": {"type": "string", "description": "中文 \"quoted\""}}}},
                {"json_schema": "@/tmp/schema.json"},
                {"stream": True},
                {"stream": True, "max_session_turns": 3, "resume": "rid", "json_schema": {"a": [1, 2]}},
                {"session_id": ""},
                {"resume": ""},
            ):
                import os as _os
                _os.environ["COMSPEC"] = "cmd.exe"
                argv = qc._build_headless_command(Path(binary), "p\u4e2d 'quote' \"dq\"", windows=windows, **kw)
                cmd_cases.append({"binary": binary, "windows": windows, "kw": kw, "argv": argv})
    res["command"] = cmd_cases

    res["target"] = [
        {"system": sy, "machine": ma, "result": qc.detect_standalone_target(system=sy, machine=ma)}
        for sy in ("Darwin", "darwin", " Linux ", "Windows", "WINDOWS", "Windows_NT", "win32", "cygwin", "msys", "MSYS", "FreeBSD", "", "SunOS", "Java")
        for ma in ("arm64", "ARM64", "aarch64", "AARCH64", "x86_64", "AMD64", "amd64", "x64", "X64", "i386", "i686", "riscv64", "armv7l", "", " arm64 ", "x86")
    ]
    res["asset"] = {t: qc.standalone_asset_name(t) for t in ("darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "win-x64")}
    res["urls"] = {t: qc.standalone_download_urls(t) for t in ("darwin-arm64", "linux-x64", "win-x64")}
    res["install_command"] = {"posix": qc.official_install_command(windows=False), "windows": qc.official_install_command(windows=True)}
    res["sha256sums"] = [
        {"text": t, "result": qc._parse_sha256sums(t)}
        for t in (
            "",
            "{} a.tar.gz\n".format("a" * 64),
            "{} *b.zip\n{} c\n".format("B" * 64, "c" * 64),
            "{}  spaced name.tar.gz\n".format("d" * 64),
            "short  file\n{}  \n".format("e" * 64),
            "{}  x\r\n{}  y\r\n".format("f" * 64, "0" * 64),
            "{}  x\n{}  x\n".format("1" * 64, "2" * 64),
            "{} file extra words\n".format("3" * 64),
            "{}\tfile\n".format("4" * 64),
            "{} *\n".format("5" * 64),
            "{}  \u4e2d\u6587.tar.gz\n".format("6" * 64),
            "{}  a\n{}  b".format("7" * 64, "8" * 64),
            "{}  ../x\n".format("9" * 64),
            "{}  a\x0bb\n".format("a" * 64),
        )
    ]

    env = {
        "PATH": "/bin", "HOME": "/h", "LC_ALL": "C", "LC_CTYPE": "x", "XDG_DATA_HOME": "/d", "OPENAI_API_KEY": "k", "ALICLOUD_ACCESS_KEY_ID": "no",
        "E2B_API_KEY": "no", "GITHUB_TOKEN": "no", "AWS_SECRET_ACCESS_KEY": "no", "http_proxy": "p", "HTTPS_PROXY": "q", "ACR_PASSWORD": "no",
        "SYSTEMROOT": "C:\\Windows", "NODE_EXTRA_CA_CERTS": "/c", "DASHSCOPE_API_KEY": "d", "BAILIAN_CODING_PLAN_API_KEY": "b", "LANG": "C.UTF-8", "lc_lower": "x", "XDG": "x", "": "empty-key",
    }
    res["scrub"] = {"env": env, "result": qc.scrubbed_environ(env)}

    creds = []
    with tempfile.TemporaryDirectory() as tmp:
        base = Path(tmp)
        cases = [
            {"kw": {"stored_api_key": "sk-stored", "llm_api_key": "sk-llm"}},
            {"kw": {"stored_api_key": "", "llm_api_key": "sk-llm", "stored_base_url": "", "stored_model": ""}},
            {"kw": {"stored_api_key": "sk", "stored_base_url": "https://example.test/v1", "stored_model": "m"}},
            {"kw": {}, "environ": {"OPENAI_API_KEY": "sk-env"}},
            {"kw": {}, "environ": {"DASHSCOPE_API_KEY": "sk-dash"}},
            {"kw": {}, "environ": {"BAILIAN_CODING_PLAN_API_KEY": "sk-bail"}},
            {"kw": {}, "environ": {"OPENAI_API_KEY": "", "DASHSCOPE_API_KEY": "sk-dash"}},
            {"kw": {}, "environ": {"DASHSCOPE_API_KEY": "d", "OPENAI_API_KEY": "o"}},
            {"kw": {}, "environ": {}, "settings": json.dumps({"modelProviders": {"openai": {}}})},
            {"kw": {}, "environ": {}, "settings": json.dumps({"modelProviders": {}})},
            {"kw": {}, "environ": {}, "settings": json.dumps({"env": {"X": "1"}})},
            {"kw": {}, "environ": {}, "settings": json.dumps({"env": {}, "modelProviders": []})},
            {"kw": {}, "environ": {}, "settings": "[1]"},
            {"kw": {}, "environ": {}, "settings": "not json"},
            {"kw": {}, "environ": {}, "settings": json.dumps({"modelProviders": "x"})},
            {"kw": {}, "environ": {}},
        ]
        for i, c in enumerate(cases):
            settings = base / f"s{i}.json"
            if "settings" in c:
                settings.write_text(c["settings"], encoding="utf-8")
            try:
                r = qc.resolve_qwen_code_credentials(environ=c.get("environ"), settings_path=settings, **c["kw"]) if "environ" in c else qc.resolve_qwen_code_credentials(environ={}, settings_path=settings, **c["kw"])
                creds.append({"kw": c["kw"], "environ": c.get("environ", {}), "settings": c.get("settings"),
                              "result": {"source": r.source, "api_key": r.api_key, "base_url": r.base_url, "model": r.model, "env": r.as_env()}})
            except QwenCodeCredentialError as exc:
                creds.append({"kw": c["kw"], "environ": c.get("environ", {}), "settings": c.get("settings"),
                              "error": {"message": exc.message, "suggestion": exc.suggestion, "str": str(exc), "code": exc.code}})
    res["credentials"] = creds

    # Activity feed event sequences: render() after every event + the return value of _feed_stream_event.
    def te(t):
        return {"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": t}}}

    def tool_start(n):
        return {"type": "stream_event", "event": {"type": "content_block_start", "content_block": {"type": "tool_use", "name": n, "input": {}}}}

    def tool_done(n):
        return {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": n, "input": {"x": "secret"}}]}}

    seqs = [
        [te("first li"), te("ne\nsecond line\nthi"), te("rd\n")],
        [te("checking docs"), tool_done("web_fetch"), tool_done("web_fetch"), te("after"), tool_start("write_file"), tool_done("write_file")],
        [{"type": "system", "subtype": "init"}, te("Hel"), te("lo \x1b[31mwor\x1b[0m\nld"), {"type": "assistant", "message": {"content": [{"type": "tool_use", "name": "run_shell_command"}]}}],
        [te("x" * 1000 + "\n\x1b[31mend")] + [te(f"line {n}\n") for n in range(50)],
        [te("a" * 500), te("b" * 170)],
        [tool_start("n" * 100), tool_start("n" * 100), te("t"), tool_start("n" * 100)],
        [{"type": "stream_event", "event": {"delta": {"type": "thinking_delta", "thinking": "secret"}}}, {"type": "wat"}, "not a dict", None, 5, [],
         {"type": "stream_event"}, {"type": "stream_event", "event": []}, {"type": "stream_event", "event": {"delta": {"type": "text_delta", "text": 5}}},
         {"type": "assistant", "message": {"content": "x"}}, {"type": "assistant", "message": []}, {"type": "assistant", "message": {"content": [1, {"type": "tool_use", "name": ""}, {"type": "tool_use", "name": 5}]}},
         {"type": "system"}],
        [te("\n\n\n"), te("   \n"), te("中文\n"), te("é" * 200)],
        [tool_done("a"), tool_done("a"), te("x\n"), tool_done("a")],
        [te("partial"), tool_done("tool"), tool_done("tool"), te(""), tool_done("tool")],
    ]
    res["feed"] = []
    for seq in seqs:
        feed = qc._ActivityFeed()
        steps = []
        for ev in seq:
            changed = qc._feed_stream_event(ev, feed)
            steps.append({"event": ev, "changed": changed, "render": feed.render()})
        res["feed"].append(steps)
    return res


def main() -> None:
    out: dict = {}
    out["guide_create"] = tg.build_template_guide("create")
    out["guide_adopt"] = tg.build_template_guide("adopt")
    out["reference_commands_py"] = tg.REFERENCE_COMMANDS_PY
    out["template_guide"] = tg.TEMPLATE_GUIDE
    out["required_template_files"] = list(tg.REQUIRED_TEMPLATE_FILES)

    out["codegen"] = [
        {"description": d, "name": "ebx-nl-sandbox-abc123", "prompt": codegen.build_codegen_prompt(d, "ebx-nl-sandbox-abc123")}
        for d in (ASCII_DESC, TRICKY_DESC, "x", "用 playwright 截图")
    ]

    cases = [
        (None, "my-app", []),
        ("", "my-app", ["Dockerfile"]),
        ("   ", "my-app", ["Dockerfile", "commands.py", "template.yaml"]),
        ("  use port 8080 and {braces}\n", "app-2", ["Dockerfile"]),
    ]
    adopts = []
    for hint, name, existing in cases:
        for copied in ([], ["app.py"], [f"src/f{i}.py" for i in range(200)], [f"src/f{i}.py" for i in range(201)], [f"d/f{i}.txt" for i in range(450)]):
            adopts.append(
                {
                    "hint": hint,
                    "name": name,
                    "existing": existing,
                    "copied": copied,
                    "prompt": adopt.build_adopt_prompt(staged(copied), hint=hint, template_name=name, existing=existing),
                }
            )
    out["adopt"] = adopts
    out["generated_dockerignore"] = adopt.GENERATED_DOCKERIGNORE

    out["clarify"] = {
        "research": [{"description": d, "prompt": clarify.research_prompt(d)} for d in (ASCII_DESC, TRICKY_DESC, "")],
        "assessment": [{"description": d, "prompt": clarify.assessment_prompt(d)} for d in (ASCII_DESC, TRICKY_DESC, "")],
        "answer": [
            {"answer": a, "asked": asked, "prompt": clarify.answer_prompt(a, asked)} for a in ANSWERS for asked in ASKED
        ],
        "is_delegation": [{"answer": a, "result": clarify.is_delegation_answer(a)} for a in ANSWERS + [
            "你决定", "你看着办", "不知道", "随便", "无所谓", "都可以", "i don't know", "up to you", "whatever", "  Whatever  ",
            "你决定吧，我不挑", "随便弄弄", "我不知道端口", "no preference", "any",
        ]],
    }
    out["qwen"] = qwen_golden()
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
