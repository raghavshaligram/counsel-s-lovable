/**
 * Custom font registry for the text-edit flow.
 *
 * Two sources feed this registry:
 *   1. EMBEDDED — the PDF itself embeds the font program. pdf.js parses it,
 *      assigns it a CSS family name like `"g_d0_f5"`, and inserts an
 *      @font-face rule in the DOM so it can render text with it. We just
 *      read `styles[fontName].fontFamily` from getTextContent and reuse that
 *      family for our editable overlay — no download, perfect match.
 *   2. UPLOADED — the user picks a .ttf/.otf via the mini-toolbar. We read
 *      the bytes, generate a unique CSS family, inject an @font-face rule,
 *      and hand pdf-lib the same bytes on export so the output renders with
 *      that font on every viewer.
 *
 * Nothing here touches the network. The registry is in-memory only; it does
 * NOT persist to IndexedDB (annotation storage stays small, and uploads are
 * cheap to re-perform if the user reopens a tab).
 */

export type FontSource = "embedded" | "upload" | "system";

interface RegistryEntry {
  cssFamily: string;
  displayName: string;
  source: FontSource;
  bytes?: Uint8Array; // present for uploads (for pdf-lib embed on export)
}

// Keyed by CSS family (first token, stripped of quotes) so lookups from
// `fontFamilyOverride` on an annotation always resolve.
const REGISTRY = new Map<string, RegistryEntry>();

function familyKey(cssFamily: string): string {
  return (cssFamily.split(",")[0] ?? "").replace(/['"]/g, "").trim();
}

export function getFontInfo(cssFamily: string | undefined): RegistryEntry | undefined {
  if (!cssFamily) return undefined;
  return REGISTRY.get(familyKey(cssFamily));
}

export function getUploadedFontBytes(cssFamily: string | undefined): Uint8Array | undefined {
  const info = getFontInfo(cssFamily);
  return info?.source === "upload" ? info.bytes : undefined;
}

/**
 * Record that pdf.js already registered an embedded font under the given
 * CSS family. Safe to call repeatedly for the same family.
 *
 * `displayName` is the human-readable name from the PDF's font dictionary
 * (PostScript name) so the toolbar can show something like "Inter-SemiBold"
 * instead of the opaque "g_d0_f5".
 */
export function registerEmbeddedFont(cssFamily: string, displayName: string): void {
  const key = familyKey(cssFamily);
  if (!key) return;
  const prev = REGISTRY.get(key);
  if (prev && prev.source !== "system") return;
  REGISTRY.set(key, { cssFamily, displayName: displayName || key, source: "embedded" });
}

/**
 * Register a user-uploaded font file. Returns the CSS family to use for
 * `fontFamilyOverride`, and keeps the bytes around for pdf-lib on export.
 */
export async function registerUploadedFont(file: File): Promise<{ cssFamily: string; displayName: string }> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const base = file.name.replace(/\.[^.]+$/, "");
  const slug = base.replace(/[^A-Za-z0-9]+/g, "");
  // Content-hash keeps two different uploads with the same file name from
  // colliding on the same CSS family and bytes.
  let hash = 5381;
  for (let i = 0; i < bytes.length; i += Math.max(1, Math.floor(bytes.length / 1024))) {
    hash = ((hash << 5) + hash + bytes[i]) >>> 0;
  }
  const cssFamily = `VaultUpload_${slug || "Font"}_${hash.toString(36)}`;
  if (typeof document !== "undefined" && !REGISTRY.has(cssFamily)) {
    const blob = new Blob([bytes], { type: file.type || "font/ttf" });
    const url = URL.createObjectURL(blob);
    const style = document.createElement("style");
    style.dataset.vaultUploadedFont = cssFamily;
    style.textContent =
      `@font-face{font-family:'${cssFamily}';font-display:swap;src:url('${url}') format('${
        /\.otf$/i.test(file.name) ? "opentype" : "truetype"
      }');}`;
    document.head.appendChild(style);
  }
  REGISTRY.set(cssFamily, { cssFamily, displayName: base, source: "upload", bytes });
  return { cssFamily, displayName: base };
}

/**
 * Heuristic: does the pdf.js-reported CSS family look like a real embedded
 * font (not just a generic fallback like `sans-serif`)? Embedded fonts get a
 * synthetic family name from pdf.js (e.g. `"g_d0_f5"`). Standard-14 fonts
 * and unembedded ones fall back to `sans-serif` / `serif` / `monospace`
 * plus a substituted PS name.
 */
export function looksEmbedded(cssFamily: string | undefined): boolean {
  if (!cssFamily) return false;
  const first = familyKey(cssFamily);
  if (!first) return false;
  // pdf.js embedded font families follow this pattern.
  if (/^g_d\d+_f\d+$/.test(first)) return true;
  // Registered explicitly.
  const info = REGISTRY.get(first);
  return info?.source === "embedded" || info?.source === "upload";
}
