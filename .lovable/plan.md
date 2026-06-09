## VaultPDF: plan reset

The workspace-shell direction (file rail, activity rail, cross-tool history, persistence toggle) has been scrapped per user feedback — it added confusion without adding value. All `src/lib/workspace/` and `src/components/workspace/` files have been deleted.

Each tool stays self-contained: pick a tool → drop a file → get a download. No prescribed next steps, no shared workspace state, no extra panels.

Open follow-ups:
- Remove visible scrollbars project-wide (user dislikes them).
- Re-scope AppSumo LTD packaging around the existing standalone tools rather than a workspace concept.
