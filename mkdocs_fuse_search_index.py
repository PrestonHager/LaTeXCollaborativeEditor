"""MkDocs hook: emit Fuse.js corpus from Material's Lunr search index."""

from __future__ import annotations

import html
import json
import os
import re
from typing import Any

_TAG_RE = re.compile(r"<[^>]+>")
_WS_RE = re.compile(r"\s+")


def _strip_html_to_text(raw: str) -> str:
    plain = _TAG_RE.sub(" ", raw)
    plain = html.unescape(plain)
    return _WS_RE.sub(" ", plain).strip()


def on_post_build(config: dict[str, Any]) -> None:
    site_dir = config["site_dir"]
    src = os.path.join(site_dir, "search", "search_index.json")
    if not os.path.isfile(src):
        return
    with open(src, encoding="utf-8") as f:
        data = json.load(f)
    docs = data.get("docs") or []
    fuse_docs: list[dict[str, str]] = []
    for doc in docs:
        loc = doc.get("location") or ""
        if loc == "search/":
            continue
        title = doc.get("title") or ""
        raw_text = doc.get("text") or ""
        text = _strip_html_to_text(raw_text)
        url = "../" + loc
        fuse_docs.append({"title": title, "content": text, "url": url})
    out = os.path.join(site_dir, "search_index.json")
    with open(out, "w", encoding="utf-8") as f:
        json.dump(fuse_docs, f, indent=2)
        f.write("\n")
