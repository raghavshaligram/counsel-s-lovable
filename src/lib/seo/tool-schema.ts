// Shared JSON-LD builder for tool routes — keeps each route file terse
// and ensures consistent SoftwareApplication schema across the suite.
export type ToolSchemaInput = {
  name: string;
  url: string; // route path, e.g. "/redact"
  description: string;
};

export function softwareAppSchema({ name, url, description }: ToolSchemaInput) {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name,
    url,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Any (browser)",
    description,
    offers: {
      "@type": "Offer",
      price: "0",
      priceCurrency: "USD",
    },
    publisher: { "@type": "Organization", name: "VaultPDF" },
  };
}
