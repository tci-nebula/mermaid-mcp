# mermaid-mcp

[![test](https://github.com/tci-nebula/mermaid-mcp/actions/workflows/test.yml/badge.svg)](https://github.com/tci-nebula/mermaid-mcp/actions/workflows/test.yml) [![npm](https://img.shields.io/npm/v/mermaid-render-mcp)](https://www.npmjs.com/package/mermaid-render-mcp)

An [MCP](https://modelcontextprotocol.io/) server that renders [Mermaid](https://mermaid.js.org/) diagrams to PNG, SVG, or PDF — or converts them to editable [draw.io](https://www.drawio.com/) files. Give your LLM the ability to turn diagram syntax into actual images and documents.

## Quick start

### Claude Code

```bash
claude mcp add mermaid -- npx -y mermaid-render-mcp
```

### Claude Desktop

Add to `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "mermaid": {
      "command": "npx",
      "args": ["-y", "mermaid-render-mcp"]
    }
  }
}
```

> **Note:** the first run downloads headless Chromium (~150 MB), so the initial startup takes a few minutes. If you only need flowcharts and can work with editable files, the [`drawio` fast path](#the-drawio-fast-path-no-chromium) skips Chromium entirely.

### Docker

No Node.js or Chromium download needed — the image ships with everything (including CJK fonts for Japanese/Chinese/Korean labels):

```bash
claude mcp add mermaid -- docker run -i --rm tcinebula/mermaid-render-mcp
```

To use `output_path`, mount a host directory and write into it:

```json
{
  "mcpServers": {
    "mermaid": {
      "command": "docker",
      "args": ["run", "-i", "--rm", "-v", "C:\\diagrams:/out", "tcinebula/mermaid-render-mcp"]
    }
  }
}
```

Then pass `output_path: "/out/figure.pdf"` and the file appears in `C:\diagrams`.

### Remote / self-hosted (HTTP)

The same server speaks [Streamable HTTP](https://modelcontextprotocol.io/docs/concepts/transports) when `PORT` is set (or `MCP_TRANSPORT=http`), so it can be deployed to any container host — Railway, Fly.io, etc. — straight from the Dockerfile:

- Endpoint: `POST /mcp` (health check at `/healthz`)
- Set `AUTH_TOKEN` to require `Authorization: Bearer <token>`
- `output_path` is disabled in HTTP mode; base64/XML responses only

### From source

```bash
git clone https://github.com/tci-nebula/mermaid-mcp.git
cd mermaid-mcp
npm install
claude mcp add mermaid -- node /path/to/mermaid-mcp/server.js
```

## Tool: `render_diagram`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `syntax` | string | *(required)* | Mermaid diagram definition |
| `format` | `png` \| `svg` \| `pdf` \| `drawio` | `png` | Output format (`drawio` = editable draw.io XML, flowcharts only) |
| `theme` | `default` \| `dark` \| `neutral` \| `forest` | `default` | Visual theme |
| `background` | string | `white` | CSS colour or `transparent` |
| `width` | number | `1200` | Canvas width in px (PNG only) |
| `pdfFit` | boolean | `true` | Scale the PDF page to fit the diagram (PDF only) |
| `output_path` | string | — | Write the result to this file path instead of returning base64 |

Returns the rendered image as base64-encoded data so MCP clients can display it inline — or, with `output_path`, writes the file to disk (handy for PDFs destined for printing or formal document submission).

### Example

Ask your LLM:

> "Draw me a flowchart of the OAuth login flow"

It generates the Mermaid syntax, calls `render_diagram`, and you get back a PNG.

## The `drawio` fast path (no Chromium)

`format: "drawio"` is the one output that never touches a browser. It's pure JavaScript — parse, lay out with dagre, emit XML — so there's no Chromium download, no ~150 MB install, and no multi-minute first run. Conversion is effectively instant.

Reach for it when:

- you want the diagram **editable** rather than flat — every shape stays a real draw.io object
- you're on a constrained box (CI, a slim container, a locked-down laptop) where downloading Chromium isn't practical
- you just want the diagram now and don't need a raster image

```json
{
  "syntax": "flowchart TD\n  A[Start] --> B{OK?}\n  B -->|yes| C[Ship]\n  B -->|no| A",
  "format": "drawio",
  "output_path": "flow.drawio"
}
```

Open the result in [draw.io](https://app.diagrams.net/) (or the VS Code extension) and export to PNG/SVG/PDF from there if you do need an image — that's a complete Chromium-free round trip.

### Limits

- **Flowcharts only.** `flowchart` and `graph` diagrams convert; sequence, class, state, ER, and gantt throw an error. Use PNG/SVG/PDF for those.
- **`theme`, `background`, and `width` are ignored.** Styling is draw.io's job once the file is open.
- **Node sizes are estimated** from label length, not measured font metrics. draw.io re-measures text when it opens the file so boxes settle correctly — but treat the raw XML geometry as approximate.

Supported syntax: directions `TD` / `TB` / `BT` / `LR` / `RL`; shapes `[rect]`, `(rounded)`, `{rhombus}`, `((circle))`, `([stadium])`, `[[subroutine]]`, `[(cylinder)]`, `{{hexagon}}`; edges `-->`, `---`, `-.->`, `==>`, `<-->`, each optionally carrying a `|label|`.

## How it works

PNG, SVG, and PDF rendering shells out to [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) (bundled as a dependency), which uses a headless Chromium to render diagrams. First `npm install` downloads Chromium (~150 MB), so it takes a few minutes.

draw.io export is pure JavaScript — a flowchart parser plus [dagre](https://github.com/dagrejs/dagre) layout (the same engine Mermaid uses) emit native mxGraphModel XML, so every shape stays individually editable in draw.io.

## Requirements

- [Node.js](https://nodejs.org/) 18+

## Roadmap

- [x] PDF export (formal/legal document workflows)
- [x] draw.io XML export (editable diagrams — flowcharts)
- [x] npm package ([`mermaid-render-mcp`](https://www.npmjs.com/package/mermaid-render-mcp))
- [x] Remote-hosted server option (Streamable HTTP transport)

## License

[MIT](LICENSE)
