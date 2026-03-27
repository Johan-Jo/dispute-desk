/**
 * Bidirectional adapter between the legacy body_json shape and the block editor format.
 *
 * Legacy shape (stored in content_localizations.body_json):
 *   { mainHtml, keyTakeaways, faq, disclaimer, updateLog }
 *
 * Block editor shape:
 *   EditorBlock[] — ordered array of typed blocks.
 */

export type BlockType =
  | "html"
  | "heading"
  | "paragraph"
  | "list"
  | "callout"
  | "code"
  | "quote"
  | "divider"
  | "image"
  | "key-takeaways"
  | "faq"
  | "disclaimer"
  | "update-log";

export interface EditorBlock {
  id: string;
  type: BlockType;
  data: Record<string, unknown>;
}

export interface LegacyBodyJson {
  mainHtml?: string;
  keyTakeaways?: string[];
  faq?: Array<{ q: string; a: string }>;
  disclaimer?: string;
  updateLog?: Array<{ at: string; note: string }>;
}

let counter = 0;
function uid(): string {
  return `blk_${Date.now()}_${++counter}`;
}

/* ── Legacy → Blocks ──────────────────────────────────────────────── */

export function bodyJsonToBlocks(raw: Record<string, unknown> | null): EditorBlock[] {
  if (!raw) return [{ id: uid(), type: "html", data: { html: "" } }];

  const body = raw as LegacyBodyJson;
  const blocks: EditorBlock[] = [];

  if (body.mainHtml) {
    blocks.push({ id: uid(), type: "html", data: { html: body.mainHtml } });
  }

  if (body.keyTakeaways?.length) {
    blocks.push({
      id: uid(),
      type: "key-takeaways",
      data: { items: body.keyTakeaways },
    });
  }

  if (body.faq?.length) {
    blocks.push({
      id: uid(),
      type: "faq",
      data: { items: body.faq },
    });
  }

  if (body.disclaimer) {
    blocks.push({
      id: uid(),
      type: "disclaimer",
      data: { text: body.disclaimer },
    });
  }

  if (body.updateLog?.length) {
    blocks.push({
      id: uid(),
      type: "update-log",
      data: { entries: body.updateLog },
    });
  }

  if (blocks.length === 0) {
    blocks.push({ id: uid(), type: "html", data: { html: "" } });
  }

  return blocks;
}

/* ── Blocks → Legacy ──────────────────────────────────────────────── */

export function blocksToBodyJson(blocks: EditorBlock[]): LegacyBodyJson {
  const result: LegacyBodyJson = {};

  const htmlParts: string[] = [];

  for (const block of blocks) {
    switch (block.type) {
      case "html":
        if (block.data.html) htmlParts.push(block.data.html as string);
        break;
      case "paragraph":
        if (block.data.text) htmlParts.push(`<p>${block.data.text as string}</p>`);
        break;
      case "heading": {
        const level = (block.data.level as number) ?? 2;
        const text = block.data.text as string;
        if (text) htmlParts.push(`<h${level}>${text}</h${level}>`);
        break;
      }
      case "list": {
        const items = (block.data.items as string[]) ?? [];
        const tag = block.data.ordered ? "ol" : "ul";
        if (items.length) {
          htmlParts.push(`<${tag}>${items.map((i) => `<li>${i}</li>`).join("")}</${tag}>`);
        }
        break;
      }
      case "callout":
        if (block.data.text) {
          htmlParts.push(
            `<blockquote class="callout"><strong>${(block.data.label as string) ?? "Note"}</strong><br/>${block.data.text as string}</blockquote>`
          );
        }
        break;
      case "code":
        if (block.data.code) {
          htmlParts.push(
            `<pre><code class="language-${(block.data.language as string) ?? ""}">${block.data.code as string}</code></pre>`
          );
        }
        break;
      case "quote":
        if (block.data.text) {
          const cite = block.data.citation ? `<cite>${block.data.citation as string}</cite>` : "";
          htmlParts.push(`<blockquote>${block.data.text as string}${cite}</blockquote>`);
        }
        break;
      case "divider":
        htmlParts.push("<hr/>");
        break;
      case "image":
        if (block.data.url) {
          const caption = block.data.caption ? `<figcaption>${block.data.caption as string}</figcaption>` : "";
          htmlParts.push(`<figure><img src="${block.data.url as string}" alt="${(block.data.alt as string) ?? ""}" />${caption}</figure>`);
        }
        break;
      case "key-takeaways":
        result.keyTakeaways = (block.data.items as string[]) ?? [];
        break;
      case "faq":
        result.faq = (block.data.items as Array<{ q: string; a: string }>) ?? [];
        break;
      case "disclaimer":
        result.disclaimer = (block.data.text as string) ?? "";
        break;
      case "update-log":
        result.updateLog = (block.data.entries as Array<{ at: string; note: string }>) ?? [];
        break;
    }
  }

  if (htmlParts.length > 0) {
    result.mainHtml = htmlParts.join("\n");
  }

  return result;
}

/* ── Block factory ────────────────────────────────────────────────── */

export function createBlock(type: BlockType): EditorBlock {
  const id = uid();
  switch (type) {
    case "html":
      return { id, type, data: { html: "" } };
    case "paragraph":
      return { id, type, data: { text: "" } };
    case "heading":
      return { id, type, data: { text: "", level: 2 } };
    case "list":
      return { id, type, data: { items: [""], ordered: false } };
    case "callout":
      return { id, type, data: { text: "", label: "Note" } };
    case "code":
      return { id, type, data: { code: "", language: "" } };
    case "quote":
      return { id, type, data: { text: "", citation: "" } };
    case "divider":
      return { id, type, data: {} };
    case "image":
      return { id, type, data: { url: "", alt: "", caption: "" } };
    case "key-takeaways":
      return { id, type, data: { items: [""] } };
    case "faq":
      return { id, type, data: { items: [{ q: "", a: "" }] } };
    case "disclaimer":
      return { id, type, data: { text: "" } };
    case "update-log":
      return { id, type, data: { entries: [{ at: new Date().toISOString().split("T")[0], note: "" }] } };
    default:
      return { id, type: "paragraph", data: { text: "" } };
  }
}

export const BLOCK_TYPE_LABELS: Record<BlockType, string> = {
  html: "Rich HTML",
  paragraph: "Paragraph",
  heading: "Heading",
  list: "List",
  callout: "Callout",
  code: "Code",
  quote: "Quote",
  divider: "Divider",
  image: "Image",
  "key-takeaways": "Key Takeaways",
  faq: "FAQ",
  disclaimer: "Disclaimer",
  "update-log": "Update Log",
};
