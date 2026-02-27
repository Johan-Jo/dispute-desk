# Figma MCP — DisputeDesk

This project has the **Figma MCP server** installed. Use it whenever the user shares a Figma or Figma Make URL or asks to match/verify designs.

## URL parsing

| URL format | fileKey | nodeId |
|------------|---------|--------|
| `figma.com/design/:fileKey/:fileName?node-id=X-Y` | `:fileKey` | `X:Y` (convert hyphen to colon) |
| `figma.com/design/:fileKey/branch/:branchKey/...` | use **branchKey** as fileKey | from `node-id` if present |
| **figma.com/make/:makeFileKey/:makeFileName** | use **makeFileKey** | see below |
| `figma.com/board/:fileKey/...` | `:fileKey` | use **get_figjam** for FigJam |

## Figma Make (prototypes / app design)

- **File key**: From the Make URL. Example:  
  `https://www.figma.com/make/5o2yOdPqVmvwjaK8eTeUUx/DisputeDesk-Shopify-App-Design?preview-route=%2Fportal%2Fhelp`  
  → **fileKey** = `5o2yOdPqVmvwjaK8eTeUUx`
- **Node ID**: Make files often use root node `0:1` for the first page. If the URL has `node-id=...`, convert hyphens to colons (e.g. `1-2` → `1:2`). If there is no node-id, try `0:1` first.
- **Tool**: `get_design_context` with `fileKey` and `nodeId` (e.g. `0:1`).
- **Response**: May return one or more **resource URIs** (e.g. `file://figma/make/image/...` or code/screenshot). Use **fetch_mcp_resource** with that URI to get the actual content.
- **Preview route**: The `preview-route=/portal/help` in the URL refers to which app route the Make prototype is showing; it does not change the API. To get the “help” frame specifically, the user may need to open that frame in Figma and share a link that includes `node-id=...` for that frame.

## Workflow (design → code)

1. **Get design**: Call `get_design_context` with `fileKey` and `nodeId` (and optionally `forceCode: true` if you need code).
2. **Use the response**: If the tool returns resource URIs, call `fetch_mcp_resource` for each URI you need (screenshot, code, etc.).
3. **Adapt to the project**: Map the design to existing components and tokens (Tailwind, `#0B1220`, `#1D4ED8`, etc.). Do not copy-paste raw Figma output; adapt to DisputeDesk’s stack.

## MCP server

- **Server name**: `user-Figma`
- **Tools**: `get_design_context`, `get_metadata`, `get_screenshot`, `get_figjam`, `generate_diagram`, Code Connect tools, etc.
- **Resources**: Use `fetch_mcp_resource` with URIs returned from the tools (e.g. `file://figma/make/...` or `file://figma/docs/...`).

## DisputeDesk Figma Make file

- **Make file**: [DisputeDesk Shopify App Design](https://www.figma.com/make/5o2yOdPqVmvwjaK8eTeUUx/DisputeDesk-Shopify-App-Design)
- **fileKey**: `5o2yOdPqVmvwjaK8eTeUUx`
- **Help section**: Preview route `/portal/help`. The root node `0:1` returns the **marketing/landing** frame (hero + Review Queue), not the help page. To match the portal help UI to Figma:
  1. In Figma Make, open the **Help** frame (the one that shows `/portal/help`).
  2. Right‑click the frame → **Copy link** (or Copy/paste link to frame).
  3. From the URL, copy the `node-id=...` value and convert hyphens to colons (e.g. `123-456` → `123:456`).
  4. Call `get_design_context` with `fileKey: "5o2yOdPqVmvwjaK8eTeUUx"` and `nodeId: "<that-id>"`, then update `app/(portal)/portal/help/page.tsx` to match.
