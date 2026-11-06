import { useState } from "react";
import type { AdminTeacher, Language, RosterUploadResult } from "../../api/types";
import { Button } from "../../components/ui";
import { classList, languageLabel } from "./shared";

/** Example practice note per language. The teacher should use today's real numbers and names from their own register. */
function practiceExample(lang: Language, grade: number) {
  switch (lang) {
    case "hi":
      return `आज कक्षा ${grade} में 30 में से 28 बच्चे आए। रवि और सीमा नहीं आए। 28 बच्चों को मिड-डे मील मिला। गणित का पाठ 4 शुरू किया।`;
    case "mr":
      return `आज इयत्ता ${grade} मध्ये 30 पैकी 28 मुले हजर होती. रवी आणि सीमा गैरहजर. 28 मुलांना मध्यान्ह भोजन मिळाले. गणिताचा धडा 4 सुरू केला.`;
    case "kn":
      return `ಇಂದು ${grade}ನೇ ತರಗತಿಯಲ್ಲಿ 30 ರಲ್ಲಿ 28 ಮಕ್ಕಳು ಹಾಜರಿದ್ದರು. ರವಿ ಮತ್ತು ಸೀಮಾ ಗೈರುಹಾಜರಾಗಿದ್ದರು. 28 ಮಕ್ಕಳಿಗೆ ಬಿಸಿಯೂಟ ನೀಡಲಾಯಿತು. ಗಣಿತ ಪಾಠ 4 ಪ್ರಾರಂಭಿಸಿದೆ.`;
    default:
      return `Class ${grade} today: 28 of 30 present. Ravi and Seema absent. 28 children had the mid-day meal. Started maths lesson 4.`;
  }
}

function buildMessage(name: string, last4: string, url: string, grade: number) {
  const first = name.split(" ")[0];
  return [
    `नमस्ते ${first} जी! शिक्षक सहायक में आपका स्वागत है। अब हाज़िरी और मिड-डे मील का रिकॉर्ड एक वॉइस नोट से भरें।`,
    `1. यह लिंक खोलें: ${url}`,
    `2. अपने फ़ोन नंबर (••••${last4}) से लॉग इन करें। एक कोड आएगा, उसे डालें।`,
    `3. आपका डेटा कैसे रखा जाता है, यह पढ़ें और सहमति दें।`,
    `4. पहला अभ्यास नोट बोलें — आज के रजिस्टर की असली संख्या और नामों के साथ, जैसे:`,
    `"${practiceExample("hi", grade)}"`,
    `5. कार्ड जाँचें, ग़लती हो तो बोलकर सुधारें, फिर पुष्टि करें।`,
    ``,
    `Hello ${first}, welcome to Shikshak Sahayak — fill attendance and mid-day-meal records with one voice note.`,
    `1. Open: ${url}`,
    `2. Log in with your phone number (••••${last4}). Enter the code you receive.`,
    `3. Read how your data is kept and give consent.`,
    `4. Record a first practice note with today's real numbers and names from your register, e.g.:`,
    `"${practiceExample("en", grade)}"`,
    `5. Check the card, correct anything by speaking, then confirm.`,
  ].join("\n");
}

async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for http:// or older browsers.
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try {
      ok = document.execCommand("copy");
    } catch {
      ok = false;
    }
    ta.remove();
    return ok;
  }
}

export function DoneStep({
  teacher,
  phone,
  roster,
}: {
  teacher: AdminTeacher;
  phone: string;
  roster: RosterUploadResult | null;
}) {
  const url = window.location.origin;
  const grade = teacher.classes[0]?.grade ?? 5;
  const last4 = phone.slice(-4) || teacher.phone_last4;
  const message = buildMessage(teacher.name, last4, url, grade);
  const [copied, setCopied] = useState<"" | "ok" | "fail">("");
  const enrolled = roster ? roster.classes.reduce((n, c) => n + c.enrolled, 0) : teacher.roster_size;

  return (
    <div className="stack">
      <div className="ad-summary">
        <dl>
          <div>
            <dt>Teacher</dt>
            <dd>{teacher.name}</dd>
          </div>
          <div>
            <dt>Login phone</dt>
            <dd className="num">••••{last4}</dd>
          </div>
          <div>
            <dt>Language</dt>
            <dd>{languageLabel(teacher.language)}</dd>
          </div>
          <div>
            <dt>Classes</dt>
            <dd className="num">{classList(teacher.classes)}</dd>
          </div>
          <div>
            <dt>Students on roster</dt>
            <dd className="num">{enrolled ? enrolled : <span className="ad-pill ad-pill-warn">None yet</span>}</dd>
          </div>
        </dl>
        {!enrolled ? (
          <p className="ad-warn">
            No roster yet: names in voice notes can’t be matched until you upload one from the teacher list.
          </p>
        ) : null}
      </div>

      <div>
        <h3>Tell the teacher</h3>
        <ol className="ad-howto">
          <li>
            Open <a href={url}>{url.replace(/^https?:\/\//, "")}</a> on their phone (add it to the home screen).
          </li>
          <li>
            Log in with their phone number <span className="num">••••{last4}</span> and the code they receive.
          </li>
          <li>Read the data note in their language and agree. Consent shows as “Given” in your list.</li>
          <li>
            Record a <strong>practice note</strong> using today’s real register, then check the card and confirm. That
            confirmed record completes onboarding.
          </li>
        </ol>
        <figure className="ad-example">
          <figcaption className="muted ad-small">Example practice note ({languageLabel(teacher.language)})</figcaption>
          <blockquote lang={teacher.language}>{practiceExample(teacher.language, grade)}</blockquote>
        </figure>
      </div>

      <div className="stack">
        <h3>WhatsApp message (Hindi + English)</h3>
        <label htmlFor="ad-msg" className="sr-only">
          Message to send the teacher
        </label>
        <textarea id="ad-msg" className="input ad-msg" readOnly rows={10} value={message} onFocus={(e) => e.target.select()} />
        <div className="row">
          <Button
            type="button"
            onClick={async () => {
              setCopied((await copyText(message)) ? "ok" : "fail");
              setTimeout(() => setCopied(""), 4000);
            }}
          >
            Copy message
          </Button>
          <a
            className="btn btn-secondary"
            href={`https://wa.me/91${phone}?text=${encodeURIComponent(message)}`}
            target="_blank"
            rel="noreferrer"
          >
            Open in WhatsApp
          </a>
          <span aria-live="polite" className={copied === "fail" ? "ad-inline-err" : "ad-copied"}>
            {copied === "ok" ? "Copied — paste it into WhatsApp." : copied === "fail" ? "Couldn’t copy. Select the text and copy it." : ""}
          </span>
        </div>
      </div>
    </div>
  );
}
