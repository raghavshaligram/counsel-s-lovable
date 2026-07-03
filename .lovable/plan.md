Use this prompt for the rebuild:

```text
Rebuild the AI Assist behavior around a single, consistent training document and semantic intent router. Fix the current issue where the first Pro-feature question triggers the AI/model download UI, leaves a stale message/card in AI Assist, and prevents later queries from being answered.

Scope:
- Build/restore the AI Assist training document / knowledge base, likely under src/lib/assist/knowledge-base.ts or the closest existing assist/command location.
- Wire that knowledge base into AI Assist so user questions about tools work for both Free and Pro users.
- Do not reimplement PDF tools. AI Assist must only explain, classify, route, and hand off to existing verified tools/panels.
- Preserve the existing lazy-loading model behavior: MiniLM/embedding model downloads only when AI Assist/semantic matching is actually used, never on app load.

Training document requirements:
Create a structured tool-help knowledge base with one entry per tool/flow. Each entry should include:
- toolId / panelId used by existing workspace inspector routing
- displayName
- category/rail group
- aliases and natural-language examples for semantic matching
- short answer/help text for questions about what the tool does
- capability summary
- free/pro availability metadata
- whether the tool can be opened immediately for the current user
- upgrade copy for Pro-only tools
- action buttons to show when relevant: Open tool, Upgrade, View plans, Cancel/Close
- any known synonym collisions, e.g. “dollar amounts” should map to search/answer/redaction help, not Page Numbers

AI Assist behavior:
- Treat AI Assist as a conversational command center in the right-side inspector region.
- It must be mutually exclusive with normal tool inspector panels: opening AI Assist closes any tool panel; opening any tool panel closes AI Assist.
- State resets for every new submitted query: clear stale answer, stale Pro card, stale loading state, stale selected flow, stale pending action, and stale error.
- New query must always start a fresh flow and must not keep the previous Pro-feature message/card.
- Escape closes AI Assist. Tab navigation and Enter/Space activation must work for buttons.

Intent classification:
- Use semantic matching with the existing MiniLM embeddings for AI Assist/tool intent. Do not rely on keyword-only detection for tool help.
- Keyword/regex flow detection may remain only as a fast deterministic pre-check if it does not override semantic correctness, but semantic matching is the source of truth for ambiguous tool questions.
- AI Assist must classify into these response types:
  1. Answer/help about a tool or workflow
  2. Open/route to an allowed tool panel
  3. Pro feature explanation + upgrade actions for Free users
  4. Clarifying question when confidence is too low or multiple tools are close
- “watermark” opens/answers Watermark.
- “split” maps to Split and should expose free modes when available.
- “dollar amounts” semantically maps to search/answer/redaction-style assistance, not Page Numbers.
- Pro-only tool questions from Free users should still be answered. The assistant should explain what the tool does and then show a Pro card with upgrade/action buttons if the user tries to use/open the Pro feature.

Free vs Pro rules:
- Questions about any tool are allowed for Free and Pro users.
- Free user asking “what does [Pro tool] do?” gets a useful answer, not a blocked state.
- Free user asking to run/open/use a Pro-only capability gets:
  - explanation that it is a Pro feature
  - clear upgrade card
  - action buttons: Upgrade/View plans and Cancel/Close
  - no stuck state
- If the Free user then types a new query, the Pro card disappears and the new query starts cleanly.
- Pro users should route/open tools directly when confidence is high.

Model download / caching UX:
- If MiniLM must download for semantic matching, show a one-time setup indicator with progress, e.g. “Setting up AI (one-time download)…”.
- If the model is already cached, suppress the setup UI and answer quickly.
- Ensure the model download does not replace the final answer and does not leave AI Assist stuck on the setup/pro message.
- Log the model load trigger with the user action, e.g. ai-assist:submit-query.
- Do not download NER or other models for ordinary tool-help questions unless the selected feature specifically requires that model.

Implementation guidance:
- Inspect existing files before editing, especially:
  - src/components/workspace/agent-panel.tsx
  - src/components/workspace/workspace-shell.tsx
  - src/lib/agent/flows.ts
  - src/lib/command/intent.ts
  - src/lib/discovery/client.ts
  - existing entitlement/plan/pro gating utilities
- Add the knowledge base in a client-safe lib path. Do not put client-imported code under src/server.
- Keep deterministic tool execution in existing tools/panels. AI Assist should dispatch/open panels using current workspace state/actions.
- Use a requestId or abort/cancel guard so late async embedding/model responses cannot overwrite a newer query.
- Keep panel placement at the default right inspector width and do not add another rail/panel.
- Follow project design tokens only; no ad-hoc colors, fonts, spacing, or extra accent colors.

Acceptance tests:
- Load workspace: no AI model download.
- Do non-AI work such as manual redact/Bates/view: no AI model download.
- Ask first AI Assist tool question: if MiniLM is uncached, one-time setup indicator appears with progress, then the answer appears.
- Ask another query after first setup: no stuck setup message; cached model is reused; answer appears quickly.
- Free user asks about a Pro feature: receives answer + Pro card/actions, not a broken/stale message.
- Free user asks a new query after Pro card: previous card clears and new flow works.
- Pro user asks to open a Pro tool: tool opens, AI Assist closes if appropriate.
- “watermark” opens Watermark and closes AI Assist.
- “split” routes to Split with free modes available.
- “dollar amounts” routes to search/answer-style help, not Page Numbers.
- Assistant and inspector are never open at the same time.
- Escape closes, Tab moves between buttons, Enter/Space activates.
- No loops, no stale content, no repeated model download after cache.
```
