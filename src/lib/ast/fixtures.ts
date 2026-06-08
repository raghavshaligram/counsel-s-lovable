import type { TemplateAST, TemplateMeta } from "./types";

export const FIXTURE_TEMPLATES: (TemplateMeta & { ast: TemplateAST })[] = [
  {
    id: "just-listed-01",
    name: "Just Listed — Modern",
    niche: "realtor",
    occasion: "just-listed",
    format: "social-square",
    aesthetic: "editorial",
    thumbColor: "oklch(0.55 0.18 256)",
    ast: {
      id: "just-listed-01",
      name: "Just Listed — Modern",
      sizes: [{ name: "IG Square", w: 1080, h: 1080 }],
      variables: {
        address: { label: "Address", default: "1247 Maple Avenue" },
        price: { label: "Price", default: "$849,000" },
        beds: { label: "Beds/Baths", default: "4 bd · 3 ba · 2,410 sf" },
        photo: { label: "Photo", default: "https://images.unsplash.com/photo-1568605114967-8130f3a36994?w=1200" },
      },
      root: {
        id: "root", type: "container", layout: "stack", padding: 0, width: "fill", height: "fill",
        background: { token: "surface" },
        children: [
          { id: "img", type: "image", src: "{{photo}}", variable: "photo", fit: "cover", width: "fill", height: 640 },
          {
            id: "body", type: "container", layout: "stack", padding: 56, gap: 16, flex: 1,
            background: { token: "surface" },
            children: [
              { id: "tag", type: "text", text: "JUST LISTED", font: "body", weight: 600, size: 18, color: { token: "brand.primary" } },
              { id: "addr", type: "text", text: "{{address}}", variable: "address", font: "display", weight: 700, size: 56, color: { token: "ink" }, maxLines: 2 },
              { id: "beds", type: "text", text: "{{beds}}", variable: "beds", font: "body", weight: 400, size: 22, color: { token: "ink.muted" } },
              { id: "price", type: "text", text: "{{price}}", variable: "price", font: "display", weight: 800, size: 64, color: { token: "brand.primary" } },
            ],
          },
        ],
      },
    },
  },
  {
    id: "rate-drop-01",
    name: "Rate Drop Alert",
    niche: "realtor",
    occasion: "rate-drop",
    format: "social-square",
    aesthetic: "bold",
    thumbColor: "oklch(0.65 0.2 28)",
    ast: {
      id: "rate-drop-01",
      name: "Rate Drop Alert",
      sizes: [{ name: "IG Square", w: 1080, h: 1080 }],
      variables: {
        rate: { label: "New rate", default: "6.125%" },
        agent: { label: "Agent", default: "Sarah Chen" },
      },
      root: {
        id: "root", type: "container", layout: "stack", padding: 80, gap: 24, width: "fill", height: "fill",
        align: "center", justify: "center",
        background: { token: "brand.primary" },
        children: [
          { id: "kicker", type: "text", text: "RATES JUST DROPPED", align: "center", font: "body", weight: 600, size: 22, color: { token: "surface" } },
          { id: "rate", type: "text", text: "{{rate}}", variable: "rate", align: "center", font: "display", weight: 800, size: 200, color: { token: "surface" } },
          { id: "sub", type: "text", text: "30-year fixed · talk to {{agent}}", variable: "agent", align: "center", font: "body", weight: 400, size: 24, color: { token: "surface" } },
        ],
      },
    },
  },
  {
    id: "sold-01",
    name: "Just Sold — Editorial",
    niche: "realtor",
    occasion: "just-sold",
    format: "social-square",
    aesthetic: "editorial",
    thumbColor: "oklch(0.35 0.05 240)",
    ast: {
      id: "sold-01",
      name: "Just Sold — Editorial",
      sizes: [{ name: "IG Square", w: 1080, h: 1080 }],
      variables: {
        address: { label: "Address", default: "84 Sunset Blvd" },
        days: { label: "Days on market", default: "6 days on market" },
      },
      root: {
        id: "root", type: "container", layout: "stack", padding: 72, gap: 20, width: "fill", height: "fill", justify: "between",
        background: { token: "ink" },
        children: [
          { id: "tag", type: "text", text: "SOLD", font: "display", weight: 800, size: 96, color: { token: "brand.accent" } },
          {
            id: "bottom", type: "container", layout: "stack", gap: 12,
            children: [
              { id: "addr", type: "text", text: "{{address}}", variable: "address", font: "display", weight: 600, size: 44, color: { token: "surface" } },
              { id: "days", type: "text", text: "{{days}}", variable: "days", font: "body", weight: 400, size: 22, color: { token: "ink.muted" } },
            ],
          },
        ],
      },
    },
  },
  {
    id: "product-sale-01",
    name: "Product Sale Banner",
    niche: "ecommerce",
    occasion: "sale",
    format: "social-square",
    aesthetic: "playful",
    thumbColor: "oklch(0.75 0.18 60)",
    ast: {
      id: "product-sale-01",
      name: "Product Sale Banner",
      sizes: [{ name: "IG Square", w: 1080, h: 1080 }],
      variables: {
        headline: { label: "Headline", default: "Summer Sale" },
        discount: { label: "Discount", default: "30% OFF" },
        photo: { label: "Product photo", default: "https://images.unsplash.com/photo-1542291026-7eec264c27ff?w=1200" },
      },
      root: {
        id: "root", type: "container", layout: "stack", padding: 64, gap: 24, width: "fill", height: "fill",
        background: { token: "brand.accent" },
        children: [
          { id: "headline", type: "text", text: "{{headline}}", variable: "headline", font: "display", weight: 800, size: 80, color: { token: "ink" } },
          { id: "discount", type: "text", text: "{{discount}}", variable: "discount", font: "display", weight: 700, size: 56, color: { token: "brand.primary" } },
          { id: "img", type: "image", src: "{{photo}}", variable: "photo", fit: "cover", width: "fill", flex: 1, radius: 24 },
        ],
      },
    },
  },
];

export function getTemplate(id: string) {
  return FIXTURE_TEMPLATES.find((t) => t.id === id);
}
