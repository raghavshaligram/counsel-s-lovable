// Bundled metric-compatible open fonts. These are the same width as the
// proprietary Microsoft / Adobe families they replace, so swapping them in
// for an "edit text" overlay keeps line widths almost identical even when
// the underlying PDF used the original.
//
//   Calibri              → Carlito
//   Arial / Helvetica    → Arimo
//   Times New Roman      → Tinos
//   Cambria              → Caladea
//   Courier / Consolas   → Cousine
//
// Used in two places:
//   1. Browser overlay (HTML/CSS) — injectFontFaces() registers @font-face
//      rules pointing at the bundled TTF assets so the on-screen overlay
//      renders in the chosen face.
//   2. PDF export — loadFontBytes() returns the TTF bytes so pdf-lib (with
//      fontkit registered) can embed them and draw the replacement text in
//      the matching face.

// TTF assets via Vite ?url imports — copied into the bundle at build time.
import CarlitoRegular from "@expo-google-fonts/carlito/400Regular/Carlito_400Regular.ttf?url";
import CarlitoBold from "@expo-google-fonts/carlito/700Bold/Carlito_700Bold.ttf?url";
import CarlitoItalic from "@expo-google-fonts/carlito/400Regular_Italic/Carlito_400Regular_Italic.ttf?url";
import CarlitoBoldItalic from "@expo-google-fonts/carlito/700Bold_Italic/Carlito_700Bold_Italic.ttf?url";
import ArimoRegular from "@expo-google-fonts/arimo/400Regular/Arimo_400Regular.ttf?url";
import ArimoBold from "@expo-google-fonts/arimo/700Bold/Arimo_700Bold.ttf?url";
import ArimoItalic from "@expo-google-fonts/arimo/400Regular_Italic/Arimo_400Regular_Italic.ttf?url";
import ArimoBoldItalic from "@expo-google-fonts/arimo/700Bold_Italic/Arimo_700Bold_Italic.ttf?url";
import TinosRegular from "@expo-google-fonts/tinos/400Regular/Tinos_400Regular.ttf?url";
import TinosBold from "@expo-google-fonts/tinos/700Bold/Tinos_700Bold.ttf?url";
import TinosItalic from "@expo-google-fonts/tinos/400Regular_Italic/Tinos_400Regular_Italic.ttf?url";
import TinosBoldItalic from "@expo-google-fonts/tinos/700Bold_Italic/Tinos_700Bold_Italic.ttf?url";
import CaladeaRegular from "@expo-google-fonts/caladea/400Regular/Caladea_400Regular.ttf?url";
import CaladeaBold from "@expo-google-fonts/caladea/700Bold/Caladea_700Bold.ttf?url";
import CaladeaItalic from "@expo-google-fonts/caladea/400Regular_Italic/Caladea_400Regular_Italic.ttf?url";
import CaladeaBoldItalic from "@expo-google-fonts/caladea/700Bold_Italic/Caladea_700Bold_Italic.ttf?url";
import CousineRegular from "@expo-google-fonts/cousine/400Regular/Cousine_400Regular.ttf?url";
import CousineBold from "@expo-google-fonts/cousine/700Bold/Cousine_700Bold.ttf?url";
import CousineItalic from "@expo-google-fonts/cousine/400Regular_Italic/Cousine_400Regular_Italic.ttf?url";
import CousineBoldItalic from "@expo-google-fonts/cousine/700Bold_Italic/Cousine_700Bold_Italic.ttf?url";

export type FontKey = "carlito" | "arimo" | "tinos" | "caladea" | "cousine";

type Urls = { r: string; b: string; i: string; bi: string };

interface FontMeta {
  key: FontKey;
  label: string;
  matches: string;
  cssFamily: string;
  kind: "sans" | "serif" | "mono";
  urls: Urls;
}

export const FONT_META: Record<FontKey, FontMeta> = {
  carlito: { key: "carlito", label: "Carlito",  matches: "Calibri",             cssFamily: "'VaultCarlito', Calibri, sans-serif", kind: "sans",  urls: { r: CarlitoRegular, b: CarlitoBold, i: CarlitoItalic, bi: CarlitoBoldItalic } },
  arimo:   { key: "arimo",   label: "Arimo",    matches: "Arial / Helvetica",   cssFamily: "'VaultArimo', Arial, Helvetica, sans-serif", kind: "sans", urls: { r: ArimoRegular, b: ArimoBold, i: ArimoItalic, bi: ArimoBoldItalic } },
  tinos:   { key: "tinos",   label: "Tinos",    matches: "Times New Roman",     cssFamily: "'VaultTinos', 'Times New Roman', Times, serif", kind: "serif", urls: { r: TinosRegular, b: TinosBold, i: TinosItalic, bi: TinosBoldItalic } },
  caladea: { key: "caladea", label: "Caladea",  matches: "Cambria",             cssFamily: "'VaultCaladea', Cambria, Georgia, serif", kind: "serif", urls: { r: CaladeaRegular, b: CaladeaBold, i: CaladeaItalic, bi: CaladeaBoldItalic } },
  cousine: { key: "cousine", label: "Cousine",  matches: "Courier / Consolas",  cssFamily: "'VaultCousine', 'Courier New', Courier, monospace", kind: "mono", urls: { r: CousineRegular, b: CousineBold, i: CousineItalic, bi: CousineBoldItalic } },
};

