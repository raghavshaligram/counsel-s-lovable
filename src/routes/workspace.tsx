import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const searchSchema = z.object({
  tool: z
    .enum(["pages", "redact", "sign", "convert", "secure", "layout", "legal", "ai"])
    .optional(),
});

export const Route = createFileRoute("/workspace")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "Workspace — VaultPDF" },
      {
        name: "description",
        content:
          "A calm, document-first PDF workspace. All tools, one canvas — processed locally.",
      },
    ],
  }),
  component: WorkspacePage,
});

function WorkspacePage() {
  const { tool } = Route.useSearch();
  return <WorkspaceShell initialTool={tool} />;
}
