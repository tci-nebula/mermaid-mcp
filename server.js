#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { execFile } from 'child_process';
import { writeFile, readFile, rm, mkdtemp } from 'fs/promises';
import { join, resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { tmpdir } from 'os';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const __dirname = dirname(fileURLToPath(import.meta.url));

const mmdcCli = resolve(
  __dirname,
  'node_modules',
  '@mermaid-js',
  'mermaid-cli',
  'src',
  'cli.js'
);

const server = new Server(
  { name: 'mermaid-mcp', version: '1.0.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'render_diagram',
      description:
        'Render Mermaid diagram syntax into a PNG or SVG image. ' +
        'Returns the image as base64-encoded data.',
      inputSchema: {
        type: 'object',
        properties: {
          syntax: {
            type: 'string',
            description: 'Mermaid diagram definition (e.g. flowchart, sequenceDiagram, etc.)',
          },
          format: {
            type: 'string',
            enum: ['png', 'svg'],
            default: 'png',
            description: 'Output format. Defaults to png.',
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
        },
        required: ['syntax'],
      },
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
  } = args;

  if (!syntax || typeof syntax !== 'string' || !syntax.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: syntax is required and must be a non-empty string.' }],
      isError: true,
    };
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

    const { stderr } = await execFileAsync(
      process.execPath,
      [mmdcCli, ...mmdcArgs],
      { timeout: 30_000 }
    );

    const data = await readFile(outputPath);
    const base64 = data.toString('base64');
    const mimeType = format === 'svg' ? 'image/svg+xml' : 'image/png';

    const warnings = stderr?.trim();
    const text = warnings
      ? `Rendered ${format.toUpperCase()} (${data.length} bytes). Note: ${warnings}`
      : `Rendered ${format.toUpperCase()} (${data.length} bytes).`;

    return {
      content: [
        { type: 'image', data: base64, mimeType },
        { type: 'text', text },
      ],
    };
  } catch (err) {
    const message = err.stderr || err.message || String(err);
    return {
      content: [{ type: 'text', text: `Render failed: ${message}` }],
      isError: true,
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
