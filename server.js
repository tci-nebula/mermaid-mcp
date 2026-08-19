#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { join, dirname } from 'path';
import { tmpdir } from 'os';
import { promisify } from 'util';
import { createRequire } from 'module';
import { mermaidToDrawio } from './drawio.js';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// cli.js sits next to the package's exported main entry (src/index.js)
const mmdcCli = join(dirname(require.resolve('@mermaid-js/mermaid-cli')), 'cli.js');

const MAX_SYNTAX_CHARS = 100_000;

function textError(text) {
  return { content: [{ type: 'text', text }], isError: true };
}

// Build a configured MCP server. output_path is disabled in HTTP mode:
// writing to the remote host's own disk is useless to the caller and a
// path-traversal surface.
export function createServer({ allowOutputPath = true } = {}) {
  const server = new Server(
    { name: 'mermaid-render-mcp', version: '1.3.0' },
    { capabilities: { tools: {} } }
  );

  const properties = {
    syntax: {
      type: 'string',
      description: 'Mermaid diagram definition (e.g. flowchart, sequenceDiagram, etc.)',
    },
    format: {
      type: 'string',
      enum: ['png', 'svg', 'pdf', 'drawio'],
      default: 'png',
      description:
        'Output format. Defaults to png. drawio produces an editable draw.io XML file (flowcharts only).',
    },
    theme: {
      type: 'string',
      enum: ['default', 'dark', 'neutral', 'forest'],
      default: 'default',
      description: 'Visual theme for the diagram.',
    },
    background: {
      type: 'string',
      default: 'white',
      description: 'Background colour (CSS colour string or "transparent").',
    },
    width: {
      type: 'number',
      default: 1200,
      description: 'Canvas width in pixels (PNG only).',
    },
    pdfFit: {
      type: 'boolean',
      default: true,
      description: 'Scale the PDF page to fit the diagram (PDF only).',
    },
  };
  if (allowOutputPath) {
    properties.output_path = {
      type: 'string',
      description:
        'Absolute file path to write the result to. When given, the file is written ' +
        'to disk and no base64 data is returned — useful for documents destined for ' +
        'printing or formal submission.',
    };
  }

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        name: 'render_diagram',
        description:
          'Render Mermaid diagram syntax into a PNG, SVG, or PDF — or convert it to an ' +
          'editable draw.io (.drawio) file. Returns the result as base64-encoded data ' +
          '(drawio: XML text)' +
          (allowOutputPath ? ', or writes it to output_path if given' : '') +
          '. drawio format supports flowcharts only.',
        inputSchema: { type: 'object', properties, required: ['syntax'] },
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name !== 'render_diagram') {
      throw new Error(`Unknown tool: ${name}`);
    }

    const {
      syntax,
      format = 'png',
      theme = 'default',
      background = 'white',
      width = 1200,
      pdfFit = true,
      output_path,
    } = args;

    if (!syntax || typeof syntax !== 'string' || !syntax.trim()) {
      return textError('Error: syntax is required and must be a non-empty string.');
    }
    if (syntax.length > MAX_SYNTAX_CHARS) {
      return textError(`Error: syntax exceeds ${MAX_SYNTAX_CHARS} characters.`);
    }
    if (!['png', 'svg', 'pdf', 'drawio'].includes(format)) {
      return textError(`Error: format must be png, svg, pdf, or drawio (got "${format}").`);
    }
    if (output_path && !allowOutputPath) {
      return textError('Error: output_path is not available on the hosted server.');
    }

    if (format === 'drawio') {
      try {
        const xml = mermaidToDrawio(syntax.trim());
        if (output_path) {
          await writeFile(output_path, xml, 'utf8');
          return {
            content: [
              {
                type: 'text',
                text: `Converted to draw.io XML (${xml.length} chars) written to ${output_path}.`,
              },
            ],
          };
        }
        return { content: [{ type: 'text', text: xml }] };
      } catch (err) {
        return textError(`drawio conversion failed: ${err.message}`);
      }
    }

    const tmpDir = await mkdtemp(join(tmpdir(), 'mermaid-mcp-'));
    const inputPath = join(tmpDir, 'input.mmd');
    const outputPath = join(tmpDir, `output.${format}`);

    try {
      await writeFile(inputPath, syntax.trim(), 'utf8');

      const mmdcArgs = [
        '-i', inputPath,
        '-o', outputPath,
        '-t', theme,
        '-b', background,
      ];
      if (format === 'png') {
        mmdcArgs.push('-w', String(width));
      }
      if (format === 'pdf' && pdfFit) {
        mmdcArgs.push('--pdfFit');
      }
      // Set in the Docker image / CI to point Puppeteer at a system Chromium.
      if (process.env.MERMAID_PUPPETEER_CONFIG) {
        mmdcArgs.push('-p', process.env.MERMAID_PUPPETEER_CONFIG);
      }

      const { stderr } = await execFileAsync(
        process.execPath,
        [mmdcCli, ...mmdcArgs],
        { timeout: 30_000 }
      );

      const data = await readFile(outputPath);
      const warnings = stderr?.trim();
      const note = warnings ? ` Note: ${warnings}` : '';

      if (output_path) {
        await writeFile(output_path, data);
        return {
          content: [
            {
              type: 'text',
              text: `Rendered ${format.toUpperCase()} (${data.length} bytes) written to ${output_path}.${note}`,
            },
          ],
        };
      }

      const base64 = data.toString('base64');
      const text = `Rendered ${format.toUpperCase()} (${data.length} bytes).${note}`;

      if (format === 'pdf') {
        return {
          content: [
            {
              type: 'resource',
              resource: {
                uri: 'render://diagram.pdf',
                mimeType: 'application/pdf',
                blob: base64,
              },
            },
            { type: 'text', text },
          ],
        };
      }

      const mimeType = format === 'svg' ? 'image/svg+xml' : 'image/png';
      return {
        content: [
          { type: 'image', data: base64, mimeType },
          { type: 'text', text },
        ],
      };
    } catch (err) {
      const message = err.stderr || err.message || String(err);
      return textError(`Render failed: ${message}`);
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  });

  return server;
}

