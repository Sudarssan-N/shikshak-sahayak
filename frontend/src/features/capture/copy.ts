// Copy and small helpers for the capture flow (login, welcome, record).
import { ApiError } from "../../api/client";
import type { Language } from "../../api/types";

/** BCP-47 tag for `lang=` attributes so screen readers and fonts pick the right script. */
export const LANG_TAG: Record<Language, string> = { en: "en-IN", hi: "hi", mr: "mr", kn: "kn" };

/** An example daily note, in the teacher's language, using one of their own classes. */
export function exampleNote(lang: Language, grade = 3): string {
  switch (lang) {
    case "hi":
      return `आज कक्षा ${grade} में 23 बच्चे आए, रवि और सीता नहीं आए, 25 बच्चों ने खाना खाया, पाठ 7 पूरा हुआ।`;
    case "mr":
      return `आज इयत्ता ${grade} मध्ये 23 मुले हजर, रवी आणि सीता गैरहजर, 25 मुलांनी जेवण घेतले, धडा 7 पूर्ण झाला.`;
    case "kn":
      return `ಇಂದು ${grade}ನೇ ತರಗತಿಯಲ್ಲಿ 23 ಮಕ್ಕಳು ಹಾಜರು, ರವಿ ಮತ್ತು ಸೀತಾ ಗೈರು, 25 ಊಟ ನೀಡಲಾಯಿತು, ಪಾಠ 7 ಮುಗಿಯಿತು.`;
    default:
      return `Today Class ${grade}, 23 present, Ravi and Sita absent, 25 meals served, finished lesson 7.`;
  }
}

/** Example spoken correction, shown in the "Fix by voice" panel. */
export function exampleFix(lang: Language): string {
  if (lang === "hi") return "नहीं, 24 बच्चे आए थे, और खाना 24 को मिला।";
  return "No, 24 were present, and 24 meals.";
}

export const CONSENT = {
  en: {
    title: "Before we start",
    lines: [
      "We keep your class lists (student names), what you said as text, and the records you confirm.",
      "Your voice recording is deleted after it is turned into text, always within 24 hours.",
      "Your head teacher sees the class list and the times you mark login and logout. Children’s attendance, meals and voice notes stay with you.",
      "Location is read only when you mark login, logout or confirm a class record, and only to check the school area. The phone does not follow you through the day.",
      "You can delete everything at any time from the Me tab.",
    ],
    agree: "I agree",
    toggle: "हिंदी में पढ़ें",
  },
  hi: {
    title: "शुरू करने से पहले",
    lines: [
      "हम आपकी कक्षा की सूची (बच्चों के नाम), आपकी बात का लिखित रूप, और आपके पक्के किए हुए रिकॉर्ड रखते हैं।",
      "आपकी आवाज़ की रिकॉर्डिंग लिखित रूप बनने के बाद मिटा दी जाती है, हमेशा 24 घंटे के अंदर।",
      "आपके प्रधान शिक्षक कक्षा की सूची और आपके लॉगिन-लॉगआउट का समय देख सकते हैं। बच्चों की हाजिरी, भोजन और आवाज़ की नोट सिर्फ़ आपके पास रहती हैं।",
      "जगह सिर्फ़ उसी समय पढ़ी जाती है जब आप लॉगिन, लॉगआउट या कक्षा का रिकॉर्ड पक्का करते हैं, और सिर्फ़ स्कूल के इलाके की जाँच के लिए। फ़ोन दिन भर आपको फ़ॉलो नहीं करता।",
      "आप कभी भी 'मैं' (Me) टैब से सब कुछ मिटा सकते हैं।",
    ],
    agree: "मैं सहमत हूँ",
    toggle: "Read in English",
  },
} as const;

/** Turn any thrown value into a sentence a teacher can act on. */
export function friendlyError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return "Your login has expired. Please log in again.";
    if (e.status === 413) return "That recording is too long. Please keep it under 90 seconds.";
    if (e.status >= 500) return "The server had a problem. Please try again in a minute.";
    return e.message;
  }
  if (e instanceof TypeError) return "No internet connection right now. Your note is kept on this phone — try again when you have signal.";
  return e instanceof Error ? e.message : String(e);
}

// ---- dates (local time, YYYY-MM-DD) ----

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
export const todayIso = () => isoDay(new Date());
export function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return isoDay(d);
}

export function mmss(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
