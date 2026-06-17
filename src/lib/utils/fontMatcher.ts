export interface FontMatch {
  fontFamily: string;
  fontWeight?: string;
  fontStyle?: string;
}

export function matchPdfFont(postscriptName: string): FontMatch {
  const name = postscriptName.trim();

  // 1. Helvetica / Arial Family (Sans-Serif)
  const helveticaArial = /^Helvetica|^ArialMT$/i;
  const timesRoman = /^Times(?:NewRomanPS)?(?:MT|PSMT)/i;
  const courier = /^Courier(?:NewPS)?(?:MT|PSMT)/i;

  if (helveticaArial.test(name)) {
    const weight = /Bold/i.test(name) ? 'bold' : undefined;
    const style = /Italic|Oblique/i.test(name) ? 'italic' : undefined;
    return {
      fontFamily: 'Arial, Helvetica, sans-serif',
      fontWeight: weight,
      fontStyle: style,
    };
  }

  // 2. Times New Roman Family (Serif)
  if (timesRoman.test(name)) {
    const weight = /Bold/i.test(name) ? 'bold' : undefined;
    const style = /Italic/i.test(name) ? 'italic' : undefined;
    return {
      fontFamily: '"Times New Roman", Times, serif',
      fontWeight: weight,
      fontStyle: style,
    };
  }

  // 3. Courier Family (Monospace)
  if (courier.test(name)) {
    const weight = /Bold/i.test(name) ? 'bold' : undefined;
    const style = /Oblique/i.test(name) ? 'italic' : undefined;
    return {
      fontFamily: '"Courier New", Courier, monospace',
      fontWeight: weight,
      fontStyle: style,
    };
  }

  // 4. Modern Google Fonts
  const modernFont = name.match(/^(Inter|Roboto|OpenSans|Lato)(?:-(Regular|Bold|Italic|BoldItalic|Medium|Light|Thin|Black))?(?:\d+)?$/i);
  if (modernFont) {
    const [, fontBase, weightSuffix] = modernFont;
    const family = fontBase!; // e.g. "Inter", "Roboto"

    let fontWeight: string | undefined;
    switch (weightSuffix?.toLowerCase()) {
      case 'bold':
        fontWeight = 'bold';
        break;
      case 'medium':
        fontWeight = '500';
        break;
      case 'light':
        fontWeight = '300';
        break;
      case 'thin':
        fontWeight = '100';
        break;
      case 'black':
        fontWeight = '900';
        break;
      case 'regular':
      default:
        fontWeight = 'normal';
        break;
    }

    return {
      fontFamily: family,
      fontWeight,
    };
  }

  // 5. Fallback
  return {
    fontFamily: 'sans-serif',
    fontWeight: 'normal',
    fontStyle: 'normal',
  };
}