async function startHttp(port) {
  const { createServer: createHttpServer } = await import('http');
  const { StreamableHTTPServerTransport } = await import(
    '@modelcontextprotocol/sdk/server/streamableHttp.js'
  );

  const authToken = process.env.AUTH_TOKEN;
  const MAX_BODY = 512 * 1024;

  const httpServer = createHttpServer(async (req, res) => {
    if (req.method === 'GET' && (req.url === '/' || req.url === '/healthz')) {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end('mermaid-render-mcp: POST /mcp\n');
      return;
    }
    if (!req.url.startsWith('/mcp')) {
      res.writeHead(404).end();
      return;
    }
    if (authToken && req.headers.authorization !== `Bearer ${authToken}`) {
      res.writeHead(401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'unauthorized' }));
      return;
    }

    let body = '';
    let overflow = false;
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > MAX_BODY) {
        overflow = true;
        req.destroy();
      }
    });
    req.on('end', async () => {
      if (overflow) return;
      let parsed;
      try {
        parsed = body ? JSON.parse(body) : undefined;
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid JSON' }));
        return;
      }
      try {
        // Stateless: fresh server + transport per request.
        const server = createServer({ allowOutputPath: false });
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        res.on('close', () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        await transport.handleRequest(req, res, parsed);
      } catch (err) {
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: String(err?.message || err) }));
        }
      }
    });
  });

  httpServer.listen(port, () => {
    console.error(`mermaid-render-mcp listening on :${port}/mcp`);
  });
}

const isMain =
  process.argv[1] && import.meta.url === (await import('url')).pathToFileURL(process.argv[1]).href;

if (isMain) {
  const transportMode = process.env.MCP_TRANSPORT || (process.env.PORT ? 'http' : 'stdio');
  if (transportMode === 'http') {
    await startHttp(Number(process.env.PORT) || 3000);
  } else {
    const server = createServer();
    const transport = new StdioServerTransport();
    await server.connect(transport);
  }
}
