"""Abusive-language screening for comments, built to over-flag: a harmless comment that gets flagged only waits in the
owner's review queue, while an abusive one that slips through would be public. Hence generous matching:

  * lower-casing; accents and look-alike letters (Cyrillic, Greek) folded to plain Latin;
  * "leetspeak" undone (sh1t, $hit, @ss) and stretched letters squeezed (fuuuuck);
  * spaced-out and starred spellings caught (f u c k, f.u.c.k, f*ck, sh**);
  * words hidden inside longer ones (fuckyou, madarchod123) and split across words (bhosdi ke);
  * misspellings: one wrong, missing or extra letter (two for very long words), keeping the first letter.
To keep ordinary writing from being flooded, only the "core" part of the list gets the aggressive treatment; the rest
matches whole words only, and a short "ignore" list holds ordinary words that appear in the sources.
The list is app/data/blocklist.txt (English; Hindi in Latin and Devanagari letters; Tamil and Tanglish; threats).
"""
import re
import unicodedata
from pathlib import Path

from rapidfuzz import process
from rapidfuzz.distance import Levenshtein

DATA = Path(__file__).resolve().parent.parent / "data" / "blocklist.txt"

_HOMOGLYPH = str.maketrans({
    "а": "a", "е": "e", "о": "o", "р": "p", "с": "c", "у": "y", "х": "x", "і": "i", "ѕ": "s", "ј": "j", "ԁ": "d", "ɡ": "g",
    "ο": "o", "α": "a", "ε": "e", "ι": "i", "κ": "k", "ν": "v", "υ": "u", "ρ": "p", "τ": "t", "ı": "i", "ł": "l", "ø": "o",
    "ß": "ss", "æ": "ae", "œ": "oe", "ǀ": "l", "Ⅰ": "i",
})
_LEET = str.maketrans({"0": "o", "1": "i", "!": "i", "|": "i", "3": "e", "4": "a", "@": "a", "5": "s", "$": "s", "7": "t",
                       "+": "t", "8": "b", "9": "g", "(": "c", "€": "e", "£": "l"})

# Whole words that merely contain, or sit one letter from, a listed word.
SAFE = frozenset("""class classes classic classical classify pass passage passed passes passion passive password passwords assess assessed
assessment assist assistant assume assumed assure assured assam assamese mass massive masses bass brass glass grass harass analysis analyst
analytic analytics analyze analyse title titles titled tittle sussex essex middlesex wessex scunthorpe therapist therapists cockpit cocktail
cockatoo peacock hancock dickens dickinson bastion buttons butter butterfly button shiitake shitake kuthirai nayeem nayeema shell shelter
cumin document accumulate circumstance cucumber assassin classmate classroom bassist compass embassy ambassador carcass cassette massage
message passenger passport selection selections rejection detection protection collection direction election section correction
connection reflection inspection perfection infection introduction production reduction construction instruction
""".split())
# four-letter words rude enough to match inside a longer word (fuckyou, shithead); others match only as whole words,
# so "grape" never trips "rape"
_STRONG4 = frozenset({"fuck", "shit", "cunt", "slut", "twat", "wank"})


def fold(s: str) -> str:
    """Lower-case, drop Latin accents (but keep Indic vowel signs), map look-alike letters to Latin."""
    s = unicodedata.normalize("NFKD", s)
    s = "".join(c for c in s if not (unicodedata.combining(c) and ord(c) < 0x0900))
    return s.lower().translate(_HOMOGLYPH)


def squeeze(s: str) -> str:
    """Runs of 3 or more of one letter become 2 (fuuuuck -> fuuck)."""
    return re.sub(r"(.)\1{2,}", r"\1\1", s)


def _tokens(s: str) -> list[str]:
    """Runs of letters in any script (Indic vowel signs included). Everything else separates words."""
    out, cur = [], []
    for c in s:
        if unicodedata.category(c)[0] in "LM" or c in "‌‍":
            cur.append(c)
        elif cur:
            out.append("".join(cur)); cur = []
    if cur:
        out.append("".join(cur))
    return out


def _load():
    sections: dict[str, set[str]] = {"core": set(), "extended": set(), "ignore": set()}
    cur = "core"
    for line in DATA.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("## "):
            cur = line[3:].split()[0]
        elif line and not line.startswith("#"):
            sections[cur].add(squeeze(fold(line)))
    squash = lambda ws: {w.replace(" ", "") for w in ws}  # noqa: E731  (phrases joined, so spacing does not matter)
    ignore = squash(sections["ignore"])
    core = squash(sections["core"]) - ignore
    ext = squash(sections["extended"]) - ignore - core
    return core, ext


_CORE, _EXT = _load()
_WHOLE = frozenset(w for w in (_CORE | _EXT) if len(w) <= 40)
_INSIDE = sorted(w for w in _CORE if len(w) >= 5 or w in _STRONG4)        # may hide inside a longer word
_RUN = sorted(w for w in _CORE if len(w) >= 6)                            # may span several words
_FUZZY: dict[str, list[str]] = {}
for _w in _CORE:
    if len(_w) >= 7:
        _FUZZY.setdefault(_w[0], []).append(_w)                           # misspellings keep the first letter


def _variants(text: str) -> list[str]:
    f = fold(text)
    return [f, f.translate(_LEET)]  # as written, and with digit/symbol substitutes read as letters


def _fuzzy(t: str) -> bool:
    if len(t) < 7 or t[0] not in _FUZZY:
        return False
    cut = 2 if len(t) >= 11 else 1
    return process.extractOne(t, _FUZZY[t[0]], scorer=Levenshtein.distance, score_cutoff=cut) is not None


def _word_hit(t: str, allow_inside: bool = True) -> bool:
    if t in SAFE:
        return False
    if t in _WHOLE:
        return True
    if allow_inside and len(t) >= 4 and any(w in t for w in _INSIDE):
        return True
    return _fuzzy(t)


def _spaced_runs(toks: list[str]) -> list[str]:
    """f u c k / f.u.c.k: three or more single-letter tokens in a row, joined."""
    runs, cur = [], []
    for t in toks + [""]:
        if len(t) == 1:
            cur.append(t)
        else:
            if len(cur) >= 3:
                runs.append("".join(cur))
            cur = []
    return runs


def _starred(v: str) -> bool:
    """f*ck, sh**, b*tch: a star stands for any letter."""
    for cand in re.findall(r"[^\W\d_]*\*+[^\W\d_*]*(?:\*+[^\W\d_*]*)*", v):
        if len(cand) < 4 or cand.strip("*") == "":
            continue
        pat = re.compile("".join("." if c == "*" else re.escape(c) for c in cand))
        if any(len(w) == len(cand) and pat.fullmatch(w) for w in _WHOLE):
            return True
    return False


def looks_abusive(text: str) -> bool:
    if not text or not text.strip():
        return False
    for v in _variants(text[:4000]):
        if _starred(v):
            return True
        toks = [squeeze(t) for t in _tokens(v)]
        if not toks:
            continue
        for t in toks:
            if _word_hit(t):
                return True
        for run in _spaced_runs(toks):
            if _word_hit(run):
                return True
        for n in (2, 3):  # words split by a space: "bhosdi ke"
            for i in range(len(toks) - n + 1):
                part = toks[i:i + n]
                if any(p in SAFE for p in part):  # an ordinary word on its own side: do not glue it to its neighbour
                    continue
                j = "".join(part)
                if j in SAFE:
                    continue
                if (len(j) >= 6 and j in _WHOLE) or _fuzzy(j) or (len(j) >= 7 and any(w in j for w in _RUN)):
                    return True
    return False
