// Tesseract.js language packs. Codes match the traineddata files hosted on
// the tessdata CDN (loaded on demand by tesseract.js the first time a worker
// is created with that language). Each pack is roughly 10–25 MB and is
// cached by the browser after first download.
//
// Curated list — Tesseract supports 100+ languages, but exposing all of them
// is noise. These cover the bulk of real-world OCR demand. Add more by
// extending this list; no other code changes required.

export interface OcrLanguage {
  code: string;
  label: string;
  // Approximate size in MB of the traineddata file. Helps the UI warn
  // before kicking off a 50 MB download on first use.
  sizeMb: number;
}

export const OCR_LANGUAGES: OcrLanguage[] = [
  { code: "eng", label: "English", sizeMb: 15 },
  { code: "spa", label: "Spanish", sizeMb: 14 },
  { code: "fra", label: "French", sizeMb: 14 },
  { code: "deu", label: "German", sizeMb: 15 },
  { code: "ita", label: "Italian", sizeMb: 12 },
  { code: "por", label: "Portuguese", sizeMb: 12 },
  { code: "nld", label: "Dutch", sizeMb: 12 },
  { code: "swe", label: "Swedish", sizeMb: 10 },
  { code: "nor", label: "Norwegian", sizeMb: 10 },
  { code: "dan", label: "Danish", sizeMb: 10 },
  { code: "fin", label: "Finnish", sizeMb: 12 },
  { code: "pol", label: "Polish", sizeMb: 12 },
  { code: "ces", label: "Czech", sizeMb: 12 },
  { code: "rus", label: "Russian", sizeMb: 16 },
  { code: "ukr", label: "Ukrainian", sizeMb: 14 },
  { code: "tur", label: "Turkish", sizeMb: 12 },
  { code: "ara", label: "Arabic", sizeMb: 12 },
  { code: "heb", label: "Hebrew", sizeMb: 10 },
  { code: "hin", label: "Hindi", sizeMb: 14 },
  { code: "chi_sim", label: "Chinese (Simplified)", sizeMb: 22 },
  { code: "chi_tra", label: "Chinese (Traditional)", sizeMb: 22 },
  { code: "jpn", label: "Japanese", sizeMb: 18 },
  { code: "kor", label: "Korean", sizeMb: 16 },
  { code: "vie", label: "Vietnamese", sizeMb: 12 },
  { code: "tha", label: "Thai", sizeMb: 12 },
  { code: "ell", label: "Greek", sizeMb: 12 },
  { code: "ron", label: "Romanian", sizeMb: 12 },
  { code: "hun", label: "Hungarian", sizeMb: 12 },
  { code: "ind", label: "Indonesian", sizeMb: 10 },
];

export function getLanguageLabel(code: string): string {
  return OCR_LANGUAGES.find((l) => l.code === code)?.label ?? code;
}

// Tesseract accepts a "+"-joined string for multi-language recognition,
// e.g. "eng+spa". Order matters slightly — the primary language first
// usually yields better results.
export function toTesseractLang(codes: string[]): string {
  if (codes.length === 0) return "eng";
  return codes.join("+");
}

export function estimateDownloadMb(codes: string[]): number {
  return codes.reduce(
    (sum, c) => sum + (OCR_LANGUAGES.find((l) => l.code === c)?.sizeMb ?? 12),
    0,
  );
}
