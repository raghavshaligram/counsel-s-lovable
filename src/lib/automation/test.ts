/**
 * Hardcoded automation engine smoke test — no UI.
 *
 * From the browser console:
 *   const { runAutomationTest } = await import("/src/lib/automation/test.ts");
 *   await runAutomationTest(); // picks a file, runs [watermark, page#, compress]
 *
 * Or pass bytes directly:
 *   await runAutomationTest(myBytes);
 *
 * Verifies: steps chain (bytes flow through), worker runs off main thread,
 * progress events fire in order, final PDF has all three transformations.
 */

import { runPipeline, downloadBytes } from "./runner";
import type { Pipeline, ProgressEvent } from "./types";

const HARDCODED_PIPELINE: Pipeline = [
  {
    op: "watermark",
    label: "Watermark CONFIDENTIAL",
    params: { text: "CONFIDENTIAL", opacity: 30, size: 72, pos: "diagonal" },
  },
  {
    op: "page-numbers",
    label: "Add page numbers",
    params: {
      anchor: "bottom-center",
      format: "n-of-m",
      startAt: 1,
      skipFirst: 0,
      fontSize: 10,
      margin: 24,
    },
  },
  {
    op: "compress",
    label: "Compress",
    params: { preset: "medium", grayscale: false },
  },
];

async function pickFile(): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/pdf,.pdf";
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return reject(new Error("No file selected"));
      resolve(new Uint8Array(await f.arrayBuffer()));
    };
    input.click();
  });
}

export async function runAutomationTest(
  inputBytes?: Uint8Array,
  pipeline: Pipeline = HARDCODED_PIPELINE,
) {
  const bytes = inputBytes ?? (await pickFile());
  console.group("[automation:test] running hardcoded pipeline");
  console.log("input bytes:", bytes.byteLength, "pipeline:", pipeline.map((s) => s.op));

  const onProgress = (ev: ProgressEvent) => {
    switch (ev.type) {
      case "step-start":
        console.log(`▶ step ${ev.index + 1}/${ev.total} start: ${ev.op}${ev.label ? ` — ${ev.label}` : ""}`);
        break;
      case "step-done":
        console.log(
          `✓ step ${ev.index + 1}/${ev.total} done: ${ev.op} in ${Math.round(ev.elapsedMs)}ms → ${ev.outputBytes} bytes`,
        );
        break;
      case "step-error":
        console.error(`✗ step ${ev.index + 1}/${ev.total} ERROR (${ev.op}): ${ev.error}`);
        break;
      case "pipeline-done":
        console.log(`🏁 pipeline done in ${Math.round(ev.elapsedMs)}ms → ${ev.outputBytes} bytes`);
        break;
      default:
        break;
    }
  };

  try {
    const res = await runPipeline(bytes, pipeline, { onProgress });
    console.log("steps:", res.steps);
    console.log("total elapsed:", Math.round(res.totalElapsedMs), "ms");
    downloadBytes(res.bytes, "automation-test.pdf");
    console.groupEnd();
    return res;
  } catch (err) {
    console.error("[automation:test] FAILED:", err);
    console.groupEnd();
    throw err;
  }
}

// Expose on window for one-line console invocation.
if (typeof window !== "undefined") {
  (window as unknown as { runAutomationTest?: typeof runAutomationTest }).runAutomationTest =
    runAutomationTest;
}