export const FONT_KEYS: FontKey[] = ["carlito", "arimo", "tinos", "caladea", "cousine"];

let cssInjected = false;
export function injectFontFaces() {
  if (cssInjected || typeof document === "undefined") return;
  cssInjected = true;
  const rules: string[] = [];
  for (const key of FONT_KEYS) {
    const m = FONT_META[key];
    const fam = m.cssFamily.split(",")[0].trim().replace(/^'|'$/g, "");
    const { r, b, i, bi } = m.urls;
    rules.push(`@font-face{font-family:'${fam}';font-weight:400;font-style:normal;font-display:swap;src:url('${r}') format('truetype');}`);
    rules.push(`@font-face{font-family:'${fam}';font-weight:700;font-style:normal;font-display:swap;src:url('${b}') format('truetype');}`);
    rules.push(`@font-face{font-family:'${fam}';font-weight:400;font-style:italic;font-display:swap;src:url('${i}') format('truetype');}`);
    rules.push(`@font-face{font-family:'${fam}';font-weight:700;font-style:italic;font-display:swap;src:url('${bi}') format('truetype');}`);
  }
  const style = document.createElement("style");
  style.dataset.vaultFonts = "1";
  style.textContent = rules.join("\n");
  document.head.appendChild(style);
}

// Map an original PDF font name (e.g. "Calibri-Bold", "ABCDEF+ArialMT",
// "TimesNewRomanPS-BoldItalicMT") to the closest bundled metric-compatible
// open font. Stripped of the optional subset prefix and matched case-insensitively.
export function mapPdfFontToKey(
  fontName: string | undefined,
  family: "sans" | "serif" | "mono",
  fontFamilyCss?: string,
): FontKey {
  return detectFontKey(fontName, family, fontFamilyCss).key;
}

// Like mapPdfFontToKey but also reports whether the result is an exact
// metric-compatible match (Calibri→Carlito, Arial→Arimo, etc.) or only an
// approximate fallback based on serif/sans/mono kind. Consumers use the
// `approximate` flag to show a subtle "closest match" hint in the UI.
export function detectFontKey(
  fontName: string | undefined,
  family: "sans" | "serif" | "mono",
  fontFamilyCss?: string,
): { key: FontKey; approximate: boolean } {
  const strip = (s: string) => s.toLowerCase().replace(/^[a-z0-9]{1,8}\+/, "");
  const n = strip(fontName ?? "");
  const ff = strip(fontFamilyCss ?? "");
  const hay = `${n} ${ff}`.trim();
  if (/calibri|carlito/.test(hay)) return { key: "carlito", approximate: false };
  if (/arial|helvet|liberation\s*sans|nimbus\s*sans|swiss|arimo/.test(hay)) return { key: "arimo", approximate: false };
  if (/times|tnr|\broman\b|liberation\s*serif|nimbus\s*rom|tinos/.test(hay)) return { key: "tinos", approximate: false };
  if (/cambria|caladea/.test(hay)) return { key: "caladea", approximate: false };
  if (/courier|cousine|consol/.test(hay)) return { key: "cousine", approximate: false };
  // Recognised serif/mono families with no exact metric twin.
  if (/garamond|georgia|baskerville|caslon|didot|bodoni|minion|book|serif/.test(hay)) return { key: "tinos", approximate: true };
  if (/mono|typewriter/.test(hay)) return { key: "cousine", approximate: true };
  // Pure fallback by kind — definitely approximate.
  if (family === "serif") return { key: "tinos", approximate: true };
  if (family === "mono") return { key: "cousine", approximate: true };
  return { key: "arimo", approximate: true };
}

export async function loadFontBytes(
  key: FontKey,
  bold: boolean,
  italic: boolean,
): Promise<Uint8Array> {
  const u = FONT_META[key].urls;
  const url = bold && italic ? u.bi : bold ? u.b : italic ? u.i : u.r;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load font ${key}`);
  return new Uint8Array(await res.arrayBuffer());
}
