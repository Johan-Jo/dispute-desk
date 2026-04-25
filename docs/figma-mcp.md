# Figma MCP — DisputeDesk

This project uses **Figma's official Dev Mode MCP Server** (built into the Figma desktop app) to read the Figma Make design file and adapt designs to code. Use it whenever the user shares a Figma or Figma Make URL or asks to match/verify designs.

## TL;DR — getting it to work

1. **Run the Figma desktop app** (macOS or Windows). The Dev Mode MCP server starts automatically and listens on `http://127.0.0.1:3845`.
2. **Open the Figma Make file** in the desktop app (not the browser). Project file: <https://www.figma.com/make/5o2yOdPqVmvwjaK8eTeUUx/DisputeDesk-Shopify-App-Design>.
3. **Make that file the active/focused tab** in Figma desktop. The MCP server gates `tools/list` on this — without an active design/FigJam/Make tab, every call returns `"The MCP server is only available if your active tab is a design or FigJam file."`
4. Make sure `.mcp.json` (project) and `~/.claude/settings.json` (user) point at port **3845** with `"type": "http"`:
   ```json
   { "mcpServers": { "figma-official": { "type": "http", "url": "http://127.0.0.1:3845/mcp" } } }
   ```
5. **Reload the VS Code window** (Ctrl+Shift+P → "Developer: Reload Window") so Claude Code re-handshakes with the now-focused file.
6. Verify: `claude mcp list` should show `figma-official: http://127.0.0.1:3845/mcp (HTTP) - ✓ Connected`.

## Project Make file

| Field | Value |
|-------|-------|
| URL | <https://www.figma.com/make/5o2yOdPqVmvwjaK8eTeUUx/DisputeDesk-Shopify-App-Design> |
| `fileKey` | `5o2yOdPqVmvwjaK8eTeUUx` |
| Sandbox path (inside Figma) | `/workspaces/default/code/src/app/pages/shopify/...` |
| MCP resource URI prefix | `file://figma/make/source/5o2yOdPqVmvwjaK8eTeUUx/...` |

The sandbox path and the MCP URI both reference the same in-Make source tree.

## URL parsing

| URL format | fileKey | nodeId |
|------------|---------|--------|
| `figma.com/design/:fileKey/:fileName?node-id=X-Y` | `:fileKey` | `X:Y` (convert hyphen to colon) |
| `figma.com/design/:fileKey/branch/:branchKey/...` | use **branchKey** as fileKey | from `node-id` if present |
| **figma.com/make/:makeFileKey/:makeFileName** | use **makeFileKey** | empty (Make files have no node IDs — see below) |
| `figma.com/board/:fileKey/...` | `:fileKey` | use **get_figjam** for FigJam |

## Figma Make (this project's design source)

Figma **Make** files are code-based. Instead of node IDs and frames, they expose **source files** (TSX) that you fetch via MCP resources. The flow:

1. Call `get_design_context` with `nodeId: ""` (empty). For Make files this returns ~175 `resource_link` entries — one per source file in the Make sandbox.
2. Pick the URI matching the route you want to adapt. The mapping is documented in `docs/embedded-redesign-findings.md` § 2:

   | Make source URI suffix | Embedded route |
   |------------------------|----------------|
   | `src/app/pages/shopify/shopify-home.tsx` | `app/(embedded)/app/page.tsx` |
   | `src/app/pages/shopify/onboarding-wizard.tsx` | `app/(embedded)/app/setup/[step]/page.tsx` |
   | `src/app/pages/shopify/shopify-disputes.tsx` | `app/(embedded)/app/disputes/page.tsx` |
   | `src/app/pages/shopify/shopify-dispute-detail.tsx` | `app/(embedded)/app/disputes/[id]/page.tsx` |
   | `src/app/pages/shopify/shopify-packs.tsx` | `app/(embedded)/app/packs/page.tsx` |
   | `src/app/pages/shopify/shopify-rules.tsx` | `app/(embedded)/app/rules/page.tsx` |
   | `src/app/pages/shopify/shopify-plan-management.tsx` | `app/(embedded)/app/billing/page.tsx` |
   | `src/app/pages/shopify/shopify-settings.tsx` | `app/(embedded)/app/settings/page.tsx` |
   | `src/app/pages/shopify/shopify-shell.tsx` | layout / nav |

3. Call `resources/read` with that URI to get the TSX source. Adapt to Polaris + the project's design tokens (`#202223`, `#6D7175`, `#005BD3`, `#E1E3E5`, etc.) — do not paste raw Tailwind into a Polaris component without conversion.

