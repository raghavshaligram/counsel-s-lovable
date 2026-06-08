
# Chat with PDF — Instant by Default, AI on Demand

## The shift

Today: drop PDF → wait 5–10 min for an 800MB model → ask question.
After: drop PDF → **answer in 50ms** with quoted passages and page numbers. If the user wants a written, conversational reply, they click **Generate written answer** and *then* a small ~200MB model loads (one-time, cached).

90% of "chat with PDF" questions are really "find the part that talks about X." We serve those instantly with zero download, zero network, zero cost. The LLM becomes a power-user upgrade, not a barrier to entry.

## New user flow

1. **Drop PDF** → indexed locally with BM25 (already built). Instant.
2. **Type question** → press Enter.
3. **Instant answer card** appears immediately:
   - Top 3 ranked passages, each as a quote block
   - Page number chip ("p. 7") on each
   - Query keywords highlighted in-passage
   - "Copy quote" button per passage
4. Below the instant answer: a single **"✨ Generate written answer"** button. Greyed out by default with the label *"Loads a small AI model (~200 MB, one-time)."*
5. First click → model downloads with a progress bar in place of the button. Subsequent questions in the same session: button is replaced by **"Generating…"** with streaming tokens, no download.
6. The written answer renders below the instant answer, with the same page citations the retrieval already produced.

This way the user *sees value before any download* and opts in only if they want prose.

## Model swap

Drop the 800MB Llama-3.2-1B + 400MB Qwen-0.5B combo. Use **one** small model on both runtimes:
- **WebGPU path**: `SmolLM2-360M-Instruct-q4f16_1-MLC` (~230MB) via WebLLM. Existing MLC model URL — no infra change.
- **WASM path**: `HuggingFaceTB/SmolLM2-360M-Instruct` q4 via Transformers.js (~210MB).

Same download budget (~200MB) on both paths, which makes the "one-time, ~200 MB" copy honest regardless of device. Quality is lower than Llama-1B, but it's only being asked to *summarize 3 already-retrieved passages*, which it does well.

## What stays vs changes

**Stays as-is:**
- `src/lib/chat/pdf-extract.ts` — page-aware chunking
- `src/lib/chat/bm25.ts` — retrieval index
- `src/lib/chat/runtime-detect.ts`
- `/chat` route registration, SEO meta, AppShell nav entries

**Changes:**
- `src/routes/chat.tsx` — restructure UI: instant-answer card first, optional Generate button second. Don't init the worker on mount; init only on the first click of Generate. Remove the always-on "Initializing model…" sidebar state. Sidebar becomes a privacy/how-it-works panel and shows the model only after the user has opted in.
- `src/lib/chat/llm-worker.ts` — swap model IDs to SmolLM2-360M variants.
- `src/lib/chat/bm25.ts` — add a small helper `highlight(text, query)` that returns `{ before, hit, after }[]` segments for the UI to render `<mark>`.
- Landing page card copy: change "WebGPU + WASM fallback" bullet to "Works instantly — no download required" to reflect the new default.

**New (small):**
- `src/components/chat/InstantAnswer.tsx` — renders the 3 quoted passages with page chips, highlights, and copy buttons.
- `src/components/chat/GenerateAnswer.tsx` — encapsulates the "Generate written answer" button, the download-progress state, and the streamed assistant bubble.

## Behavior details

- **No worker spawned until Generate is clicked.** The PDF route stays lightweight and SSR-friendly. The worker file already dynamic-imports the LLM libraries, so the main bundle isn't affected either way; this just defers the model fetch itself.
- **Empty-state instant answer**: if BM25 returns zero hits (e.g. nonsense query), show a small "No matching passages — try different words" card instead of an empty quote list.
- **Generate button is per-question**, not global. Each user message gets its own "Generate" affordance, so the user picks which answers are worth the wait.
- **Once the model is loaded**, the Generate button on every prior and future question becomes instant ("Generate" → streams).
- **Cache awareness**: on `/chat` mount, do a cheap `caches.has(...)` (or equivalent) check; if the model is already cached, show the button as *"Generate written answer · model cached"* without triggering any download.

## Files touched

**Edit**
- `src/routes/chat.tsx` (substantial)
- `src/lib/chat/llm-worker.ts` (model IDs)
- `src/lib/chat/bm25.ts` (add `highlight` helper)
- `src/routes/index.tsx` (one bullet on the Chat tool card)
- `src/components/app-shell.tsx` (no change to nav; copy stays "Beta")

**Create**
- `src/components/chat/InstantAnswer.tsx`
- `src/components/chat/GenerateAnswer.tsx`

**Delete**
- Nothing.

## Out of scope (future)

- Bring-your-own Ollama URL (settings panel toggle). Easy to add later — same worker, different transport.
- Local embeddings for semantic retrieval — only worth doing if BM25 quality complaints come in.

After approval I'll implement, then verify in the preview: drop a PDF, ask a question, confirm passages render instantly with highlights; click Generate, confirm download progress; ask a follow-up, confirm no second download.
