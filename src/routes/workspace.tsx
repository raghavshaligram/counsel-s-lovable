import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

const searchSchema = z.object({
  // Accept either a group label or a specific tool id — chips/links may pass either.
  tool: z.string().optional(),
});

export const Route = createFileRoute("/workspace")({
  validateSearch: searchSchema,
  head: () => ({
    meta: [
      { title: "PDFMacro" },
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
  return <WorkspaceShell initialTool={tool as never} />;
}
