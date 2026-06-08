
# Local Chat with PDF — `/chat`

A 5th hero tool: upload a PDF, ask questions, get answers from a model running entirely in the user's browser. No file or question ever leaves the device. Pairs perfectly with the existing privacy moat.

## User flow

1. Land on `/chat`. See: "Chat with your PDF — 100% in your browser."
2. Drop a PDF → extracted client-side with the existing `pdfjs-dist` setup, chunked into ~500-token passages with page numbers.
3. First visit only: "Downloading model (~800MB, one-time)" with a progress bar. Cached in the browser afterwards — subsequent loads are instant and work offline.
4. Ask a question → BM25 picks top 4 chunks → model streams an answer with inline page citations (`[p. 3]`).
5. Sidebar shows: model name, runtime (WebGPU / WASM), VRAM/RAM estimate, "Clear conversation", "Switch PDF".

## Architecture

```text
/chat route (UI, React)
   │
   ├── pdf-extract.ts          → pdfjs-dist, page-aware chunking
   ├── bm25.ts                  → tiny pure-JS BM25 index (no deps)
   └── llm-worker.ts (Web Worker)
        ├── WebGPU path: @mlc-ai/web-llm  → Llama-3.2-1B-Instruct-q4f16
        └── WASM fallback: @huggingface/transformers → Qwen2.5-0.5B-Instruct (q4)
```

- Feature detection: `navigator.gpu && await navigator.gpu.requestAdapter()` → WebLLM, else Transformers.js WASM.
- All heavy work (model load, tokenize, generate, BM25 index build) runs in the Worker. Main thread only renders tokens streamed back via `postMessage`.
- Models cached by the libraries themselves (Cache API / IndexedDB). No server hit after first download.

## Files

**New**
- `src/routes/chat.tsx` — route, head() meta + `SoftwareApplication` JSON-LD, dropzone, chat UI, model-status panel.
- `src/lib/chat/pdf-extract.ts` — reuse `loadPdfjs`, return `{ page, text }[]` chunks.
- `src/lib/chat/bm25.ts` — `buildIndex(chunks)` + `search(query, k)`. Pure JS, ~80 lines.
- `src/lib/chat/llm-worker.ts` — Web Worker. Messages: `init`, `generate`, `progress`, `token`, `done`, `error`. Picks WebLLM or Transformers.js at runtime.
- `src/lib/chat/runtime-detect.ts` — `detectRuntime()` → `"webgpu" | "wasm"`.
- `src/components/chat/ChatMessages.tsx`, `ChatComposer.tsx`, `ModelStatusCard.tsx` — presentation only.

**Edited**
- `src/components/app-shell.tsx` — add "Chat with PDF" to desktop sidebar + mobile drawer (with a small "Beta" pill).
- `src/routes/index.tsx` — promote as 5th hero tool in the grid, update meta description to include "Chat".
- `src/routeTree.gen.ts` — auto-regenerated.
- `package.json` via `bun add @mlc-ai/web-llm @huggingface/transformers`.

## Technical notes

- **Worker**: standard Vite `new Worker(new URL('./llm-worker.ts', import.meta.url), { type: 'module' })` — no SSR concerns since `/chat` is client-only UI (gate model load behind `useEffect`, render a skeleton during SSR).
- **Streaming**: WebLLM has `engine.chat.completions.create({ stream: true })`; Transformers.js has `TextStreamer`. Both posted token-by-token to the main thread.
- **Prompt template**: system message "Answer using only the provided context. Cite pages like [p. N]. If the answer isn't in the context, say so." + retrieved chunks + user question.
- **No backend, no Lovable Cloud**. Nothing to provision.
- **SEO**: `head()` with title "Chat with PDF in your browser — Free, Private, Offline", `SoftwareApplication` JSON-LD via the existing `softwareAppSchema` helper, canonical URL.
- **Bundle hygiene**: both LLM libraries are dynamically `import()`ed inside the worker so the main bundle stays small; only loaded on `/chat`.
- **Device gating**: if WebGPU is unavailable AND device RAM < 4GB (rough `navigator.deviceMemory` check), show a clear "Your device may struggle — try desktop Chrome" warning before downloading.

## Out of scope (future)

- Local embeddings (MiniLM) for semantic search — easy follow-up once BM25 ships.
- Multi-PDF library with IndexedDB persistence.
- Optional Lovable Cloud sync of chat history (opt-in only; never the PDF).

After approval I'll implement in one pass, then verify by uploading a sample PDF in the preview and confirming streaming answers + page citations.
