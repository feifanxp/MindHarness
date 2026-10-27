#!/usr/bin/env python3
"""Capture MindRoom formatted_body renders of tool-marker bodies for copy tests.

Writes src/app/mindroom/messages/__fixtures__/backendToolMarkerBodies.json by
running the backend's own markdown_to_html over each case. Run from this repo,
pinning the backend's locked renderer versions:

    uv run --no-project --with markdown-it-py==4.0.0 \\
        --with mdit-py-plugins==0.5.0 --with pygments==2.20.0 \\
        python scripts/capture-backend-tool-marker-bodies.py ../mindroom \\
        src/app/mindroom/messages/__fixtures__/backendToolMarkerBodies.json

then format the output with Prettier and note the backend commit in
messageCopyText.test.ts.
"""

import importlib.util
import json
import sys
from pathlib import Path


def load_message_builder(backend: Path):
    path = backend / "src/mindroom/matrix/message_builder.py"
    spec = importlib.util.spec_from_file_location("message_builder", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def marker(name: str, index: int, pending: bool = False) -> str:
    return f"🔧 `{name}` [{index}]" + (" ⏳" if pending else "")


def spaced(text: str) -> str:
    return f"\n\n{text}\n\n"


ENTITY_MARKER = "&#x1F527; `x` [1]"
CODE_EXAMPLE = "Example:\n\n```\n" + marker("x", 1) + "\n```\n\nAnswer"

CASES = {
    "reply with one tool call": (
        "Let me check." + spaced(marker("search_web", 1)) + "It is sunny."
    ),
    "grouped and pending tool calls": (
        "Let me check."
        + spaced(marker("search_web", 1))
        + marker("read_file", 2, True)
        + "\n\nIt is sunny."
    ),
    "leading and trailing tool calls": (
        marker("a", 1) + "\n\nAnswer" + spaced(marker("b", 2)).rstrip("\n") + "\n"
    ),
    "tool calls only": marker("shell", 1, True),
    "LaTeX around a tool call": (
        "$$\nE = mc^2\n$$" + spaced(marker("calculator", 1)) + "Inline $x^2$ stays."
    ),
    "list-marker line inside a fence": (
        "```\n- ```\n" + marker("inside", 1) + "\n```"
        + spaced(marker("search", 2)) + "Answer"
    ),
    "quote-marker line inside a fence": (
        "```markdown\n> ```\n" + marker("inside", 1) + "\n```"
        + spaced(marker("search", 2)) + "Answer"
    ),
    "indented fence-like line inside a fence": (
        "```text\n    ```\n" + marker("inside", 1) + "\n```"
        + spaced(marker("search", 2)) + "Answer"
    ),
    "indented code block containing a fence": (
        "Example:\n\n    ```\n    code" + spaced(marker("search", 1)) + "Answer"
    ),
    "fence closed by the end of its block quote": (
        "> ```\n> code" + spaced(marker("search", 1)) + "Answer"
    ),
    "fence closed by the end of its list item": (
        "- ```\n  code" + spaced(marker("search", 1)) + "Answer"
    ),
    "unclosed fence while streaming": (
        "```py\nx = 1" + spaced(marker("inside", 1)) + "y = 2"
    ),
    "tool call inside display math": (
        "$$\nx = 1" + spaced(marker("calc", 1)) + "y\n$$"
        + spaced(marker("search", 2)) + "Answer"
    ),
    "tool call after an escaped HTML comment opener": (
        "<!--" + spaced(marker("search", 1)) + "Answer"
    ),
    "tool call inside an allowed HTML block": (
        "<details>\n" + marker("inside", 1) + "\n</details>"
        + spaced(marker("search", 2)) + "Answer"
    ),
    "unspaced tool call inside a paragraph": (
        "text\n" + marker("search", 1) + "\nmore"
    ),
    "tool call as a list item": "- " + marker("search", 1),
    "code example repeating a real tool call": (
        "Markers look like:\n\n```\n" + marker("search", 1) + "\n```"
        + spaced(marker("search", 1)) + "Answer"
    ),
    "inline mention of a real tool call": (
        "I used " + marker("search", 1) + " before."
        + spaced(marker("search", 1)) + "Answer"
    ),
    "CRLF line endings": (
        "A\r\n\r\n" + marker("search", 1) + "\r\n\r\nB\r\n"
    ),
    "tool call inside a block quote": (
        "> " + marker("x", 1) + spaced(marker("y", 2)) + "Answer"
    ),
    "tool call between list items": "- a\n- " + marker("x", 1) + "\n- b",
    "tool call inside a heading": (
        "# " + marker("x", 1) + spaced(marker("y", 2)) + "Answer"
    ),
    "unspaced consecutive tool calls": (
        marker("a", 1) + "\n" + marker("b", 2) + "\n\nAnswer"
    ),
    "tool call inside a raw div": (
        "<div>" + spaced(marker("x", 1)) + "</div>\n\nAnswer"
    ),
    "double-backtick marker with a canonical copy in code": (
        "🔧 ``x`` [1]\n\n" + CODE_EXAMPLE
    ),
    "HTML-code marker with a canonical copy in code": (
        "🔧 <code>x</code> [1]\n\n" + CODE_EXAMPLE
    ),
    "escaped-bracket marker with a canonical copy in code": (
        "🔧 `x` \\[1\\]\n\n" + CODE_EXAMPLE
    ),
    "entity-bracket marker with a canonical copy in code": (
        "🔧 `x` &#91;1&#93;\n\n" + CODE_EXAMPLE
    ),
    "tool call inside a details block": (
        "<details>" + spaced(marker("x", 1)) + "</details>\n\nAnswer"
    ),
    "tool call followed by text on the same line": (
        marker("x", 1) + " extra words\n\nAnswer"
    ),
    "reference link definition sharing a marker index": (
        "🔧 ``search_web`` \\[1\\]\n" + marker("search_web", 1)
        + "\n\n[1]: https://weather.example\n"
    ),
    "reference-style link in a reply with a tool call": (
        "Let me search." + spaced(marker("search_web", 1))
        + "It is sunny [1].\n\n[1]: https://weather.example\n"
    ),
    "table row with a pipe in the tool name": (
        "🔧 ``a|b`` \\[1\\]\n\n| h | k |\n| - | - |\n" + marker("a|b", 1)
        + "\n\nAnswer"
    ),
    "tool name containing another index": (
        "🔧 ``a [2] b`` \\[1\\]\n\nNote 🔧 see [1].\n\n```\n"
        + marker("a [2] b", 1) + "\n```\n\nAnswer"
    ),
    "tool name containing an earlier index": (
        marker("x", 1) + "\n\nMiddle." + spaced(marker("a [1] b", 2)).rstrip("\n")
    ),
    "wide gap before the pending marker": (
        "Intro\n\n🔧 `x` [1]  ⏳\n\nAnswer"
    ),
    # An entity renders a tool block without a body 🔧, so only the rendered-🔧
    # count notices the canonical line shown as text next to it.
    "entity tool block beside a marker in indented code": (
        ENTITY_MARKER + "\n\n    " + marker("x", 1)
    ),
    "entity tool block beside a marker in display math": (
        "$$\n" + marker("x", 1) + "\n$$\n\n" + ENTITY_MARKER
    ),
    "entity tool block beside a marker in a code span": (
        "``a\n" + marker("x", 1) + "\nb``\n\n" + ENTITY_MARKER
    ),
    "entity tool block beside a marker after a comment opener": (
        "<!--\n" + marker("x", 1) + "\n-->\n\n" + ENTITY_MARKER
    ),
}


def main() -> None:
    backend, output = Path(sys.argv[1]), Path(sys.argv[2])
    builder = load_message_builder(backend)
    rendered = {
        name: {"body": body, "formatted_body": builder.markdown_to_html(body)}
        for name, body in CASES.items()
    }
    output.write_text(json.dumps(rendered, ensure_ascii=False, indent=2) + "\n")


if __name__ == "__main__":
    main()
