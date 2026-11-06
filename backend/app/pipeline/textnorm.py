"""Text normalisation for Hindi/English/code-mixed transcripts: number words → digits, rough Devanagari → Latin."""
import re

_DEVANAGARI_DIGITS = str.maketrans("०१२३४५६७८९", "0123456789")

EN_NUMS = {
    "zero": 0, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8,
    "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13, "fourteen": 14, "fifteen": 15,
    "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "thirty": 30,
    "forty": 40, "fifty": 50, "sixty": 60, "seventy": 70, "eighty": 80, "ninety": 90,
    "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6, "seventh": 7, "eighth": 8,
}

_HI_WORDS = ("शून्य एक दो तीन चार पांच छह सात आठ नौ दस ग्यारह बारह तेरह चौदह पंद्रह सोलह सत्रह अठारह उन्नीस बीस "
             "इक्कीस बाईस तेईस चौबीस पच्चीस छब्बीस सत्ताईस अट्ठाईस उनतीस तीस इकतीस बत्तीस तैंतीस चौंतीस पैंतीस "
             "छत्तीस सैंतीस अड़तीस उनतालीस चालीस इकतालीस बयालीस तैंतालीस चवालीस पैंतालीस छियालीस सैंतालीस "
             "अड़तालीस उनचास पचास").split()
HI_NUMS = {w: i for i, w in enumerate(_HI_WORDS)}
HI_NUMS.update({"पाँच": 5, "छः": 6, "छे": 6, "पहली": 1, "दूसरी": 2, "तीसरी": 3, "चौथी": 4, "पांचवी": 5,
                "पाँचवीं": 5, "पांचवीं": 5, "छठी": 6, "सातवीं": 7, "आठवीं": 8})
# romanised Hindi as ASR / typing often produces it
HI_ROMAN = {"ek": 1, "do": 2, "teen": 3, "char": 4, "chaar": 4, "paanch": 5, "panch": 5, "chhe": 6, "saat": 7,
            "aath": 8, "nau": 9, "das": 10, "gyarah": 11, "barah": 12, "terah": 13, "chaudah": 14,
            "pandrah": 15, "solah": 16, "satrah": 17, "atharah": 18, "unnis": 19, "bees": 20, "pachchis": 25,
            "pachis": 25, "tees": 30, "chalis": 40, "pachas": 50}


def words_to_digits(text: str) -> str:
    """Replace number words with digits, including English compounds like 'twenty three'."""
    text = text.translate(_DEVANAGARI_DIGITS)

    def en_compound(m: re.Match) -> str:
        return str(EN_NUMS[m.group(1).lower()] + EN_NUMS[m.group(2).lower()])

    tens = "twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety"
    units = "one|two|three|four|five|six|seven|eight|nine"
    text = re.sub(rf"\b({tens})[\s-]+({units})\b", en_compound, text, flags=re.I)

    def repl(m: re.Match) -> str:
        w = m.group(0)
        lw = w.lower()
        if lw in EN_NUMS:
            return str(EN_NUMS[lw])
        if w in HI_NUMS:
            return str(HI_NUMS[w])
        return w

    # English words: whole-word; Devanagari words: split on spaces/punctuation
    text = re.sub(r"\b[A-Za-z]+\b", lambda m: str(EN_NUMS[m.group(0).lower()]) if m.group(0).lower() in EN_NUMS
                  and m.group(0).lower() not in ("second",) else m.group(0), text)
    text = re.sub(r"[ऀ-ॣ०-ॿ]+", repl, text)  # excludes the danda (। ॥)
    # romanised Hindi only when directly next to a count keyword, to avoid "do" (verb) etc.
    text = re.sub(r"\b(" + "|".join(HI_ROMAN) + r")\b(?=\s+(?:bachche|bacche|present|absent|hazir|gair))",
                  lambda m: str(HI_ROMAN[m.group(1).lower()]), text, flags=re.I)
    return text


# --- rough transliteration, only for matching spoken Devanagari names against Latin roster names ---
_CONS = {
    "क": "k", "ख": "kh", "ग": "g", "घ": "gh", "ङ": "n", "च": "ch", "छ": "chh", "ज": "j", "झ": "jh", "ञ": "n",
    "ट": "t", "ठ": "th", "ड": "d", "ढ": "dh", "ण": "n", "त": "t", "थ": "th", "द": "d", "ध": "dh", "न": "n",
    "प": "p", "फ": "ph", "ब": "b", "भ": "bh", "म": "m", "य": "y", "र": "r", "ल": "l", "व": "v", "श": "sh",
    "ष": "sh", "स": "s", "ह": "h", "ळ": "l", "क़": "q", "ख़": "kh", "ग़": "g", "ज़": "z", "ड़": "r", "ढ़": "rh",
    "फ़": "f",
}
_VOW = {"अ": "a", "आ": "aa", "इ": "i", "ई": "ee", "उ": "u", "ऊ": "oo", "ऋ": "ri", "ए": "e", "ऐ": "ai",
        "ओ": "o", "औ": "au"}
_MATRA = {"ा": "aa", "ि": "i", "ी": "ee", "ु": "u", "ू": "oo", "ृ": "ri", "े": "e", "ै": "ai", "ो": "o",
          "ौ": "au", "ं": "n", "ँ": "n", "ः": "h"}
_VIRAMA = "्"


def translit(text: str) -> str:
    out: list[str] = []
    chars = list(text)
    for i, ch in enumerate(chars):
        nxt = chars[i + 1] if i + 1 < len(chars) else ""
        if ch in _CONS:
            out.append(_CONS[ch])
            if nxt not in _MATRA and nxt != _VIRAMA and nxt and "ऀ" <= nxt <= "ॿ":
                out.append("a")
        elif ch in _VOW:
            out.append(_VOW[ch])
        elif ch in _MATRA:
            out.append(_MATRA[ch])
        elif ch == _VIRAMA or ch == "़":
            continue
        else:
            out.append(ch)
    return "".join(out)


def name_key(name: str) -> str:
    """Phonetic-ish key: transliterate, lowercase, collapse long vowels and common spelling variants."""
    s = translit(name).lower()
    s = re.sub(r"[^a-z ]", "", s)
    for a, b in (("aa", "a"), ("ee", "i"), ("oo", "u"), ("ou", "u"), ("w", "v"), ("sh", "s"), ("ph", "f"),
                 ("th", "t"), ("dh", "d"), ("kh", "k"), ("gh", "g"), ("bh", "b"), ("chh", "ch"), ("z", "j"),
                 ("y", "i")):
        s = s.replace(a, b)
    s = re.sub(r"(.)\1+", r"\1", s)
    s = re.sub(r"a\b", "", s)  # trailing schwa: "Ravi" vs "रवि" vs "Seeta"/"Sita"
    return " ".join(s.split())
