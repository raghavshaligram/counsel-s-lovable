import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";

// TODO: replace with your project URL once a project name or custom domain is set.
const BASE_URL = "";

interface SitemapEntry {
  path: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: string;
}

// Public, indexable routes only — exclude auth, workspace, account/billing.
const ENTRIES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/pricing", changefreq: "monthly", priority: "0.9" },
  { path: "/security-architecture", changefreq: "monthly", priority: "0.8" },
  { path: "/verify-privacy", changefreq: "monthly", priority: "0.7" },
  { path: "/verifiable-redaction", changefreq: "monthly", priority: "0.7" },
  { path: "/redact", changefreq: "monthly", priority: "0.8" },
  { path: "/bates", changefreq: "monthly", priority: "0.8" },
  { path: "/privilege-scan", changefreq: "monthly", priority: "0.7" },
  { path: "/flatten", changefreq: "monthly", priority: "0.6" },
  { path: "/ocr", changefreq: "monthly", priority: "0.6" },
  { path: "/merge", changefreq: "monthly", priority: "0.6" },
  { path: "/split", changefreq: "monthly", priority: "0.6" },
  { path: "/compress", changefreq: "monthly", priority: "0.5" },
  { path: "/protect", changefreq: "monthly", priority: "0.5" },
  { path: "/unlock", changefreq: "monthly", priority: "0.5" },
  { path: "/sign", changefreq: "monthly", priority: "0.5" },
  { path: "/watermark", changefreq: "monthly", priority: "0.5" },
  { path: "/compare", changefreq: "monthly", priority: "0.5" },
  { path: "/extract", changefreq: "monthly", priority: "0.5" },
  { path: "/to-word", changefreq: "monthly", priority: "0.5" },
  { path: "/to-excel", changefreq: "monthly", priority: "0.5" },
  { path: "/word-to-pdf", changefreq: "monthly", priority: "0.5" },
];

export const Route = createFileRoute("/sitemap.xml")({
  server: {
    handlers: {
      GET: async () => {
        const urls = ENTRIES.map((e) =>
          [
            `  <url>`,
            `    <loc>${BASE_URL}${e.path}</loc>`,
            e.changefreq ? `    <changefreq>${e.changefreq}</changefreq>` : null,
            e.priority ? `    <priority>${e.priority}</priority>` : null,
            `  </url>`,
          ]
            .filter(Boolean)
            .join("\n"),
        );

        const xml = [
          `<?xml version="1.0" encoding="UTF-8"?>`,
          `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">`,
          ...urls,
          `</urlset>`,
        ].join("\n");

        return new Response(xml, {
          headers: {
            "Content-Type": "application/xml",
            "Cache-Control": "public, max-age=3600",
          },
        });
      },
    },
  },
});
