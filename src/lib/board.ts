/**
 * Quadro: lousa livre + mapa mental.
 *
 * Tudo aqui é lógica pura (sem React), para ser testável: modelo de dados,
 * criação de nós, posição de ramos do mapa mental, curvas das conexões e
 * leitura segura do que foi salvo.
 */

export type BoardNodeKind = "note" | "topic" | "text" | "shape";
export type BoardShape = "rect" | "ellipse" | "diamond";
export type BoardColor = "steel" | "graphite" | "amber" | "sage" | "sky" | "rose" | "lilac";
export type Direction = "right" | "left" | "up" | "down";

export interface BoardNode {
  id: string;
  kind: BoardNodeKind;
  x: number;
  y: number;
  /** Notas e formas têm tamanho fixo (redimensionável); tópicos e textos se ajustam ao conteúdo. */
  w?: number;
  h?: number;
  text: string;
  color: BoardColor;
  shape?: BoardShape;
  /** Tópico central de um mapa mental. */
  root?: boolean;
}

export interface BoardEdge {
  id: string;
  from: string;
  to: string;
}

export interface BoardDoc {
  nodes: BoardNode[];
  edges: BoardEdge[];
  view: { x: number; y: number; zoom: number };
}

export interface Board {
  id: string;
  name: string;
  doc: BoardDoc;
  updatedAt: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const MIN_ZOOM = 0.2;
export const MAX_ZOOM = 3;

export const BOARD_COLORS: Record<
  BoardColor,
  { label: string; bg: string; fg: string; border: string; ink: string }
> = {
  steel: { label: "Aço", bg: "#e6e9ed", fg: "#1b1f24", border: "#c3c9d1", ink: "currentColor" },
  graphite: {
    label: "Grafite",
    bg: "#2b3038",
    fg: "#f1f3f5",
    border: "#4a515c",
    ink: "currentColor",
  },
  amber: { label: "Âmbar", bg: "#f3e6b8", fg: "#3a2f10", border: "#dcc685", ink: "#b0811c" },
  sage: { label: "Sálvia", bg: "#d4e7d9", fg: "#1d3325", border: "#afcdb8", ink: "#3f8a5a" },
  sky: { label: "Céu", bg: "#d4e3f2", fg: "#16283b", border: "#aec6e0", ink: "#3b74b0" },
  rose: { label: "Rosa", bg: "#f2d7d7", fg: "#3b1a1a", border: "#ddb3b3", ink: "#b5524f" },
  lilac: { label: "Lilás", bg: "#e2dcf1", fg: "#251d3b", border: "#c4b9e1", ink: "#7058b5" },
};

export const DEFAULT_SIZE: Record<BoardNodeKind, { w: number; h: number }> = {
  note: { w: 200, h: 150 },
  shape: { w: 170, h: 100 },
  topic: { w: 140, h: 44 },
  text: { w: 160, h: 32 },
};

export const createId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export const emptyDoc = (): BoardDoc => ({ nodes: [], edges: [], view: { x: 0, y: 0, zoom: 1 } });

export function createBoard(name = "Novo quadro"): Board {
  return { id: createId(), name, doc: emptyDoc(), updatedAt: new Date().toISOString() };
}

/** Cria um nó centralizado no ponto (x, y) do mundo. */
export function createNode(
  kind: BoardNodeKind,
  x: number,
  y: number,
  patch: Partial<BoardNode> = {},
): BoardNode {
  const size = DEFAULT_SIZE[kind];
  const fixed = kind === "note" || kind === "shape";
  return {
    id: createId(),
    kind,
    x: Math.round(x - size.w / 2),
    y: Math.round(y - size.h / 2),
    ...(fixed ? { w: size.w, h: size.h } : {}),
    text: "",
    color: kind === "note" ? "amber" : "steel",
    ...(kind === "shape" ? { shape: "rect" as const } : {}),
    ...patch,
  };
}

export const clampZoom = (zoom: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));

/** Zoom ancorado num ponto da tela: o ponto sob o cursor continua parado. */
export function zoomAt(view: BoardDoc["view"], nextZoom: number, screenX: number, screenY: number) {
  const zoom = clampZoom(nextZoom);
  const worldX = (screenX - view.x) / view.zoom;
  const worldY = (screenY - view.y) / view.zoom;
  return { zoom, x: screenX - worldX * zoom, y: screenY - worldY * zoom };
}

export const toWorld = (view: BoardDoc["view"], screenX: number, screenY: number) => ({
  x: (screenX - view.x) / view.zoom,
  y: (screenY - view.y) / view.zoom,
});

