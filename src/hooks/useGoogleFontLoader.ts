import { useEffect } from "react";

const SYSTEM_FONTS = new Set([
  "arial",
  "helvetica",
  "sans-serif",
  "times new roman",
  "times",
  "serif",
  "courier new",
  "courier",
  "monospace",
  "georgia",
  "verdana",
  "tahoma",
  "trebuchet ms",
  "impact",
  "comic sans ms",
]);

function isSystemFont(fontFamily: string): boolean {
  const names = fontFamily
    .split(/,\s*/)
    .map((n) => n.replace(/['"]/g, "").trim().toLowerCase());
  return names.some((n) => SYSTEM_FONTS.has(n));
}

function buildFontUrl(fontFamily: string): string {
  const name = fontFamily.replace(/['"]/g, "").trim();
  const encoded = encodeURIComponent(name);
  return `https://fonts.googleapis.com/css2?family=${encoded}:wght@100..900&display=swap`;
}

function getLinkId(fontFamily: string): string {
  return `google-font-${fontFamily.replace(/\s+/g, "-").toLowerCase()}`;
}

export function useGoogleFontLoader(fontFamily?: string) {
  useEffect(() => {
    if (!fontFamily || typeof document === "undefined") return;

    if (isSystemFont(fontFamily)) return;

    const id = getLinkId(fontFamily);
    if (document.getElementById(id)) return;

    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = buildFontUrl(fontFamily);
    document.head.appendChild(link);
  }, [fontFamily]);
}
