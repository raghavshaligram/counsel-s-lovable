/// <reference lib="webworker" />
// LLM worker — runs entirely off the main thread.
// Dynamically loads @mlc-ai/web-llm (WebGPU) or @huggingface/transformers (WASM).

type Runtime = "webgpu" | "wasm";

type InMsg =
  | { type: "init"; runtime: Runtime }
  | { type: "generate"; id: string; messages: { role: "system" | "user" | "assistant"; content: string }[]; maxTokens?: number }
  | { type: "abort" };

type OutMsg =
  | { type: "progress"; text: string; progress?: number }
  | { type: "ready"; runtime: Runtime; modelId: string }
  | { type: "token"; id: string; delta: string }
  | { type: "done"; id: string }
  | { type: "error"; message: string };

const WEBLLM_MODEL = "SmolLM2-360M-Instruct-q4f16_1-MLC";
const TFJS_MODEL = "HuggingFaceTB/SmolLM2-360M-Instruct";

let runtime: Runtime | null = null;
let webllmEngine: any = null;
let tfjsPipeline: any = null;
let abortFlag = false;

function post(msg: OutMsg) {
  (self as any).postMessage(msg);
}

async function initWebLLM() {
  const mod = await import("@mlc-ai/web-llm");
  webllmEngine = await mod.CreateMLCEngine(WEBLLM_MODEL, {
    initProgressCallback: (p: { progress: number; text: string }) => {
      post({ type: "progress", text: p.text, progress: p.progress });
    },
  });
  post({ type: "ready", runtime: "webgpu", modelId: WEBLLM_MODEL });
}

async function initTFJS() {
  const mod: any = await import("@huggingface/transformers");
  const { pipeline } = mod;
  tfjsPipeline = await pipeline("text-generation", TFJS_MODEL, {
    dtype: "q4",
    device: "wasm",
    progress_callback: (p: any) => {
      if (p.status === "progress" && typeof p.progress === "number") {
        post({
          type: "progress",
          text: `Downloading ${p.file ?? "model"}…`,
          progress: p.progress / 100,
        });
      } else if (p.status === "ready") {
        post({ type: "progress", text: "Model ready", progress: 1 });
      } else if (p.status === "initiate" || p.status === "download") {
        post({ type: "progress", text: `Fetching ${p.file ?? "model"}…` });
      }
    },
  });
  post({ type: "ready", runtime: "wasm", modelId: TFJS_MODEL });
}

// Detect when the model has fallen into a repetition loop and abort.
// SmolLM2-360M (especially q4) frequently collapses into repeating n-grams.
function makeRepetitionGuard() {
  let buf = "";
  return (delta: string): boolean => {
    buf = (buf + delta).slice(-240);
    if (buf.length < 80) return false;
    for (let n = 8; n <= 40; n += 4) {
      const tail = buf.slice(-n);
      if (!tail.trim()) continue;
      const hits = buf.split(tail).length - 1;
      if (hits >= 4) return true;
    }
    return false;
  };
}

async function generate(
  id: string,
  messages: { role: "system" | "user" | "assistant"; content: string }[],
  maxTokens = 256,
) {
  abortFlag = false;
  const guard = makeRepetitionGuard();
  try {
    if (runtime === "webgpu" && webllmEngine) {
      const stream = await webllmEngine.chat.completions.create({
        messages,
        stream: true,
        max_tokens: maxTokens,
        temperature: 0.7,
        top_p: 0.9,
        frequency_penalty: 0.6,
        presence_penalty: 0.3,
      });
      for await (const chunk of stream) {
        if (abortFlag) break;
        const delta = chunk.choices?.[0]?.delta?.content ?? "";
        if (!delta) continue;
        post({ type: "token", id, delta });
        if (guard(delta)) {
          abortFlag = true;
          break;
        }
      }
    } else if (runtime === "wasm" && tfjsPipeline) {
      const mod: any = await import("@huggingface/transformers");
      const streamer = new mod.TextStreamer(tfjsPipeline.tokenizer, {
        skip_prompt: true,
        skip_special_tokens: true,
        callback_function: (text: string) => {
          if (abortFlag || !text) return;
          post({ type: "token", id, delta: text });
          if (guard(text)) abortFlag = true;
        },
      });
      await tfjsPipeline(messages, {
        max_new_tokens: maxTokens,
        do_sample: true,
        temperature: 0.7,
        top_p: 0.9,
        top_k: 40,
        repetition_penalty: 1.3,
        no_repeat_ngram_size: 4,
        streamer,
        return_full_text: false,
      });
    } else {
      throw new Error("Model not initialized");
    }
    post({ type: "done", id });
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
}

self.addEventListener("message", async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      runtime = msg.runtime;
      if (runtime === "webgpu") await initWebLLM();
      else await initTFJS();
    } else if (msg.type === "generate") {
      await generate(msg.id, msg.messages, msg.maxTokens);
    } else if (msg.type === "abort") {
      abortFlag = true;
    }
  } catch (err: any) {
    post({ type: "error", message: err?.message ?? String(err) });
  }
});

export {};