export function nodeRect(node: BoardNode, measured?: { w: number; h: number }): Rect {
  const fallback = DEFAULT_SIZE[node.kind];
  return {
    x: node.x,
    y: node.y,
    w: node.w ?? measured?.w ?? fallback.w,
    h: node.h ?? measured?.h ?? fallback.h,
  };
}

export const intersects = (a: Rect, b: Rect) =>
  a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

export function boundsOf(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  const minX = Math.min(...rects.map((r) => r.x));
  const minY = Math.min(...rects.map((r) => r.y));
  const maxX = Math.max(...rects.map((r) => r.x + r.w));
  const maxY = Math.max(...rects.map((r) => r.y + r.h));
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** Enquadra o conteúdo na área visível, com margem. */
export function fitView(bounds: Rect | null, viewportW: number, viewportH: number, padding = 80) {
  if (!bounds || viewportW <= 0 || viewportH <= 0)
    return { x: viewportW / 2, y: viewportH / 2, zoom: 1 };
  const zoom = clampZoom(
    Math.min(
      (viewportW - padding * 2) / Math.max(bounds.w, 1),
      (viewportH - padding * 2) / Math.max(bounds.h, 1),
      1.25,
    ),
  );
  return {
    zoom,
    x: viewportW / 2 - (bounds.x + bounds.w / 2) * zoom,
    y: viewportH / 2 - (bounds.y + bounds.h / 2) * zoom,
  };
}

/** Curva suave entre as laterais mais próximas dos dois nós. */
export function edgePath(a: Rect, b: Rect): string {
  const ac = { x: a.x + a.w / 2, y: a.y + a.h / 2 };
  const bc = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const dx = bc.x - ac.x;
  const dy = bc.y - ac.y;
  let start: { x: number; y: number };
  let end: { x: number; y: number };
  let c1: { x: number; y: number };
  let c2: { x: number; y: number };
  if (Math.abs(dx) >= Math.abs(dy)) {
    const sign = dx >= 0 ? 1 : -1;
    start = { x: ac.x + (sign * a.w) / 2, y: ac.y };
    end = { x: bc.x - (sign * b.w) / 2, y: bc.y };
    const k = Math.max(36, Math.abs(end.x - start.x) * 0.5);
    c1 = { x: start.x + sign * k, y: start.y };
    c2 = { x: end.x - sign * k, y: end.y };
  } else {
    const sign = dy >= 0 ? 1 : -1;
    start = { x: ac.x, y: ac.y + (sign * a.h) / 2 };
    end = { x: bc.x, y: bc.y - (sign * b.h) / 2 };
    const k = Math.max(30, Math.abs(end.y - start.y) * 0.5);
    c1 = { x: start.x, y: start.y + sign * k };
    c2 = { x: end.x, y: end.y - sign * k };
  }
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M ${r(start.x)} ${r(start.y)} C ${r(c1.x)} ${r(c1.y)}, ${r(c2.x)} ${r(c2.y)}, ${r(end.x)} ${r(end.y)}`;
}

const GAP_X = 84;
const GAP_Y = 22;

/**
 * Posição de um novo ramo do mapa mental: ao lado do pai, na direção pedida,
 * logo depois dos irmãos que já existem naquele lado, sem sobrepor outros nós.
 */
export function childPosition(
  parent: Rect,
  direction: Direction,
  occupied: Rect[],
  childSize = DEFAULT_SIZE.topic,
): { x: number; y: number } {
  const horizontal = direction === "right" || direction === "left";
  let x: number;
  let y: number;
  if (direction === "right") {
    x = parent.x + parent.w + GAP_X;
    y = parent.y + parent.h / 2 - childSize.h / 2;
  } else if (direction === "left") {
    x = parent.x - GAP_X - childSize.w;
    y = parent.y + parent.h / 2 - childSize.h / 2;
  } else if (direction === "down") {
    x = parent.x + parent.w / 2 - childSize.w / 2;
    y = parent.y + parent.h + GAP_X * 0.7;
  } else {
    x = parent.x + parent.w / 2 - childSize.w / 2;
    y = parent.y - GAP_X * 0.7 - childSize.h;
  }
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const pad = { x: x - 6, y: y - 6, w: childSize.w + 12, h: childSize.h + 12 };
    if (!occupied.some((rect) => intersects(pad, rect))) break;
    if (horizontal) y += childSize.h + GAP_Y;
    else x += childSize.w + GAP_Y;
  }
  return { x: Math.round(x), y: Math.round(y) };
}

/** Lado em que um filho existente está em relação ao pai (para Enter = irmão). */
export function directionBetween(parent: Rect, child: Rect): Direction {
  const dx = child.x + child.w / 2 - (parent.x + parent.w / 2);
  const dy = child.y + child.h / 2 - (parent.y + parent.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? "right" : "left";
  return dy >= 0 ? "down" : "up";
}

/** Remove nós e todas as conexões que tocavam neles. */
export function removeNodes(doc: BoardDoc, ids: Set<string>): BoardDoc {
  return {
    ...doc,
    nodes: doc.nodes.filter((node) => !ids.has(node.id)),
    edges: doc.edges.filter((edge) => !ids.has(edge.from) && !ids.has(edge.to)),
  };
}

/** Duplica nós (e as conexões entre eles) com um pequeno deslocamento. */
export function duplicateNodes(
  doc: BoardDoc,
  ids: Set<string>,
  offset = 28,
): { doc: BoardDoc; created: string[] } {
  const map = new Map<string, string>();
  const copies = doc.nodes
    .filter((node) => ids.has(node.id))
    .map((node) => {
      const id = createId();
      map.set(node.id, id);
      const { root: _root, ...rest } = node;
      return { ...rest, id, x: node.x + offset, y: node.y + offset };
    });
  const edgeCopies = doc.edges
    .filter((edge) => map.has(edge.from) && map.has(edge.to))
    .map((edge) => ({ id: createId(), from: map.get(edge.from)!, to: map.get(edge.to)! }));
  return {
    doc: { ...doc, nodes: [...doc.nodes, ...copies], edges: [...doc.edges, ...edgeCopies] },
    created: copies.map((copy) => copy.id),
  };
}

export function hasEdge(doc: BoardDoc, a: string, b: string) {
  return doc.edges.some(
    (edge) => (edge.from === a && edge.to === b) || (edge.from === b && edge.to === a),
  );
}

const KINDS: BoardNodeKind[] = ["note", "topic", "text", "shape"];
const COLORS = Object.keys(BOARD_COLORS) as BoardColor[];
const SHAPES: BoardShape[] = ["rect", "ellipse", "diamond"];
const num = (value: unknown, fallback: number) =>
  typeof value === "number" && Number.isFinite(value) ? value : fallback;

/** Lê um quadro salvo descartando o que estiver corrompido, sem lançar erro. */
export function parseBoard(raw: unknown): Board | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.id !== "string") return null;
  const doc = (value.doc ?? {}) as Record<string, unknown>;
  const nodes = (Array.isArray(doc.nodes) ? doc.nodes : [])
    .map((item): BoardNode | null => {
      if (!item || typeof item !== "object") return null;
      const node = item as Record<string, unknown>;
      if (typeof node.id !== "string" || !KINDS.includes(node.kind as BoardNodeKind)) return null;
      return {
        id: node.id,
        kind: node.kind as BoardNodeKind,
        x: num(node.x, 0),
        y: num(node.y, 0),
        ...(typeof node.w === "number" && Number.isFinite(node.w)
          ? { w: Math.max(60, node.w) }
          : {}),
        ...(typeof node.h === "number" && Number.isFinite(node.h)
          ? { h: Math.max(32, node.h) }
          : {}),
        text: typeof node.text === "string" ? node.text : "",
        color: COLORS.includes(node.color as BoardColor) ? (node.color as BoardColor) : "steel",
        ...(SHAPES.includes(node.shape as BoardShape) ? { shape: node.shape as BoardShape } : {}),
        ...(node.root === true ? { root: true } : {}),
      };
    })
    .filter((node): node is BoardNode => node !== null);
  const ids = new Set(nodes.map((node) => node.id));
  const edges = (Array.isArray(doc.edges) ? doc.edges : [])
    .filter(
      (edge): edge is BoardEdge =>
        !!edge &&
        typeof edge === "object" &&
        typeof (edge as BoardEdge).id === "string" &&
        ids.has((edge as BoardEdge).from) &&
        ids.has((edge as BoardEdge).to),
    )
    .map((edge) => ({ id: edge.id, from: edge.from, to: edge.to }));
  const view = (doc.view ?? {}) as Record<string, unknown>;
  return {
    id: value.id,
    name: typeof value.name === "string" && value.name.trim() ? value.name : "Quadro sem nome",
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString(),
    doc: {
      nodes,
      edges,
      view: { x: num(view.x, 0), y: num(view.y, 0), zoom: clampZoom(num(view.zoom, 1)) },
    },
  };
}

/** Une quadros locais e remotos ficando com a versão mais recente de cada um. */
export function mergeBoards(local: Board[], remote: Board[]): Board[] {
  const byId = new Map<string, Board>();
  for (const board of [...local, ...remote]) {
    const current = byId.get(board.id);
    if (!current || board.updatedAt > current.updatedAt) byId.set(board.id, board);
  }
  return [...byId.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}
