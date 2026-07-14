import type { Anno } from "@/lib/editor/types";
import type { Action as EditorAction, State as EditorState } from "@/lib/editor/state";

export type TargetKind =
  | "none"
  | "text"
  | "text-editing"
  | "image"
  | "signature"
  | "redaction"
  | "shape"
  | "mark"
  | "draw-tool";

/** Per-selection workflow stage — swaps primary actions after key events. */
export type Stage =
  | "default"
  | "font-changed"
  | "cropped"
  | "preview-burned"
  | "duplicated";

export type Target =
  | { kind: "none" }
  | { kind: "text" | "text-editing"; anno: Extract<Anno, { kind: "text" | "text-edit" }> }
  | { kind: "image" | "signature"; anno: Extract<Anno, { kind: "image" }> }
  | { kind: "redaction"; anno: Extract<Anno, { kind: "redact" }> }
  | { kind: "shape"; anno: Anno }
  | { kind: "mark"; anno: Anno }
  | { kind: "draw-tool"; tool: string };

export interface ActionCtx {
  state: EditorState;
  dispatch: React.Dispatch<EditorAction>;
  anno: Anno | null;
  setStage: (s: Stage) => void;
  openTool: (id: string) => void;
  toast: (msg: string) => void;
}
