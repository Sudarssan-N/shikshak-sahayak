"""Match spoken names to the class roster. Never creates a student; ambiguous or unknown names are asked back."""
from dataclasses import dataclass
from difflib import SequenceMatcher

from .textnorm import name_key


@dataclass
class RosterEntry:
    id: str
    roll_no: int
    name: str


@dataclass
class MatchResult:
    matched_ids: list[str]
    unresolved: list[dict]  # {"spoken": str, "candidate_ids": [str]}


def _score(spoken: str, entry: RosterEntry) -> float:
    s = name_key(spoken)
    full = name_key(entry.name)
    if not s or not full:
        return 0.0
    if s == full:
        return 1.0
    first = full.split()[0]
    if s == first:
        return 0.95
    # "Ravi K" style: first name + initial of surname
    parts = s.split()
    fparts = full.split()
    if len(parts) == 2 and len(parts[1]) == 1 and len(fparts) > 1 and parts[0] == fparts[0] \
            and fparts[-1].startswith(parts[1]):
        return 0.99
    return max(SequenceMatcher(None, s, full).ratio(), SequenceMatcher(None, s, first).ratio() * 0.93)


def match_names(spoken_names: list[str], roster: list[RosterEntry]) -> MatchResult:
    matched: list[str] = []
    unresolved: list[dict] = []
    for spoken in spoken_names:
        scored = sorted(((_score(spoken, e), e) for e in roster), key=lambda x: -x[0])
        top = [e for sc, e in scored if sc >= 0.84]
        best = scored[0][0] if scored else 0
        exactish = [e for sc, e in scored if sc >= 0.94 and sc >= best - 0.001]
        if len(exactish) == 1 or (len(top) == 1 and best >= 0.84):
            sid = (exactish or top)[0].id
            if sid not in matched:
                matched.append(sid)
        elif len(top) > 1:
            unresolved.append({"spoken": spoken, "candidate_ids": [e.id for e in top[:4]]})
        else:
            near = [e.id for sc, e in scored if sc >= 0.6][:3]
            unresolved.append({"spoken": spoken, "candidate_ids": near})
    return MatchResult(matched, unresolved)
