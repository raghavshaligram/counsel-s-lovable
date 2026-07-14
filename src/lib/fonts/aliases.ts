// Flat alias table: normalized key (lowercase, alphanumeric only — see
// toAliasKey) → canonical family id from registry.ts.
//
// Keys are matched against `NormalizedName.base` and the individual tokens
// of a CSS stack. Add new aliases here — do not sprinkle them across the
// resolver.

export const ALIASES: Record<string, string> = {
  // ── Arial family / Helvetica-metric twins ───────────────────────────
  arial: "arial",
  arialmt: "arial",
  arialnarrow: "arial-narrow",
  liberationsans: "arial",
  nimbussans: "arial",
  nimbussansl: "arial",
  arimo: "arial",

  // ── Helvetica ────────────────────────────────────────────────────────
  helvetica: "helvetica",
  helveticaneue: "helvetica-neue",
  helveticaneueltstd: "helvetica-neue",
  helveticaneuelt: "helvetica-neue",
  neuehaasgrotesk: "helvetica-neue",

  // ── Times ────────────────────────────────────────────────────────────
  times: "times",
  timesroman: "times",
  timesnewroman: "times-new-roman",
  timesnewromanps: "times-new-roman",
  tnr: "times-new-roman",
  liberationserif: "times-new-roman",
  nimbusroman: "times",
  nimbusromanno9l: "times",
  tinos: "times-new-roman",

  // ── Calibri / metric twin ────────────────────────────────────────────
  calibri: "calibri",
  carlito: "calibri",

  // ── Aptos (Microsoft 365 default) ───────────────────────────────────
  aptos: "aptos",
  aptosdisplay: "aptos",
  aptosnarrow: "aptos",

  // ── Cambria / twin ──────────────────────────────────────────────────
  cambria: "cambria",
  caladea: "cambria",

  candara: "candara",
  consolas: "consolas",
  couriernew: "courier-new",
  courier: "courier-new",
  cousine: "courier-new",
  liberationmono: "courier-new",
  nimbusmono: "courier-new",
  nimbusmonol: "courier-new",

  georgia: "georgia",

  segoeui: "segoe-ui",
  segoe: "segoe-ui",

  tahoma: "tahoma",
  trebuchetms: "trebuchet-ms",
  trebuchet: "trebuchet-ms",
  verdana: "verdana",

  // ── Adobe ───────────────────────────────────────────────────────────
  myriadpro: "myriad-pro",
  myriad: "myriad-pro",
  minionpro: "minion-pro",
  minion: "minion-pro",
  garamond: "garamond",
  ebgaramond: "garamond",
  adobegaramondpro: "garamond",
  warnock: "warnock",
  warnockpro: "warnock",

  // ── Google ──────────────────────────────────────────────────────────
  roboto: "roboto",
  opensans: "open-sans",
  notosans: "noto-sans",
  notoserif: "noto-serif",
  inter: "inter",
  interv: "inter",

  // ── Apple ───────────────────────────────────────────────────────────
  sfpro: "sf-pro",
  sfprotext: "sf-pro",
  sfprodisplay: "sf-pro",
  sfprorounded: "sf-pro",
  applesystem: "sf-pro",
  systemui: "sf-pro",
  blinkmacsystemfont: "sf-pro",
  geneva: "geneva",
  lucidagrande: "lucida-grande",
  lucidasansunicode: "lucida-grande",

  // ── Legal ───────────────────────────────────────────────────────────
  bookantiqua: "book-antiqua",
  palatino: "book-antiqua",
  palatinolinotype: "book-antiqua",
  urwpalladio: "book-antiqua",
  centuryschoolbook: "century-schoolbook",
  newcenturyschoolbook: "century-schoolbook",
  newcenturyschlbk: "century-schoolbook",
  bookman: "bookman",
  bookmanoldstyle: "bookman",
  itcbookman: "bookman",

  // ── Engineering ─────────────────────────────────────────────────────
  ocra: "ocr-a",
  ocrastd: "ocr-a",
  ocrb: "ocr-b",
  ocrbstd: "ocr-b",
  din: "din",
  dinnext: "din",
  dinpro: "din",
  univers: "univers",
  universlt: "univers",
};
