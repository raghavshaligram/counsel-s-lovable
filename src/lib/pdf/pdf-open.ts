/**
 * Shared pdf.js document-open helper.
 *
 * Wraps `pdfjs.getDocument({data})` with:
 *   - an `onPassword` handler for encrypted PDFs (prompt-based by default,
 *     the same UX used by /unlock; callers can pass their own)
 *   - a `EncryptedPdfError` thrown when no password is supplied, so callers
 *     can surface a clean toast instead of an uncaught PasswordException
 *   - a `MalformedPdfError` wrapper on parser failures so callers can
 *     distinguish "unreadable input" from other bugs and toast a clean
 *     message
 *
 * Every path that opens a PDF via pdf.js should use this. Direct
 * `pdfjs.getDocument({...})` calls leak PasswordException as an uncaught
 * error on the main thread.
 */
import { loadPdfjs } from "@/lib/pdf/worker";

export class EncryptedPdfError extends Error {
  constructor(message = "This PDF is password-protected.") {
    super(message);
    this.name = "EncryptedPdfError";
  }
}

export class MalformedPdfError extends Error {
  constructor(message = "This PDF appears to be corrupted or unreadable.") {
    super(message);
    this.name = "MalformedPdfError";
  }
}

export type PasswordPrompt = (
  reason: "needPassword" | "incorrectPassword",
) => Promise<string | null> | string | null;

export interface OpenPdfjsOpts {
  /** Called when the PDF is encrypted. Return a password to retry, or null to
   *  cancel (which raises EncryptedPdfError). Defaults to a window.prompt. */
  onPassword?: PasswordPrompt;
  /** Optional abort signal — currently observed only after open. */
  signal?: AbortSignal | null;
  /** Extra parameters forwarded to pdfjs.getDocument. */
  extra?: Record<string, unknown>;
}

const defaultPrompt: PasswordPrompt = (reason) => {
  if (typeof window === "undefined") return null;
  const msg =
    reason === "incorrectPassword"
      ? "Incorrect password — try again:"
      : "This PDF is password-protected. Enter the password:";
  return window.prompt(msg) ?? null;
};

/**
 * Open a PDF with pdf.js, handling encryption + malformed inputs cleanly.
 * The returned document is the pdf.js `PDFDocumentProxy`.
 */
export async function openPdfjs(
  data: Uint8Array | ArrayBuffer,
  opts: OpenPdfjsOpts = {},
): Promise<Awaited<ReturnType<Awaited<ReturnType<typeof loadPdfjs>>["getDocument"]>["promise"]>> {
  const pdfjs = await loadPdfjs();
  const prompt = opts.onPassword ?? defaultPrompt;
  const task = pdfjs.getDocument({
    data: data instanceof Uint8Array ? data : new Uint8Array(data),
    ...(opts.extra ?? {}),
  });
  const anyTask = task as unknown as {
    onPassword?: (updateCallback: (pw: string) => void, reason: number) => void;
    promise: Promise<unknown>;
  };
  // reason=1 -> need password, reason=2 -> incorrect password
  anyTask.onPassword = (updateCallback, reason) => {
    Promise.resolve(prompt(reason === 2 ? "incorrectPassword" : "needPassword"))
      .then((pw) => {
        if (pw == null || pw === "") {
          // No password: destroy the task so the promise rejects.
          try {
            (task as unknown as { destroy?: () => void }).destroy?.();
          } catch { /* noop */ }
          return;
        }
        updateCallback(pw);
      })
      .catch(() => {
        try {
          (task as unknown as { destroy?: () => void }).destroy?.();
        } catch { /* noop */ }
      });
  };
  try {
    const doc = await task.promise;
    return doc as never;
  } catch (err) {
    const name = (err as { name?: string })?.name ?? "";
    const message = (err as { message?: string })?.message ?? String(err);
    if (name === "PasswordException" || /password/i.test(message)) {
      throw new EncryptedPdfError();
    }
    if (
      name === "InvalidPDFException" ||
      name === "MissingPDFException" ||
      name === "UnexpectedResponseException" ||
      /invalid pdf|corrupt|malformed/i.test(message)
    ) {
      throw new MalformedPdfError();
    }
    throw err;
  }
}

/** True when the error is one of the graceful cases callers should toast. */
export function isFriendlyPdfError(err: unknown): err is EncryptedPdfError | MalformedPdfError {
  return err instanceof EncryptedPdfError || err instanceof MalformedPdfError;
}
