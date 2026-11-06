// Client-side CSV helpers for the roster preview. The server is the source of truth for validation;
// this only lets the pilot lead see what they are about to upload.

export const EXPECTED_COLUMNS = ["roll_no", "name", "grade", "section"] as const;
const REQUIRED = ["roll_no", "name", "grade"];

export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

export interface CsvPreview {
  header: string[];
  rows: string[][];
  total: number; // data rows (non-empty lines after header)
  missing: string[]; // required columns not found in header
  unknown: string[]; // header columns we don't expect
}

export function previewCsv(text: string, max = 8): CsvPreview {
  const lines = text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((l) => l.trim() !== "");
  const header = lines.length ? splitCsvLine(lines[0]).map((h) => h.toLowerCase()) : [];
  const data = lines.slice(1);
  return {
    header,
    rows: data.slice(0, max).map(splitCsvLine),
    total: data.length,
    missing: REQUIRED.filter((c) => !header.includes(c)),
    unknown: header.filter((h) => !(EXPECTED_COLUMNS as readonly string[]).includes(h)),
  };
}

const SAMPLE_NAMES = [
  "Aarav Kumar", "Ananya Sharma", "Ravi Yadav", "Sita Devi", "Mohit Patel",
  "Pooja Singh", "Imran Khan", "Kavya Reddy", "Rahul Meena", "Neha Gupta",
];

/** Sample roster for the teacher's own classes (5 example rows per class) so the format is obvious. */
export function sampleCsv(classes: { grade: number; section: string | null }[]) {
  const cls = classes.length ? classes : [{ grade: 5, section: "A" }];
  const rows: string[] = [EXPECTED_COLUMNS.join(",")];
  let n = 0;
  for (const c of cls) {
    for (let roll = 1; roll <= 5; roll++) {
      rows.push([roll, SAMPLE_NAMES[n++ % SAMPLE_NAMES.length], c.grade, c.section ?? ""].join(","));
    }
  }
  return rows.join("\n") + "\n";
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
