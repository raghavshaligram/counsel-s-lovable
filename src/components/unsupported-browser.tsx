/**
 * UnsupportedBrowserGate — full-screen block for Internet Explorer.
 *
 * CounselPDF depends on modern APIs (Web Workers, WASM, File/Blob streams,
 * pdf.js) that IE never shipped. Letting IE through results in the app
 * hanging on first heavy op (e.g. export) with no recovery. Detect IE up
 * front and show a clear message pointing to a supported browser instead.
 */
import { useEffect, useState } from "react";

function isInternetExplorer(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  // MSIE 6-10 (Trident/4-6); IE 11 (Trident/7 + rv:11). Edge is NOT IE.
  return /MSIE |Trident\//.test(ua);
}

export function UnsupportedBrowserGate() {
  const [blocked, setBlocked] = useState(false);
  useEffect(() => {
    setBlocked(isInternetExplorer());
  }, []);
  if (!blocked) return null;
  return (
    <div
      role="alertdialog"
      aria-modal="true"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 2147483647,
        background: "#0E1116",
        color: "#E6E8EB",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      <div style={{ maxWidth: 520, textAlign: "center" }}>
        <div
          style={{
            fontSize: 12,
            letterSpacing: "0.18em",
            textTransform: "uppercase",
            color: "#4C7FB8",
            marginBottom: 12,
          }}
        >
          Unsupported browser
        </div>
        <h1 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>
          CounselPDF requires a modern browser
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, lineHeight: 1.6, color: "#9AA3AD" }}>
          Internet Explorer is not supported. Please open CounselPDF in
          Chrome, Edge, Firefox, or Safari to continue. Your documents are
          processed on-device and never uploaded — a current browser is
          required for the cryptography and PDF engines to run.
        </p>
      </div>
    </div>
  );
}
