export interface FontMatch {
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: string;
  matched: boolean;
}

/**
 * Translate a PDF internal font name (PostScript name from the font
 * dictionary, e.g. `Helvetica-Bold`, `TimesNewRomanPSMT`,
 * `AAAAAB+Inter-SemiBold`) into a real CSS font stack the editor can render
 * with. PDFs embed subsets with a six-letter `AAAAAA+` prefix — we strip it
 * before matching so subset fonts hit the same branch as their base font.
 */
export function matchPdfFont(rawName: string): FontMatch {
  // Strip PDF subset prefix (e.g. "AAAAAB+TimesNewRomanPS-BoldMT").
  const name = rawName.trim().replace(/^[A-Z]{6}\+/, "");
  const lower = name.toLowerCase();

  const hasBold = /bold|black|heavy|extrabold|semibold|demibold|800|900/i.test(name);
  const hasItalic = /italic|oblique/i.test(name);

  // 1. Helvetica / Arial Family (Sans-Serif)
  if (/helvetica|arial|liberationsans|nimbussans|^sans/i.test(name)) {
    return {
      fontFamily: "Arial, Helvetica, sans-serif",
      fontWeight: hasBold ? "bold" : "normal",
      fontStyle: hasItalic ? "italic" : "normal",
      matched: true,
    };
  }

  // 2. Times New Roman Family (Serif)
  if (/times|tinos|liberationserif|nimbusroman|^serif/i.test(name)) {
    return {
      fontFamily: '"Times New Roman", Times, serif',
      fontWeight: hasBold ? "bold" : "normal",
      fontStyle: hasItalic ? "italic" : "normal",
      matched: true,
    };
  }

  // 3. Courier Family (Monospace)
  if (/courier|cousine|liberationmono|nimbusmono|consolas|^mono/i.test(name)) {
    return {
      fontFamily: '"Courier New", Courier, monospace',
      fontWeight: hasBold ? "bold" : "normal",
      fontStyle: hasItalic ? "italic" : "normal",
      matched: true,
    };
  }

  // 4. Modern Google Fonts (Catch-all). Match any of the 10 toolbar fonts
  //    whose token appears in the PostScript name — covers spellings like
  //    `Inter-SemiBold`, `OpenSans-Italic`, `SourceCodePro-Regular`.
  const googleMap: { token: RegExp; family: string }[] = [
    { token: /opensans/i,       family: '"Open Sans", sans-serif' },
    { token: /sourcecodepro/i,  family: '"Source Code Pro", monospace' },
    { token: /playfairdisplay/i,family: '"Playfair Display", serif' },
    { token: /montserrat/i,     family: "Montserrat, sans-serif" },
    { token: /inter\b/i,        family: "Inter, sans-serif" },
    { token: /roboto/i,         family: "Roboto, sans-serif" },
    { token: /\blato\b/i,       family: "Lato, sans-serif" },
  ];
  const cleaned = name.replace(/[-_\s]/g, "");
  for (const { token, family } of googleMap) {
    if (token.test(cleaned) || token.test(name)) {
      const weightMatch = /-(thin|light|regular|medium|semibold|bold|extrabold|black)/i.exec(name);
      const weightWord = weightMatch?.[1]?.toLowerCase();
      const weight =
        weightWord === "thin" ? "100" :
        weightWord === "light" ? "300" :
        weightWord === "medium" ? "500" :
        weightWord === "semibold" ? "600" :
        weightWord === "bold" ? "bold" :
        weightWord === "extrabold" ? "800" :
        weightWord === "black" ? "900" :
        hasBold ? "bold" : "normal";
      return { fontFamily: family, fontWeight: weight, fontStyle: hasItalic ? "italic" : "normal", matched: true };
    }
  }

  // 5. Generic family hints — last-chance guess so the editor has *something*
  //    to render with instead of a meaningless system fallback.
  if (/serif/i.test(lower)) {
    return { fontFamily: '"Times New Roman", Times, serif', fontWeight: hasBold ? "bold" : "normal", fontStyle: hasItalic ? "italic" : "normal", matched: true };
  }
  if (/mono/i.test(lower)) {
    return { fontFamily: '"Courier New", Courier, monospace', fontWeight: hasBold ? "bold" : "normal", fontStyle: hasItalic ? "italic" : "normal", matched: true };
  }

  // 6. Fallback
  return { fontFamily: `"${name}", sans-serif`, fontWeight: hasBold ? "bold" : "normal", fontStyle: hasItalic ? "italic" : "normal", matched: false };
}
