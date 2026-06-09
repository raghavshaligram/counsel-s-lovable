// Right-side panel listing every annotation with optional comment + replies.
// Pure presentational — wired by the editor route.

import { useMemo, useState } from "react";
import { MessageSquare, Check, CornerDownRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { Anno, Reply } from "@/lib/editor/types";

interface Props {
  annos: Anno[];
  author: string;
  onAuthorChange: (a: string) => void;
  onJump: (a: Anno) => void;
  onPatch: (id: string, patch: Partial<Anno>) => void;
  onClose: () => void;
}

const uid = () => Math.random().toString(36).slice(2, 10);

const kindLabel: Record<Anno["kind"], string> = {
  text: "Text",
  highlight: "Highlight",
  underline: "Underline",
  strikethrough: "Strikethrough",
  rect: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  arrow: "Arrow",
  freehand: "Drawing",
  note: "Sticky note",
  image: "Image",
  "text-edit": "Edited text",
  redact: "Redaction",
};

export function CommentsPanel({ annos, author, onAuthorChange, onJump, onPatch, onClose }: Props) {
  const grouped = useMemo(() => {
    const m = new Map<number, Anno[]>();
    for (const a of annos) {
      const arr = m.get(a.page) ?? [];
      arr.push(a);
      m.set(a.page, arr);
    }
    return [...m.entries()].sort(([a], [b]) => a - b);
  }, [annos]);

  return (
    <aside className="w-80 shrink-0 border-l border-border bg-card/40 flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <div className="flex items-center gap-2">
          <MessageSquare className="h-4 w-4" />
          <span className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Comments</span>
        </div>
        <button onClick={onClose} className="p-1 hover:bg-accent rounded-md" title="Close">
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 text-xs">
        <span className="text-muted-foreground">Author</span>
        <input
          value={author}
          onChange={(e) => onAuthorChange(e.target.value)}
          className="flex-1 bg-background border border-border rounded px-2 py-1 outline-none focus:ring-1 focus:ring-vault"
        />
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-4">
        {annos.length === 0 && (
          <p className="text-xs text-muted-foreground italic">No annotations yet. Add a highlight, sticky note, or any markup — it will appear here.</p>
        )}
        {grouped.map(([page, list]) => (
          <div key={page}>
            <div className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground mb-1">Page {page + 1}</div>
            <div className="space-y-2">
              {list.map((a) => (
                <CommentCard
                  key={a.id}
                  a={a}
                  author={author}
                  onJump={() => onJump(a)}
                  onPatch={(p) => onPatch(a.id, p)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function CommentCard({ a, author, onJump, onPatch }: { a: Anno; author: string; onJump: () => void; onPatch: (p: Partial<Anno>) => void }) {
  const [reply, setReply] = useState("");
  const [editing, setEditing] = useState(!a.contents);
  const [draft, setDraft] = useState(a.contents ?? "");

  const addReply = () => {
    const text = reply.trim(); if (!text) return;
    const next: Reply = { id: uid(), author, text, createdAt: Date.now() };
    onPatch({ replies: [...(a.replies ?? []), next] });
    setReply("");
  };

  const save = () => {
    onPatch({
      contents: draft,
      author: a.author ?? author,
      createdAt: a.createdAt ?? Date.now(),
    });
    setEditing(false);
  };

  return (
    <div className={cn("rounded-md border bg-background p-2", a.resolved ? "opacity-60" : "border-border")}>
      <div className="flex items-center justify-between text-[11px] mb-1">
        <button onClick={onJump} className="text-vault hover:underline truncate">
          {kindLabel[a.kind]}
          {"text" in a && a.text ? ` · "${a.text.slice(0, 24)}"` : ""}
        </button>
        <div className="flex items-center gap-1">
          <button
            onClick={() => onPatch({ resolved: !a.resolved })}
            title={a.resolved ? "Reopen" : "Resolve"}
            className={cn("p-1 rounded hover:bg-accent", a.resolved && "text-emerald-600")}
          >
            <Check className="h-3 w-3" />
          </button>
        </div>
      </div>
      {editing ? (
        <div className="space-y-1">
          <Textarea
            autoFocus
            rows={2}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a comment…"
            className="text-xs"
          />
          <div className="flex gap-1">
            <Button size="sm" className="h-6 text-xs px-2" onClick={save}>Save</Button>
            {a.contents && <Button size="sm" variant="ghost" className="h-6 text-xs px-2" onClick={() => { setDraft(a.contents ?? ""); setEditing(false); }}>Cancel</Button>}
          </div>
        </div>
      ) : (
        <button onClick={() => setEditing(true)} className="block text-left w-full">
          <p className="text-xs whitespace-pre-wrap">{a.contents}</p>
          {a.author && <p className="text-[10px] text-muted-foreground mt-1">{a.author} · {new Date(a.createdAt ?? 0).toLocaleString()}</p>}
        </button>
      )}
      {(a.replies?.length ?? 0) > 0 && (
        <div className="mt-2 space-y-1 border-l border-border pl-2">
          {a.replies!.map((r) => (
            <div key={r.id} className="text-xs">
              <div className="text-[10px] text-muted-foreground">{r.author} · {new Date(r.createdAt).toLocaleString()}</div>
              <div className="whitespace-pre-wrap">{r.text}</div>
            </div>
          ))}
        </div>
      )}
      {!a.resolved && (
        <div className="mt-2 flex items-start gap-1">
          <CornerDownRight className="h-3 w-3 text-muted-foreground mt-1.5" />
          <Textarea
            rows={1}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); addReply(); } }}
            placeholder="Reply… (⌘↵)"
            className="text-xs flex-1 min-h-[28px]"
          />
          <Button size="sm" variant="outline" className="h-6 text-xs px-2" onClick={addReply}>Reply</Button>
        </div>
      )}
    </div>
  );
}
