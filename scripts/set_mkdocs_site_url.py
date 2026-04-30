#!/usr/bin/env python3
"""Rewrite `site_url` in mkdocs.yml from DOCS_SITE_URL (CI). Keeps mkdocs.yml as plain YAML for schema/IDE tools."""
from __future__ import annotations

import os
import pathlib
import re
import sys


def main() -> int:
    url = os.environ.get("DOCS_SITE_URL", "").strip()
    if not url:
        return 0
    if not url.endswith("/"):
        url += "/"
    if any(c in url for c in ('"', "\\", "\n", "\r")):
        print("set_mkdocs_site_url: URL contains unsupported characters for YAML string", file=sys.stderr)
        return 1

    root = pathlib.Path(__file__).resolve().parent.parent
    path = root / "mkdocs.yml"
    text = path.read_text(encoding="utf-8")
    replacement = f'site_url: "{url}"'
    new_text, n = re.subn(
        r"^[ \t]*site_url:.*$",
        replacement,
        text,
        count=1,
        flags=re.MULTILINE,
    )
    if n != 1:
        print(f"set_mkdocs_site_url: expected exactly one site_url line in mkdocs.yml, got {n}", file=sys.stderr)
        return 1
    path.write_text(new_text, encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
