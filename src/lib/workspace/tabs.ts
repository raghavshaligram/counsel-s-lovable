/**
 * Per-tab workspace state.
 *
 * Each open document is a TabState. The active tab feeds every tool — the
 * canvas, inspector, floating toolbar, and command bar all operate on
 * whichever tab is current. Switching tabs swaps which document is active;
 * edits never cross between tabs.
 */
import { initialState, type State as EditorState } from "@/lib/editor/state";

export type ReadingTheme = "dark" | "sepia" | "soft" | "white";
export type ZoomMode = "smart" | "fit-width" | "fit-page" | "actual" | "custom";

export type TabState = {
  id: string;
  file: File | null;
  isDirty: boolean;
  editor: EditorState;
  activeToolId: string | null;
  inspectorOpen: boolean;
  zoom: number;
  zoomMode: ZoomMode;
  pageLayout: "single" | "double";
  continuous: boolean;
  showGaps: boolean;
  theme: ReadingTheme;
  // OCR memory. Page indices (0-based) where on-device OCR has been applied
  // in this tab, separated from pages that already had a usable text layer
  // (copied through). Used to (a) suppress the "scanned" banner on done
  // pages, (b) render a per-page tag, (c) resume OCR on remaining pages,
  // and (d) default the edit-text font to a serif on OCR'd pages.
  ocrPages?: number[];
  ocrPagesCopied?: number[];
  // True when the last OCR run was stopped before completion.
  ocrIsPartial?: boolean;
};

export const TAB_CAP = 10;

let counter = 0;
export function newTabId(): string {
  counter += 1;
  return `tab-${Date.now().toString(36)}-${counter.toString(36)}`;
}

export function makeBlankTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: newTabId(),
    file: null,
    isDirty: false,
    editor: initialState,
    activeToolId: null,
    inspectorOpen: false,
    zoom: 100,
    zoomMode: "smart",
    pageLayout: "single",
    continuous: true,
    showGaps: true,
    theme: "dark",
    ...overrides,
  };
}
