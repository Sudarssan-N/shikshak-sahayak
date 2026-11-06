"""Deterministic extractor: a rule-based parser for Hindi / English / code-mixed daily notes.

It is the fallback when no LLM is configured or the LLM output fails validation, and the reference the LLM is
evaluated against. It only ever writes values it can point to in the text; everything else stays null."""
import re
from datetime import date, timedelta

from ..schemas import ClassDay, ExtractedRecord, LessonProgress
from .textnorm import words_to_digits

MONTHS = {m: i + 1 for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"])}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})
MONTHS.update({"sept": 9, "जनवरी": 1, "फरवरी": 2, "मार्च": 3, "अप्रैल": 4, "मई": 5, "जून": 6, "जुलाई": 7,
               "अगस्त": 8, "सितंबर": 9, "अक्टूबर": 10, "नवंबर": 11, "दिसंबर": 12})
WEEKDAYS = {"monday": 0, "tuesday": 1, "wednesday": 2, "thursday": 3, "friday": 4, "saturday": 5, "sunday": 6,
            "सोमवार": 0, "मंगलवार": 1, "बुधवार": 2, "गुरुवार": 3, "शुक्रवार": 4, "शनिवार": 5, "रविवार": 6,
            "somvar": 0, "mangalvar": 1, "budhvar": 2, "guruvar": 3, "shukravar": 4, "shanivar": 5}

KW_PRESENT = r"(?:present|hazir|haazir|haajir|उपस्थित|हाज़िर|हाजिर|आए|आये|aaye|aye)"
KW_ABSENT = r"(?:absent|गैरहाजिर|ग़ैरहाज़िर|गैर हाजिर|अनुपस्थित|नहीं आए|नहीं आये|nahi aaye|nahin aaye|gair ?hazir)"
KW_KIDS = r"(?:students?|children|kids|bachche|bacche|बच्चे|बच्चों|छात्र)?"
KW_MEAL = r"(?:mid[\s-]?day[\s-]?meals?|meals?|mdm|bhojan|भोजन|मध्याह्न भोजन|खाना|khana|thali|थाली)"
KW_LESSON = r"(?:lesson|chapter|paath|path|पाठ|अध्याय)"
KW_DONE = r"(?:finished|completed|complete|done|over|पूरा|पूर्ण|समाप्त|khatam|ख़त्म|खत्म)"
KW_START = r"(?:started|start|began|begin|शुरू|shuru|आरंभ)"
SUBJECTS = {"math": "Maths", "maths": "Maths", "mathematics": "Maths", "गणित": "Maths", "english": "English",
            "अंग्रेजी": "English", "hindi": "Hindi", "हिंदी": "Hindi", "evs": "EVS", "पर्यावरण": "EVS",
            "science": "Science", "विज्ञान": "Science", "marathi": "Marathi", "kannada": "Kannada"}
NAME_STOP = {"and", "aur", "और", "were", "was", "are", "is", "the", "today", "class", "students", "student",
             "children", "absent", "present", "meal", "meals", "served", "lesson", "they", "them", "also", "only",
             "थे", "है", "हैं", "भी", "आज", "कक्षा", "बच्चे", "नहीं", "आए", "रहे", "these", "names", "name", "sir",
             "madam", "ji", "no", "one", "none", "nobody", "everyone", "all"}

CLASS_MARK = re.compile(
    r"(?:\b(?:class|kaksha|std|standard|grade)\s*[-:]?\s*(\d)\s*(?:st|nd|rd|th)?\b(?:\s*[-]?\s*([A-Da-d])\b)?"
    r"|(?:कक्षा|क्लास)\s*(\d)"
    r"|\b(\d)\s*(?:st|nd|rd|th)?\s*(?:class|कक्षा|क्लास|std))",
    re.I)


def _date_markers(text: str, today: date) -> list[tuple[int, date]]:
    out: list[tuple[int, date]] = []
    low = text.lower()
    for m in re.finditer(r"\b(today|aaj)\b|आज", low):
        out.append((m.start(), today))
    for m in re.finditer(r"\b(yesterday|kal)\b|कल", low):
        out.append((m.start(), today - timedelta(days=1)))
    for m in re.finditer(r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([a-z]+|[ऀ-ॿ]+)", low):
        mon = MONTHS.get(m.group(2))
        if mon:
            d = _safe_date(today.year, mon, int(m.group(1)))
            if d and d > today + timedelta(days=31):
                d = _safe_date(today.year - 1, mon, int(m.group(1)))
            if d:
                out.append((m.start(), d))
    for m in re.finditer(r"(\d{1,2})\s*(?:तारीख|tarikh|tareekh|tarik)", low):
        d = _safe_date(today.year, today.month, int(m.group(1)))
        if d:
            out.append((m.start(), d))
    for word, wd in WEEKDAYS.items():
        for m in re.finditer(rf"(?<![\wऀ-ॿ]){word}(?![\wऀ-ॿ])", low):
            back = (today.weekday() - wd) % 7
            out.append((m.start(), today - timedelta(days=back)))
    return sorted(out)


def _safe_date(y: int, m: int, d: int) -> date | None:
    try:
        return date(y, m, d)
    except ValueError:
        return None


def _num(pattern: str, text: str) -> int | None:
    m = re.search(pattern, text, re.I)
    return int(m.group(1)) if m else None


def _clean_names(chunk: str) -> list[str]:
    chunk = re.split(rf"{KW_MEAL}|{KW_LESSON}|{KW_PRESENT}|\bclass\b|कक्षा|[.;।\n]", chunk, maxsplit=1, flags=re.I)[0]
    parts = re.split(r",|\band\b|\baur\b|और|&|\s{2,}", chunk, flags=re.I)
    names: list[str] = []
    for p in parts:
        words = [w for w in re.findall(r"[A-Za-zऀ-ॿ]+", p) if w.lower() not in NAME_STOP]
        if 1 <= len(words) <= 3 and not any(ch.isdigit() for ch in p):
            names.append(" ".join(words))
        elif len(words) > 3:  # "Ravi Sita Arjun Meena" spoken without commas
            names.extend(words)
    return names


def _absent_names(text: str) -> list[str]:
    # A) "absent: Ravi, Sita" / "4 absent - Ravi, Sita" / "absent were Ravi and Sita"
    m = re.search(rf"{KW_ABSENT}\s*(?:\d+)?\s*{KW_KIDS}\s*(?:were|are|was|is|:|-|–|,|थे|हैं)?\s*(.+)", text, re.I)
    if m:
        names = _clean_names(m.group(1))
        if names:
            return names
    # B) "Ravi and Sita were absent" / "रवि और सीता नहीं आए"
    m = re.search(rf"([^.;।\n:]+?)\s+(?:were|was|are|is|थे|रहे|हैं)?\s*{KW_ABSENT}", text, re.I)
    if m:
        chunk = re.split(rf"\d+|{KW_PRESENT}|,\s*(?=[^,]*\d)", m.group(1), flags=re.I)[-1]
        return _clean_names(chunk)
    return []


def _lessons(text: str) -> list[LessonProgress]:
    out: list[LessonProgress] = []
    for m in re.finditer(rf"{KW_LESSON}\s*(?:no\.?|number|नंबर|संख्या)?\s*(\d+)", text, re.I):
        window = text[max(0, m.start() - 40): m.end() + 40]
        status = "completed" if re.search(KW_DONE, window, re.I) else "started" if re.search(KW_START, window, re.I) else None
        subject = None
        for k, v in SUBJECTS.items():
            if re.search(rf"(?<![\wऀ-ॿ]){k}(?![\wऀ-ॿ])", window, re.I):
                subject = v
                break
        out.append(LessonProgress(subject=subject, lesson_ref=f"lesson {m.group(1)}", status=status))
    return out


def _first(*vals):
    return next((v for v in vals if v is not None), None)


def _fields(text: str) -> tuple[ClassDay, dict[str, float]]:
    conf: dict[str, float] = {}
    present = _first(_num(rf"(\d+)\s*{KW_KIDS}\s*(?:were|are|हैं|थे)?\s*{KW_PRESENT}", text),
                     _num(rf"{KW_PRESENT}\s*(?:were|are|was|:|-|है|हैं|थे)?\s*(\d+)", text))
    absent_count = _first(_num(rf"(\d+)\s*{KW_KIDS}\s*(?:were|are|हैं|थे)?\s*{KW_ABSENT}", text),
                          _num(rf"{KW_ABSENT}\s*(?:were|are|:|-)?\s*(\d+)", text))
    meals = _first(_num(rf"{KW_MEAL}\D{{0,25}}?(\d+)", text),
                   _num(rf"(\d+)\s*{KW_KIDS}\s*(?:ne)?\s*{KW_MEAL}", text))
    names = _absent_names(text)
    for k, v in (("present", present), ("absent_count", absent_count), ("meals_served", meals)):
        if v is not None:
            conf[k] = 0.9
    if names:
        conf["absent_names"] = 0.85
    return ClassDay(present=present, absent_count=absent_count, absent_names=names, meals_served=meals,
                    lessons=_lessons(text)), conf


def parse(transcript: str, today: date, default_date: date | None = None) -> ExtractedRecord:
    text = words_to_digits(transcript)
    markers: list[tuple[int, str, object]] = [(p, "date", d) for p, d in _date_markers(text, today)]
    for m in CLASS_MARK.finditer(text):
        g = next(x for x in m.groups()[:1] + m.groups()[2:] if x)
        sec = m.group(2).upper() if m.group(2) else None
        markers.append((m.start(), "class", (int(g), sec)))
    markers.sort(key=lambda x: x[0])

    groups: dict[tuple, list[str]] = {}
    order: list[tuple] = []
    bounds = [0] + [p for p, _, _ in markers] + [len(text)]
    # text before the first marker belongs to the first class / date mentioned
    first_class = next((v for _, t, v in markers if t == "class"), None)
    first_date = next((v for _, t, v in markers if t == "date"), default_date)
    cur_date = first_date
    cur_class: tuple[int, str | None] | None = None
    for i in range(len(bounds) - 1):
        if i > 0:
            _, kind, val = markers[i - 1]
            if kind == "date":
                cur_date = val  # type: ignore[assignment]
            else:
                cur_class = val  # type: ignore[assignment]
        chunk = text[bounds[i]: bounds[i + 1]]
        key = (cur_date if i > 0 else first_date, cur_class if cur_class else first_class)
        if key not in groups:
            groups[key] = []
            order.append(key)
        groups[key].append(chunk)

    classes: list[ClassDay] = []
    conf_all: dict[str, float] = {}
    for key in order:
        d, cls = key
        cd, conf = _fields(" ".join(groups[key]))
        if cd.present is None and cd.meals_served is None and not cd.absent_names and cd.absent_count is None \
                and not cd.lessons:
            continue  # chunk with no facts (e.g. only "today")
        cd.grade, cd.section = (cls if cls else (None, None))
        cd.record_date = d
        classes.append(cd)
        for k, v in conf.items():
            conf_all[k] = min(conf_all.get(k, 1.0), v)
    rec = ExtractedRecord(record_date=first_date, classes=classes, field_confidence=conf_all)
    missing = []
    if not classes:
        missing.append("classes")
    for c in classes:
        if c.present is None and "present" not in missing:
            missing.append("present")
        if c.meals_served is None and "meals_served" not in missing:
            missing.append("meals_served")
    rec.missing_fields = missing
    return rec
