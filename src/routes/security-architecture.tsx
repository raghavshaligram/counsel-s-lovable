import { createFileRoute, Link } from "@tanstack/react-router";
import { AppShell } from "@/components/app-shell";
import { ProveItPanelBody } from "@/components/workspace/prove-it-panel";
import {
  Lock,
  ServerOff,
  HardDrive,
  WifiOff,
  Shield,
  ArrowRight,
  Database,
  FileCode,
  Eye,
} from "lucide-react";

export const Route = createFileRoute("/security-architecture")({
  head: () => ({
    meta: [
      { title: "Security & Architecture — CounselPDF" },
      {
        name: "description",
        content:
          "Technical overview of CounselPDF's client-side architecture for law firm IT and compliance reviewers. No server receives document content.",
      },
      { property: "og:title", content: "Security & Architecture — CounselPDF" },
      {
        property: "og:description",
        content:
          "Client-side PDF architecture. No uploads, no remote processing, no data retention.",
      },
      { property: "og:url", content: "/security-architecture" },
      { property: "og:type", content: "website" },
    ],
    links: [{ rel: "canonical", href: "/security-architecture" }],
  }),
  component: SecurityArchitecturePage,
});

function SecurityArchitecturePage() {
  return (
    <AppShell>
      {/* HERO */}
      <section className="relative overflow-hidden border-b border-border">
        <div className="absolute inset-0 vault-grid opacity-40" />
        <div className="relative mx-auto max-w-5xl px-5 md:px-8 pt-16 md:pt-24 pb-16 md:pb-20">
          <div className="font-mono text-[11px] text-muted-foreground mb-6 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-vault animate-pulse" />
            For IT and compliance reviewers
          </div>
          <h1
            className="font-display leading-[0.92] tracking-tight"
            style={{ fontSize: "clamp(2.25rem, 5vw, 4.5rem)" }}
          >
            Security &amp; Architecture
          </h1>
          <p className="mt-6 max-w-2xl text-base md:text-lg text-muted-foreground leading-relaxed">
            This page answers the questions law firm IT departments and compliance officers
            ask before approving a new document tool. Every claim below is true to the
            actual implementation and can be verified in the browser.
          </p>
        </div>
      </section>

      {/* LIVE PROVE-IT */}
      <section className="border-b border-border bg-surface-canvas/60">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-12 md:py-16">
          <div className="font-mono text-[11px] text-muted-foreground mb-4 uppercase tracking-[0.16em]">
            Prove it — live readout
          </div>
          <div className="rounded-xl border border-border bg-surface-2 max-w-md overflow-hidden flex flex-col" style={{ maxHeight: "32rem" }}>
            <ProveItPanelBody />
          </div>
        </div>
      </section>

      {/* PROCESSING MODEL */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="font-mono text-[11px] text-muted-foreground mb-10 uppercase tracking-[0.16em]">
            Processing model
          </div>

          <div className="grid lg:grid-cols-[1fr_1.2fr] gap-12 lg:gap-16 items-start">
            <div>
              <h2
                className="font-display leading-[1] tracking-tight"
                style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)" }}
              >
                Everything happens in the browser runtime.
              </h2>
              <p className="mt-6 text-muted-foreground leading-relaxed">
                When you open a PDF in CounselPDF, the file is read into browser memory as a
                <code className="text-xs bg-accent-soft px-1.5 py-0.5 rounded text-foreground mx-1">Uint8Array</code>
                via the standard File API. From that moment until you export, the document never
                exists outside the browser's execution sandbox.
              </p>
              <p className="mt-4 text-muted-foreground leading-relaxed">
                Parsing, rendering, redaction, Bates stamping, OCR, and export are all performed
                by client-side libraries (PDF.js, pdf-lib, Tesseract.js) running inside the
                browser tab or its Web Workers. There is no remote processing layer, no cloud
                conversion API, and no server-side render path that touches document bytes.
              </p>
            </div>

            <div className="space-y-4">
              <DetailRow
                icon={<ServerOff className="h-4 w-4" />}
                label="No server receives document content"
                value="CounselPDF is deployed as a static site. There is no /upload, /process, or /convert endpoint. The server serves HTML, JavaScript, and WASM bundles only."
              />
              <DetailRow
                icon={<Eye className="h-4 w-4" />}
                label="No remote API calls with file data"
                value="We do not call Google Cloud Vision, AWS Textract, Azure Document Intelligence, or any third-party analysis service. OCR runs on-device via Tesseract.js."
              />
              <DetailRow
                icon={<FileCode className="h-4 w-4" />}
                label="WebAssembly runs locally"
                value="WASM modules for PDF manipulation and text extraction are fetched as static assets and executed inside the browser's sandboxed WASM runtime."
              />
              <DetailRow
                icon={<Lock className="h-4 w-4" />}
                label="No telemetry carrying document content"
                value="Error reporting and analytics contain page URLs and exception messages. They never contain filenames, extracted text, page images, or document metadata."
              />
            </div>
          </div>
        </div>
      </section>

      {/* LOCAL FILE HANDLING */}
      <section className="border-b border-border bg-surface-canvas/60">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="font-mono text-[11px] text-muted-foreground mb-10 uppercase tracking-[0.16em]">
            Local file handling
          </div>

          <h2
            className="font-display leading-[1] tracking-tight max-w-2xl"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)" }}
          >
            Loaded into memory. Processed locally. Stored on your device.
          </h2>

          <div className="mt-10 grid md:grid-cols-3 gap-6">
            <StepCard
              num="01"
              title="Read into browser memory"
              body="When a user selects a file, the browser's File API yields an ArrayBuffer that is wrapped in a Uint8Array. This lives in the tab's JavaScript heap — not on disk, not on a server."
            />
            <StepCard
              num="02"
              title="Parsed by client-side libraries & Web Workers"
              body="PDF.js parses the byte stream inside a dedicated Web Worker so the UI thread stays responsive, even on large discovery sets. pdf-lib handles structural modifications like redaction, Bates stamping, and merging."
            />
            <StepCard
              num="03"
              title="Persisted in sandboxed local storage"
              body="Recent documents, annotation sidecars, and OCR layers are stored in the browser's IndexedDB — a sandboxed, origin-scoped database on the user's own device. Data is never transmitted to remote storage."
            />
          </div>

          <div className="mt-12 rounded-xl border border-border bg-card/40 p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-vault/15">
                <Database className="h-5 w-5 text-vault" />
              </div>
              <div>
                <div className="text-[15px] font-medium text-foreground">
                  What is persisted and where
                </div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  CounselPDF maintains two IndexedDB databases on the device:
                  <code className="text-xs bg-accent-soft px-1.5 py-0.5 rounded text-foreground mx-1">counselpdf-workspace</code>
                  stores UI state, recent document bytes (capped at 120 MB total), per-document
                  annotation sidecars, and user bookmarks; and
                  <code className="text-xs bg-accent-soft px-1.5 py-0.5 rounded text-foreground mx-1">counselpdf-tray</code>
                  stores blob bytes keyed by SHA-256 for batch operations like merge and Bates
                  stamp. A small amount of metadata is mirrored to
                  <code className="text-xs bg-accent-soft px-1.5 py-0.5 rounded text-foreground mx-1">localStorage</code>
                  so the tray survives a route change or reload. All storage is scoped to the
                  browser origin and subject to the browser's standard security model.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CODE ILLUSTRATION */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="font-mono text-[11px] text-muted-foreground mb-10 uppercase tracking-[0.16em]">
            Code illustration — local-only file handling
          </div>

          <h2
            className="font-display leading-[1] tracking-tight mb-6"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)" }}
          >
            The actual code path.
          </h2>
          <p className="max-w-2xl text-muted-foreground leading-relaxed mb-10">
            The snippets below are simplified from the production codebase. They show the real
            flow: file bytes enter browser memory, are parsed in a Web Worker, and are stored
            locally in IndexedDB. At no point is a network request made with document content.
          </p>

          <div className="space-y-6">
            <CodeBlock
              title="1. File bytes are read into memory — never uploaded"
              lang="typescript"
              code={`// When a user drops or selects a file:
const bytes = new Uint8Array(await file.arrayBuffer());

// 'bytes' lives in the browser's JS heap only.
// There is no fetch(), no XMLHttpRequest, no FormData.
// The file never leaves the device.`}
            />
            <CodeBlock
              title="2. PDF is parsed inside a Web Worker"
              lang="typescript"
              code={`// PDF.js runs in a dedicated worker so the UI stays responsive.
const pdfjs = await loadPdfjs();
const doc = await pdfjs.getDocument({ data: bytes }).promise;

// Rendering, text extraction, and page analysis all happen
// inside the browser sandbox — no server is contacted.`}
            />
            <CodeBlock
              title="3. Recent documents and edits persist to IndexedDB"
              lang="typescript"
              code={`// Documents are stored in the browser's origin-scoped IndexedDB.
const conn = await openDB("counselpdf-workspace", 3, {
  upgrade(d) {
    d.createObjectStore("docs");   // recent file bytes
    d.createObjectStore("sidecars"); // annotations, page ops, OCR layer
  },
});

// Sidecars are keyed by file identity so reopening restores edits.
await conn.put("sidecars", sidecarRecord, \`\${fileName}::\${fileSize}\`);`}
            />
            <CodeBlock
              title="4. Export rebuilds the PDF entirely on-device"
              lang="typescript"
              code={`// pdf-lib modifies the original bytes locally and produces a new blob.
const pdfDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
// ... apply redactions, Bates stamps, rotations, merges ...
const output = await pdfDoc.save();
const blob = new Blob([output], { type: "application/pdf" });

// The user downloads via the browser's native save mechanism.
// Still no network request carrying PDF data.`}
            />
          </div>
        </div>
      </section>

      {/* OFFLINE */}
      <section className="border-b border-border bg-surface-canvas/60">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="font-mono text-[11px] text-muted-foreground mb-10 uppercase tracking-[0.16em]">
            Offline operation
          </div>

          <div className="grid md:grid-cols-2 gap-10">
            <div className="rounded-xl border border-border bg-card/40 p-6 md:p-8">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-vault font-medium mb-4">
                <WifiOff className="h-3.5 w-3.5" />
                Works without a network connection
              </div>
              <h3 className="font-display text-xl md:text-2xl leading-tight mb-4">
                Disconnect and continue working.
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                CounselPDF registers a Service Worker that precaches the application shell and
                stores static assets (JavaScript bundles, WASM modules, fonts, and stylesheets)
                at install time. Once the app has loaded, every tool functions without an internet
                connection because the workflow has no server dependency. This is not a fallback
                mode — it is the natural consequence of a fully client-side architecture.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed mt-4">
                The Service Worker also caches third-party runtime dependencies required for
                offline OCR (Tesseract.js core, worker scripts, and language packs) so that
                making a scanned PDF searchable works while air-gapped.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-card/40 p-6 md:p-8">
              <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-vault font-medium mb-4">
                <HardDrive className="h-3.5 w-3.5" />
                Air-gapped workflow
              </div>
              <h3 className="font-display text-xl md:text-2xl leading-tight mb-4">
                Suitable for sensitive environments.
              </h3>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Because no step requires a network round-trip, CounselPDF can be used on machines
                that are physically disconnected from the internet or confined to isolated
                network segments. Load the application once, then move the machine offline.
                Document processing, redaction, Bates stamping, and export continue to operate
                normally.
              </p>
              <p className="text-sm text-muted-foreground leading-relaxed mt-4">
                For firms with strict network policies, the app can be reviewed by standard
                browser DevTools. The Network tab will show only static asset loads on first
                visit; after that, all subsequent work generates zero document-bearing traffic.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* DATA STATEMENT */}
      <section className="border-b border-border">
        <div className="mx-auto max-w-5xl px-5 md:px-8 py-16 md:py-24">
          <div className="font-mono text-[11px] text-muted-foreground mb-10 uppercase tracking-[0.16em]">
            Data handling statement
          </div>

          <h2
            className="font-display leading-[1] tracking-tight mb-8"
            style={{ fontSize: "clamp(1.75rem, 3vw, 2.75rem)" }}
          >
            What we store, what we do not store, and what we transmit.
          </h2>

          <div className="grid md:grid-cols-2 gap-10">
            <div>
              <h3 className="font-display text-lg text-foreground mb-4">
                What is stored
              </h3>
              <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <li className="flex gap-3">
                  <span className="text-vault mt-0.5">—</span>
                  <span>
                    <strong className="text-foreground">Document bytes</strong> in the browser's
                    IndexedDB, capped at 120 MB total per origin, retained only until the user
                    clears recents or the browser evicts storage.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-vault mt-0.5">—</span>
                  <span>
                    <strong className="text-foreground">Annotation sidecars</strong> (redaction
                    marks, page rotations, OCR text layers) keyed by file identity so edits
                    survive a tab close and reopen.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-vault mt-0.5">—</span>
                  <span>
                    <strong className="text-foreground">UI preferences</strong> (zoom level,
                    theme, panel state) in localStorage for convenience.
                  </span>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="font-display text-lg text-foreground mb-4">
                What is NOT stored or transmitted
              </h3>
              <ul className="space-y-3 text-sm text-muted-foreground leading-relaxed">
                <li className="flex gap-3">
                  <span className="text-vault mt-0.5">—</span>
                  <span>
                    <strong className="text-foreground">Nothing is uploaded to our servers.</strong>
                    {" "}There is no cloud storage bucket, no processing queue, and no temporary
                    remote cache. We cannot access your documents.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-vault mt-0.5">—</span>
                  <span>
                    <strong className="text-foreground">No document content in telemetry.</strong>
                    {" "}Analytics and error reports contain generic events (page views,
                    uncaught exceptions). They never include filenames, extracted text, or
                    page bitmaps.
                  </span>
                </li>
                <li className="flex gap-3">
                  <span className="text-vault mt-0.5">—</span>
                  <span>
                    <strong className="text-foreground">No remote AI analysis.</strong>
                    {" "}Privilege scanning and search operate on locally extracted text. We do
                    not send document content to OpenAI, Google, or any other remote model
                    provider.
                  </span>
                </li>
              </ul>
            </div>
          </div>

          <div className="mt-12 rounded-xl border border-vault/20 bg-accent-soft p-6 md:p-8">
            <div className="flex items-start gap-4">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-vault/15">
                <Shield className="h-5 w-5 text-vault" />
              </div>
              <div>
                <div className="text-[15px] font-medium text-foreground">
                  Plain-language summary for legal teams
                </div>
                <p className="mt-2 text-sm text-muted-foreground leading-relaxed">
                  CounselPDF does not collect, process, or store your documents on our infrastructure.
                  Your files remain on your device, inside your browser, under your control. We
                  have no technical ability to view, retain, or disclose your documents because we
                  never receive them. This architecture eliminates the data-breach and
                  subpoena-risk vectors that come with cloud-based document tools.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative overflow-hidden">
        <div
          className="absolute inset-0 pointer-events-none"
          style={{ background: "var(--gradient-glow)" }}
        />
        <div className="relative mx-auto max-w-3xl px-5 md:px-8 py-20 md:py-28 text-center">
          <h2
            className="font-display leading-[1.02] tracking-tight"
            style={{ fontSize: "clamp(1.75rem, 4vw, 3rem)" }}
          >
            Verify every claim yourself.
          </h2>
          <p className="mt-4 text-muted-foreground max-w-xl mx-auto">
            Open the Network tab, load a document, and watch the traffic. You will see zero
            outgoing requests carrying your file.
          </p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link
              to="/verify-privacy"
              className="inline-flex items-center gap-2 rounded-md bg-vault text-vault-foreground px-6 py-3 text-sm font-semibold hover:opacity-90"
            >
              Run the verification test <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              to="/"
              className="inline-flex items-center gap-2 rounded-md border border-border bg-card/40 px-6 py-3 text-sm font-medium hover:bg-accent transition"
            >
              Back to home
            </Link>
          </div>
        </div>
      </section>
    </AppShell>
  );
}

function StepCard({
  num,
  title,
  body,
}: {
  num: string;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/40 p-6 md:p-7">
      <div className="font-mono text-[11px] text-vault mb-4">{num}</div>
      <h3 className="font-display text-lg md:text-xl leading-tight mb-3">{title}</h3>
      <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
    </div>
  );
}

function DetailRow({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-border bg-card/40 p-4">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-vault/10 text-vault">
        {icon}
      </span>
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        <p className="mt-1 text-xs text-muted-foreground leading-relaxed">{value}</p>
      </div>
    </div>
  );
}

function CodeBlock({
  title,
  lang,
  code,
}: {
  title: string;
  lang: string;
  code: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-[#0d1117] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/60 bg-[#161b22]">
        <span className="text-xs font-medium text-foreground">{title}</span>
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{lang}</span>
      </div>
      <pre className="p-4 overflow-x-auto text-[13px] leading-relaxed font-mono text-[#c9d1d9]">
        <code>{code}</code>
      </pre>
    </div>
  );
}