`get_metadata` is **not supported** for Make files. The Figma REST API (`/v1/files/:fileKey`) also returns `400 File type not supported by this endpoint` for Make files.

## Tool surface (when active tab is a design/Make file)

The Figma Dev Mode MCP exposes these tools (server-name `figma-official`):

- `get_design_context` — primary tool. For Make files: returns resource links to the source tree. For Design files: returns code + screenshot + metadata for a given `nodeId` (empty = current selection).
- `get_screenshot` — render a frame as a PNG. Useful for Design files; for Make files there is no per-frame node.
- `get_variable_defs` — design tokens used in the active selection.
- `get_metadata` — frame structure (Design files only).
- `get_figjam` — FigJam board content.
- `create_design_system_rules` — generate AI rules from a design system.

After the VS Code reload, these surface to Claude Code as `mcp__figma-official__<tool>` and via the `ReadMcpResourceTool` for `file://figma/make/source/...` URIs.

## Known gotchas

### "The MCP server is only available if your active tab is a design or FigJam file."

The most common error. Cause: the active tab in Figma desktop is on a non-design surface (Home, Settings, Recent files). Fix:

1. Click on the open Make file's tab in Figma desktop.
2. If Claude Code already cached "no tools" from a prior failed handshake, **reload the VS Code window** so Claude Code re-handshakes.

### `figma-developer-mcp` (GLips' npm package) ≠ this server

Earlier project notes referenced running `npx -y figma-developer-mcp --port 3333`. **That is a different server** (Glips' `figma-developer-mcp`) and is **not what this project uses** — its tools are `get_figma_data` and `download_figma_images`, not `get_design_context`. Do not run it. The Figma desktop app's built-in Dev Mode MCP server on port **3845** is the canonical server.

If you find a stale `npx figma-developer-mcp` process running, kill it: it can sit on a port and confuse diagnostics.

### Transport: Streamable HTTP, not legacy SSE

The Figma Dev Mode MCP server exposes both `/sse` (legacy) and `/mcp` (Streamable HTTP). Configure Claude Code to use **`/mcp` with `"type": "http"`** — the legacy `/sse` endpoint can return 500s on some versions, and Streamable HTTP supports concurrent sessions (so multiple clients can use the server at once without "Server transport conflict").

### Direct CLI invocation (when ToolSearch can't see the tools)

If `claude mcp list` shows `figma-official: ✓ Connected` but `ToolSearch` still doesn't surface the tools (cache mismatch from an earlier failed handshake), bypass Claude Code's MCP client and call the server directly via Node:

```js
// /tmp/figma-mcp/get-context.mjs
const url = "http://127.0.0.1:3845/mcp";
const headers = { "Accept": "application/json, text/event-stream", "Content-Type": "application/json" };
async function rpc(payload, sessionId) {
  const h = { ...headers }; if (sessionId) h["mcp-session-id"] = sessionId;
  const r = await fetch(url, { method: "POST", headers: h, body: JSON.stringify(payload) });
  return { sessionId: r.headers.get("mcp-session-id") || sessionId, text: await r.text() };
}
function parseSse(t) { const d = t.split("\n").find(l => l.startsWith("data: ")); return d ? JSON.parse(d.slice(6)) : null; }

const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "diag", version: "1.0" } } });
await rpc({ jsonrpc: "2.0", method: "notifications/initialized" }, init.sessionId);
const ctx = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/call",
  params: { name: "get_design_context", arguments: { nodeId: "", clientLanguages: "typescript", clientFrameworks: "react,next" } } }, init.sessionId);
console.log(parseSse(ctx.text));
```

Same protocol, same answers — it just skips Claude Code's MCP client. Use `resources/read` with `params: { uri: "file://figma/make/source/..." }` to fetch a specific source file.

## Workflow (design → code)

1. **Confirm setup** — Figma desktop running, Make file open and focused, `claude mcp list` shows ✓ Connected.
2. **Get the tree** — `get_design_context` with empty `nodeId` to list resource URIs.
3. **Read the source** — `resources/read` for the URI matching the route you're adapting (see mapping table above).
4. **Adapt to Polaris** — map Tailwind classes to project design tokens; reuse existing components (`components/ui/*`, Polaris primitives) instead of pasting raw JSX. Honor existing i18n keys.
5. **Verify** — run `npm test`, `npx tsc --noEmit`, and (for UI changes) `npm run build`. Update `docs/technical.md` per CLAUDE.md.
