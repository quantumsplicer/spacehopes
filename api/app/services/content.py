"""Post body handling. Bodies are TipTap/ProseMirror JSON; we whitelist the structure, sanitise every string
and extract plain text for search and excerpts."""
import re
import unicodedata

import nh3

MAX_NODES = 3000
BLOCKS = {"paragraph", "heading", "pullQuote", "divider", "drawing", "image", "gallery", "youtube"}
MARKS = {"bold", "italic", "link"}
YT = re.compile(r"^[A-Za-z0-9_-]{11}$")


def clean(s, n=2000) -> str:
    return nh3.clean(str(s or ""), tags=set()).replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">")[:n]


def _inline(nodes, counter) -> list:
    out = []
    for n in nodes or []:
        counter[0] += 1
        if counter[0] > MAX_NODES:
            raise ValueError("Document too large")
        if n.get("type") == "text" and n.get("text"):
            node = {"type": "text", "text": clean(n["text"], 20000)}
            marks = []
            for m in n.get("marks") or []:
                t = m.get("type")
                if t in ("bold", "italic"):
                    marks.append({"type": t})
                elif t == "link":
                    href = str((m.get("attrs") or {}).get("href", ""))
                    if re.match(r"^https?://", href):
                        marks.append({"type": "link", "attrs": {"href": href[:500], "rel": "noopener noreferrer nofollow", "target": "_blank"}})
            if marks:
                node["marks"] = marks
            out.append(node)
        elif n.get("type") == "hardBreak":
            out.append({"type": "hardBreak"})
    return out


def normalize_body(doc: dict | None) -> dict:
    counter = [0]
    out = []
    for n in (doc or {}).get("content") or []:
        counter[0] += 1
        t = n.get("type")
        a = n.get("attrs") or {}
        if t == "paragraph":
            out.append({"type": "paragraph", "content": _inline(n.get("content"), counter)})
        elif t == "heading":
            out.append({"type": "heading", "attrs": {"level": 3 if a.get("level") == 3 else 2}, "content": _inline(n.get("content"), counter)})
        elif t == "pullQuote":
            out.append({"type": "pullQuote", "content": _inline(n.get("content"), counter)})
        elif t == "divider":
            out.append({"type": "divider"})
        elif t in ("image", "drawing"):
            if isinstance(a.get("mediaId"), int):
                out.append({"type": t, "attrs": {"mediaId": a["mediaId"], "wide": bool(a.get("wide")),
                                                  "caption": clean(a.get("caption"), 300), "alt": clean(a.get("alt"), 300)}})
        elif t == "gallery":
            items = [{"mediaId": i["mediaId"], "alt": clean(i.get("alt"), 300), "caption": clean(i.get("caption"), 300)}
                     for i in (a.get("items") or [])[:12] if isinstance(i, dict) and isinstance(i.get("mediaId"), int)]
            if items:
                out.append({"type": "gallery", "attrs": {"items": items, "caption": clean(a.get("caption"), 300)}})
        elif t == "youtube":
            vid = str(a.get("videoId", ""))
            if YT.match(vid):
                out.append({"type": "youtube", "attrs": {"videoId": vid, "caption": clean(a.get("caption"), 300)}})
        if counter[0] > MAX_NODES:
            raise ValueError("Document too large")
    return {"type": "doc", "content": out}


def media_ids(body: dict) -> list[int]:
    ids: list[int] = []
    for n in body.get("content", []):
        a = n.get("attrs") or {}
        if n["type"] in ("image", "drawing"):
            ids.append(a["mediaId"])
        elif n["type"] == "gallery":
            ids += [i["mediaId"] for i in a["items"]]
    return ids


def _text_of(nodes) -> str:
    return "".join(n.get("text", " " if n.get("type") == "hardBreak" else "") for n in nodes or [])


def plain_text(body: dict) -> str:
    parts = []
    for n in body.get("content", []):
        a = n.get("attrs") or {}
        if n["type"] in ("paragraph", "heading", "pullQuote"):
            parts.append(_text_of(n.get("content")))
        elif n["type"] in ("image", "drawing", "youtube"):
            parts += [a.get("caption", ""), a.get("alt", "")]
        elif n["type"] == "gallery":
            parts += [a.get("caption", "")] + [i.get("alt", "") + " " + i.get("caption", "") for i in a["items"]]
    return "\n".join(p for p in parts if p).strip()


def lead_text(body: dict) -> str:
    """Text of the first non-empty paragraph (a thought's whole text)."""
    for n in body.get("content", []):
        if n["type"] == "paragraph" and _text_of(n.get("content")).strip():
            return _text_of(n.get("content")).strip()
    return ""


def make_excerpt(body: dict, n=180) -> str:
    t = lead_text(body)
    if len(t) <= n:
        return t
    return t[:n].rsplit(" ", 1)[0].rstrip(",;:") + "…"


def read_minutes(text: str) -> int:
    return max(1, round(len(text.split()) / 220))


def slugify(s: str) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:80] or "post"


def missing_alt(body: dict) -> int:
    n = 0
    for b in body.get("content", []):
        a = b.get("attrs") or {}
        if b["type"] in ("image", "drawing") and not a.get("alt", "").strip():
            n += 1
        elif b["type"] == "gallery":
            n += sum(1 for i in a["items"] if not i.get("alt", "").strip())
    return n
