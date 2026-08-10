// Convert Mermaid flowchart syntax to draw.io (mxGraphModel) XML.
// Only flowchart/graph diagrams are supported — they map cleanly onto
// draw.io's node/edge model. Other diagram types throw.
import dagre from 'dagre';

const SHAPE_STYLES = {
  rect: 'rounded=0;whiteSpace=wrap;html=1;',
  rounded: 'rounded=1;whiteSpace=wrap;html=1;',
  rhombus: 'rhombus;whiteSpace=wrap;html=1;',
  circle: 'ellipse;whiteSpace=wrap;html=1;',
  stadium: 'rounded=1;whiteSpace=wrap;html=1;arcSize=50;',
  subroutine: 'rect;whiteSpace=wrap;html=1;shape=process;',
  cylinder: 'shape=cylinder3;whiteSpace=wrap;html=1;',
  hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;whiteSpace=wrap;html=1;',
};

// Node bracket pairs, longest openers first so (( wins over (.
const NODE_PATTERNS = [
  { open: '(((', close: ')))', shape: 'circle' },
  { open: '((', close: '))', shape: 'circle' },
  { open: '([', close: '])', shape: 'stadium' },
  { open: '[[', close: ']]', shape: 'subroutine' },
  { open: '[(', close: ')]', shape: 'cylinder' },
  { open: '{{', close: '}}', shape: 'hexagon' },
  { open: '[', close: ']', shape: 'rect' },
  { open: '(', close: ')', shape: 'rounded' },
  { open: '{', close: '}', shape: 'rhombus' },
];

function stripQuotes(s) {
  const t = s.trim();
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1);
  return t;
}

// Parse one node token like `A[Label]`, `B{Choice}`, or bare `C`.
// Returns {id, label, shape} — label/shape null when the token is a bare id.
function parseNodeToken(token) {
  const m = token.match(/^([A-Za-z0-9_.-]+)(.*)$/s);
  if (!m) return null;
  const id = m[1];
  const rest = m[2].trim();
  if (!rest) return { id, label: null, shape: null };
  for (const p of NODE_PATTERNS) {
    if (rest.startsWith(p.open) && rest.endsWith(p.close)) {
      const label = stripQuotes(rest.slice(p.open.length, rest.length - p.close.length));
      return { id, label, shape: p.shape };
    }
  }
  return { id, label: null, shape: null };
}

// Split an edge line on arrow operators, keeping the operators.
// Handles -->, ---, -.->, ==>, <-->, and |label| segments.
const EDGE_OP = /\s*(<?[-=.]{2,}[-=.]*>?)\s*(?:\|([^|]*)\|)?\s*/;

function parseFlowchart(syntax) {
  const nodes = new Map();
  const edges = [];
  let direction = 'TD';

  const ensureNode = (tok) => {
    const parsed = parseNodeToken(tok.trim());
    if (!parsed) return null;
    const existing = nodes.get(parsed.id);
    if (existing) {
      // A later definition with an explicit label/shape wins over a bare reference.
      if (parsed.label !== null) {
        existing.label = parsed.label;
        existing.shape = parsed.shape;
      }
      return parsed.id;
    }
    nodes.set(parsed.id, {
      id: parsed.id,
      label: parsed.label ?? parsed.id,
      shape: parsed.shape ?? 'rect',
    });
    return parsed.id;
  };

  const lines = syntax
    .split('\n')
    .map((l) => l.replace(/%%.*$/, '').trim())
    .filter(Boolean);

  if (!lines.length) throw new Error('Empty diagram.');

  const header = lines[0].match(/^(?:flowchart|graph)\s+(TD|TB|BT|LR|RL)?/i);
  if (!header) {
    const kind = lines[0].split(/\s/)[0];
    throw new Error(
      `drawio export supports flowchart diagrams only (got "${kind}"). ` +
        'Use format png/svg/pdf for other diagram types.'
    );
  }
  direction = (header[1] || 'TD').toUpperCase();

  for (const line of lines.slice(1)) {
    // Ignore styling and structural directives we can't represent.
    if (/^(classDef|class|style|linkStyle|click|subgraph|end|direction)\b/i.test(line)) continue;

    if (!EDGE_OP.test(line)) {
      ensureNode(line);
      continue;
    }

    // Chained edges: A --> B -->|lbl| C
    const parts = line.split(new RegExp(EDGE_OP.source, 'g'));
    // parts alternates: node, op, label, node, op, label, node...
    for (let i = 0; i + 3 <= parts.length; i += 3) {
      const from = ensureNode(parts[i]);
      const op = parts[i + 1] ?? '';
      const label = parts[i + 2] ? stripQuotes(parts[i + 2]) : '';
      const to = ensureNode(parts[i + 3]);
      if (!from || !to) continue;
      edges.push({
        from,
        to,
        label,
        dashed: op.includes('.'),
        bidirectional: op.startsWith('<') && op.endsWith('>'),
      });
    }
  }

  if (!nodes.size) throw new Error('No nodes found in flowchart.');
  return { nodes: [...nodes.values()], edges, direction };
}

function layout(nodes, edges, direction) {
  const g = new dagre.graphlib.Graph();
  const rankdir = { TD: 'TB', TB: 'TB', BT: 'BT', LR: 'LR', RL: 'RL' }[direction];
  g.setGraph({ rankdir, nodesep: 60, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const n of nodes) {
    const label = n.label.replace(/<br\s*\/?>/gi, '\n');
    const widest = Math.max(...label.split('\n').map((l) => l.length));
    const w = Math.max(100, widest * 8 + 32);
    const h = n.shape === 'rhombus' ? 80 : 24 * label.split('\n').length + 24;
    g.setNode(n.id, { width: n.shape === 'rhombus' ? w + 40 : w, height: h });
  }
  for (const e of edges) g.setEdge(e.from, e.to);

  dagre.layout(g);
  return g;
}

function esc(s) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '&#10;');
}

export function mermaidToDrawio(syntax) {
  const { nodes, edges, direction } = parseFlowchart(syntax);
  const g = layout(nodes, edges, direction);

  const cells = [];
  for (const n of nodes) {
    const pos = g.node(n.id);
    const x = Math.round(pos.x - pos.width / 2);
    const y = Math.round(pos.y - pos.height / 2);
    cells.push(
      `<mxCell id="${esc(n.id)}" value="${esc(n.label)}" style="${SHAPE_STYLES[n.shape]}" vertex="1" parent="1">` +
        `<mxGeometry x="${x}" y="${y}" width="${Math.round(pos.width)}" height="${Math.round(pos.height)}" as="geometry"/>` +
        `</mxCell>`
    );
  }
  edges.forEach((e, i) => {
    let style = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;';
    if (e.dashed) style += 'dashed=1;';
    if (e.bidirectional) style += 'startArrow=classic;startFill=1;';
    cells.push(
      `<mxCell id="e${i}" value="${esc(e.label)}" style="${style}" edge="1" parent="1" source="${esc(e.from)}" target="${esc(e.to)}">` +
        `<mxGeometry relative="1" as="geometry"/>` +
        `</mxCell>`
    );
  });

  return (
    `<mxfile host="mermaid-render-mcp" type="device">` +
    `<diagram name="Page-1" id="page-1">` +
    `<mxGraphModel dx="800" dy="600" grid="1" gridSize="10" guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" pageWidth="850" pageHeight="1100" math="0" shadow="0">` +
    `<root><mxCell id="0"/><mxCell id="1" parent="0"/>` +
    cells.join('') +
    `</root></mxGraphModel></diagram></mxfile>`
  );
}
