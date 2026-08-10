# mermaid-mcp

An [MCP](https://modelcontextprotocol.io/) server that renders [Mermaid](https://mermaid.js.org/) diagrams to PNG or SVG. Give your LLM the ability to turn diagram syntax into actual images.

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

> **Note:** the first run downloads headless Chromium (~150 MB), so the initial startup takes a few minutes.

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
| `format` | `png` \| `svg` | `png` | Output format |
| `theme` | `default` \| `dark` \| `neutral` \| `forest` | `default` | Visual theme |
| `background` | string | `white` | CSS colour or `transparent` |
| `width` | number | `1200` | Canvas width in px (PNG only) |

Returns the rendered image as base64-encoded data, so MCP clients can display it inline.

### Example

Ask your LLM:

> "Draw me a flowchart of the OAuth login flow"

It generates the Mermaid syntax, calls `render_diagram`, and you get back a PNG.

## How it works

The server shells out to [`@mermaid-js/mermaid-cli`](https://github.com/mermaid-js/mermaid-cli) (bundled as a dependency), which uses a headless Chromium to render diagrams. First `npm install` downloads Chromium (~150 MB), so it takes a few minutes.

## Requirements

- [Node.js](https://nodejs.org/) 18+

## Roadmap

- [ ] PDF export (formal/legal document workflows)
- [ ] draw.io XML export (editable diagrams)
- [x] npm package ([`mermaid-render-mcp`](https://www.npmjs.com/package/mermaid-render-mcp))
- [ ] Remote-hosted server option

## License

[MIT](LICENSE)
