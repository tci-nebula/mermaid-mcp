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

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);

// cli.js sits next to the package's exported main entry (src/index.js)
const mmdcCli = join(dirname(require.resolve('@mermaid-js/mermaid-cli')), 'cli.js');

const server = new Server(
  { name: 'mermaid-render-mcp', version: '1.1.0' },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'render_diagram',
      description:
        'Render Mermaid diagram syntax into a PNG, SVG, or PDF. ' +
        'Returns the result as base64-encoded data, or writes it to output_path if given.',
      inputSchema: {
        type: 'object',
        properties: {
          syntax: {
            type: 'string',
            description: 'Mermaid diagram definition (e.g. flowchart, sequenceDiagram, etc.)',
          },
          format: {
            type: 'string',
            enum: ['png', 'svg', 'pdf'],
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
          pdfFit: {
            type: 'boolean',
            default: true,
            description: 'Scale the PDF page to fit the diagram (PDF only).',
          },
          output_path: {
            type: 'string',
            description:
              'Absolute file path to write the result to. When given, the file is written ' +
              'to disk and no base64 data is returned — useful for documents destined for ' +
              'printing or formal submission.',
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
    pdfFit = true,
    output_path,
  } = args;

  if (!syntax || typeof syntax !== 'string' || !syntax.trim()) {
    return {
      content: [{ type: 'text', text: 'Error: syntax is required and must be a non-empty string.' }],
      isError: true,
    };
  }

  if (!['png', 'svg', 'pdf'].includes(format)) {
    return {
      content: [{ type: 'text', text: `Error: format must be png, svg, or pdf (got "${format}").` }],
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
    if (format === 'pdf' && pdfFit) {
      mmdcArgs.push('--pdfFit');
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
