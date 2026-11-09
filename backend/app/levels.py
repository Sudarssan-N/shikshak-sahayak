"""Monthly reading and maths levels per child (ASER levels), said or tapped by the teacher, and Teaching-at-the-
Right-Level groups built from them. Deterministic: the parser looks for level words and roster names, never guesses
a name, and returns what it could not match so the teacher can fix it.

Reading: beginner < letter < word < paragraph < story      Maths: beginner < num_1_9 < num_10_99 < subtraction < division
"""
import re
from dataclasses import dataclass, field

from .pipeline.roster_match import RosterEntry, match_names
from .pipeline.textnorm import words_to_digits

READING = ["beginner", "letter", "word", "paragraph", "story"]
MATHS = ["beginner", "num_1_9", "num_10_99", "subtraction", "division"]
READING_LABEL = {"beginner": "Beginner", "letter": "Letters", "word": "Words", "paragraph": "Paragraph",
                 "story": "Story"}
MATHS_LABEL = {"beginner": "Beginner", "num_1_9": "Numbers 1–9", "num_10_99": "Numbers 10–99",
               "subtraction": "Subtraction", "division": "Division"}
LOW_READING = {"beginner", "letter"}  # combined with absence, raises a child's follow-up priority

# Phrases → a single marker token. Longest phrases first so "1 to 9" wins over "1". Hindi, romanised Hindi, English.
_PHRASES: list[tuple[str, str]] = [
    (r"10\s*(?:to|se|-|–|से)\s*99|(?:two|do|दो|2)[\s-]*(?:digits?|ank|अंक(?:ों)?)", "#M_num_10_99"),
    (r"1\s*(?:to|se|-|–|से)\s*9|(?:one|ek|एक|1)[\s-]*(?:digits?|ank|अंक)", "#M_num_1_9"),
    (r"kuch\s+nahi(?:n)?|कुछ\s+नहीं|nothing|beginner|शुरुआती|shuruati", "#X_beginner"),
    (r"stor(?:y|ies)|kahani(?:yan)?|कहानी", "#R_story"),
    (r"paragraph|para|anuchchhed|अनुच्छेद|पैराग्राफ|पैरा", "#R_paragraph"),
    (r"words?|shabd|शब्द", "#R_word"),
    (r"letters?|akshar|अक्षर|alphabets?|वर्ण", "#R_letter"),
    (r"division|divide|bhag|भाग", "#M_division"),
    (r"subtraction|subtract|minus|ghata(?:na|v)|घटाना|घटाव", "#M_subtraction"),
]
_FILLER = {"reads", "read", "can", "level", "is", "at", "and", "aur", "और", "maths", "math", "ganit", "गणित",
           "reading", "padhna", "पढ़ना", "padh", "पढ़", "leti", "leta", "लेता", "लेती", "हैं", "है", "hai", "tak",
           "तक", "पर", "par", "class", "कक्षा", "the", "in", "can't", "cannot", "not", "kar", "कर", "sakta",
           "sakti", "सकता", "सकती", "do", "does", "solve", "solves", "karta", "karti", "करता", "करती", "करते",
           "ko", "को", "ki", "की", "ka", "का", "she", "he", "they", "their", "her", "his", "also", "bhi", "भी"}


@dataclass
class Parsed:
    items: list[dict] = field(default_factory=list)  # {student_id, reading, maths}
    unmatched: list[dict] = field(default_factory=list)  # {spoken, reading, maths}


def _markers(text: str) -> str:
    t = words_to_digits(text.lower())
    for pat, tok in _PHRASES:
        t = re.sub(rf"(?<![\wऀ-ॿ]){pat}(?![\wऀ-ॿ])", f" {tok} ", t)
    return re.sub(r"[,;।.|]+", " , ", t)


def parse(text: str, roster: list[RosterEntry]) -> Parsed:
    """'Meena story subtraction, Ravi letter 1 to 9' → levels per matched child. A name followed by level words is one
    entry; a comma or the next name starts the next."""
    tokens = _markers(text).split()
    entries: list[tuple[list[str], list[str]]] = []
    name: list[str] = []
    levels: list[str] = []
    for tok in tokens + [","]:
        if tok.startswith("#"):
            levels.append(tok)
        elif tok == ",":
            if name or levels:
                entries.append((name, levels))
            name, levels = [], []
        elif tok in _FILLER:
            continue
        else:
            if levels:  # a new name after level words: close the previous child
                entries.append((name, levels))
                name, levels = [], []
            name.append(tok)
    out = Parsed()
    seen: dict[str, dict] = {}
    for name_toks, lv in entries:
        if not name_toks or not lv:
            continue
        reading = maths = None
        for tok in lv:
            kind, val = tok[1], tok[3:]
            if kind == "R":
                reading = val
            elif kind == "M":
                maths = val
            elif reading is None:  # "beginner" fills reading first, then maths
                reading = val
            else:
                maths = val
        spoken = " ".join(name_toks)
        m = match_names([spoken], roster)
        if len(m.matched_ids) == 1:
            sid = m.matched_ids[0]
            item = seen.setdefault(sid, {"student_id": sid, "reading": None, "maths": None})
            item["reading"] = reading or item["reading"]
            item["maths"] = maths or item["maths"]
        else:
            out.unmatched.append({"spoken": spoken, "reading": reading, "maths": maths})
    out.items = list(seen.values())
    return out


def groups(rows: list[dict]) -> dict:
    """TaRL groups: children who share a reading (or maths) level learn together."""
    out = {"reading": [], "maths": []}
    for kind, order, label in (("reading", READING, READING_LABEL), ("maths", MATHS, MATHS_LABEL)):
        for lv in order:
            kids = [r for r in rows if r.get(kind) == lv]
            if kids:
                out[kind].append({"level": lv, "label": label[lv], "count": len(kids),
                                  "children": [{"student_id": k["student_id"], "name": k["name"],
                                                "roll_no": k["roll_no"]} for k in kids]})
    return out
