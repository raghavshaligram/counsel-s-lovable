import { createFileRoute } from "@tanstack/react-router";
import { RedactPage } from "@/components/redact-page";
import { softwareAppSchema } from "@/lib/seo/tool-schema";

export const Route = createFileRoute("/verifiable-redaction")({
  head: () => ({
    meta: [
      { title: "Verifiable Redaction — CounselPDF Legal" },
      {
        name: "description",
        content:
          "Court-defensible PDF redaction. Mandatory FOIA / privilege codes, signed Certificate of Redaction with SHA-256 hashes, and a privilege log — all generated in your browser.",
      },
      { property: "og:title", content: "Verifiable Redaction — CounselPDF Legal" },
      {
        property: "og:description",
        content:
          "Premium legal redaction with certificate, hashes, and privilege log. 100% on-device.",
      },
      { property: "og:url", content: "/verifiable-redaction" },
    ],
    links: [{ rel: "canonical", href: "/verifiable-redaction" }],
    scripts: [
      {
        type: "application/ld+json",
        children: JSON.stringify(
          softwareAppSchema({
            name: "CounselPDF Verifiable Redaction",
            url: "/verifiable-redaction",
            description:
              "Court-grade PDF redaction with mandatory exemption codes, SHA-256 chain-of-custody, and privilege log export.",
          }),
        ),
      },
    ],
  }),
  component: RedactPage,
});
