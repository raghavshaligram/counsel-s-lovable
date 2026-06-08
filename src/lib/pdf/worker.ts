// PDF.js worker bootstrap. Client-only — import this file only inside
// useEffect / event handlers, never at module scope of an SSR'd file.
import * as pdfjs from "pdfjs-dist";
// Vite ?url returns a URL string that resolves to the bundled asset.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

let configured = false;
export function getPdfjs() {
  if (!configured) {
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    configured = true;
  }
  return pdfjs;
}
