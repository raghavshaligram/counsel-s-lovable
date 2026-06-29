import { createFileRoute } from "@tanstack/react-router";
import { RedactPage } from "@/components/redact-page";
import { softwareAppSchema } from "@/lib/seo/tool-schema";

export const Route = createFileRoute("/redact")({
  head: () => ({
    meta: [
      { title: "Smart Redact — CounselPDF" },
      {
        name: "description",
        content:
          "Permanently remove sensitive content from PDFs. AI PII auto-detection, keyword batch redact, exemption codes — 100% in your browser.",
      },
      { property: "og:title", content: "Smart Redact — CounselPDF" },
      {
        property: "og:description",
        content:
          "Redact PDFs without uploading them. Auto-detect PII, find-and-redact-all, FOIA exemption labels, true content removal.",
      },
      { property: "og:url", content: "/redact" },
    ],
    links: [{ rel: "canonical", href: "/redact" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "CounselPDF Smart Redact",
            url: "/redact",
            description:
              "AI-detected PII redaction with keyword batching and legal exemption codes. Content is permanently removed in your browser.",
          }),
        ),
      },
    ],
  }),
  component: RedactPage,
});
