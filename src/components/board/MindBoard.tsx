import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  Circle,
  Copy,
  Diamond,
  Pencil,
  GitFork,
  Hand,
  Minus,
  MousePointer2,
  Plus,
  Redo2,
  Scan,
  Spline,
  Square,
  StickyNote,
  Trash2,
  Type,
  Undo2,
  Workflow,
} from "lucide-react";
import {
  BOARD_COLORS,
  DEFAULT_SIZE,
  boundsOf,
  childPosition,
  clampZoom,
  createId,
  createNode,
  directionBetween,
  duplicateNodes,
  edgePath,
  fitView,
  hasEdge,
  intersects,
  nodeRect,
  removeNodes,
  toWorld,
  zoomAt,
  type BoardColor,
  type BoardDoc,
  type BoardNode,
  type BoardNodeKind,
  type BoardShape,
  type Direction,
  type Rect,
} from "@/lib/board";

type Tool = "select" | "hand" | "topic" | "note" | "text" | "shape" | "connect";
type Snapshot = Pick<BoardDoc, "nodes" | "edges">;
type Gesture =
  | { mode: "pan"; sx: number; sy: number; view: BoardDoc["view"] }
  | {
      mode: "drag";
      sx: number;
      sy: number;
      origin: Map<string, { x: number; y: number }>;
      moved: boolean;
      before: Snapshot;
      clickedId: string;
      additive: boolean;
    }
  | { mode: "marquee"; sx: number; sy: number; base: Set<string> }
  | { mode: "resize"; sx: number; sy: number; id: string; w: number; h: number; before: Snapshot }
  | { mode: "pinch"; dist: number; mid: { x: number; y: number } };

const TOOLS: Array<{ id: Tool; label: string; key: string; icon: typeof Hand }> = [
  { id: "select", label: "Selecionar", key: "V", icon: MousePointer2 },
  { id: "hand", label: "Mover a tela", key: "H", icon: Hand },
  { id: "topic", label: "Tópico do mapa mental", key: "M", icon: Workflow },
  { id: "note", label: "Nota adesiva", key: "N", icon: StickyNote },
  { id: "text", label: "Texto livre", key: "T", icon: Type },
  { id: "shape", label: "Forma", key: "R", icon: Square },
  { id: "connect", label: "Conectar dois itens", key: "C", icon: Spline },
];
const PLACE_TOOLS: Tool[] = ["topic", "note", "text", "shape"];
const COLOR_KEYS = Object.keys(BOARD_COLORS) as BoardColor[];

const isTypingTarget = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

const reducedMotion = () =>
  typeof window !== "undefined" &&
  !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

export function MindBoard({
  initialDoc,
  onSave,
  header,
}: {
  initialDoc: BoardDoc;
  onSave: (doc: BoardDoc) => void;
  header?: ReactNode;
}) {
  const [doc, setDoc] = useState<BoardDoc>(initialDoc);
  const docRef = useRef(doc);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectedRef = useRef(selected);
  selectedRef.current = selected;
  const [selectedEdge, setSelectedEdge] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>("select");
  const [editingId, setEditingIdState] = useState<string | null>(null);
  const editingRef = useRef<string | null>(null);
  const setEditingId = (id: string | null) => {
    editingRef.current = id;
    setEditingIdState(id);
  };
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);
  const [marquee, setMarquee] = useState<Rect | null>(null);
  const [sizes, setSizes] = useState<Record<string, { w: number; h: number }>>({});
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [gestureMode, setGestureMode] = useState<Gesture["mode"] | null>(null);
  const [animatingView, setAnimatingView] = useState(false);
  const [freshEdges, setFreshEdges] = useState<Set<string>>(new Set());
  const [, setHistoryTick] = useState(0);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const past = useRef<Snapshot[]>([]);
  const future = useRef<Snapshot[]>([]);
  const editStart = useRef<Snapshot | null>(null);
  const dirty = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  /* ── Estado + histórico ─────────────────────────────────────────────── */
  const update = useCallback(
    (next: BoardDoc | ((current: BoardDoc) => BoardDoc), record = true) => {
      const prev = docRef.current;
      const value = typeof next === "function" ? next(prev) : next;
      if (value === prev) return;
      if (record) {
        past.current.push({ nodes: prev.nodes, edges: prev.edges });
        if (past.current.length > 120) past.current.shift();
        future.current = [];
        setHistoryTick((tick) => tick + 1);
      }
      docRef.current = value;
      dirty.current = true;
      setDoc(value);
    },
    [],
  );

  const pushHistory = (snapshot: Snapshot) => {
    past.current.push(snapshot);
    if (past.current.length > 120) past.current.shift();
    future.current = [];
    setHistoryTick((tick) => tick + 1);
  };

  const undo = useCallback(() => {
    const previous = past.current.pop();
    if (!previous) return;
    const current = docRef.current;
    future.current.push({ nodes: current.nodes, edges: current.edges });
    update({ ...current, ...previous }, false);
    setSelected(new Set());
    setSelectedEdge(null);
    setHistoryTick((tick) => tick + 1);
  }, [update]);

  const redo = useCallback(() => {
    const next = future.current.pop();
    if (!next) return;
    const current = docRef.current;
    past.current.push({ nodes: current.nodes, edges: current.edges });
    update({ ...current, ...next }, false);
    setHistoryTick((tick) => tick + 1);
  }, [update]);

  // Salva pouco depois de cada mudança e ao sair do quadro.
  useEffect(() => {
    if (!dirty.current) return;
    const timer = window.setTimeout(() => {
      dirty.current = false;
      onSaveRef.current(docRef.current);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [doc]);
  useEffect(
    () => () => {
      if (dirty.current) onSaveRef.current(docRef.current);
    },
    [],
  );

  /* ── Medidas reais dos nós (tópicos e textos crescem com o conteúdo) ── */
  const observer = useRef<ResizeObserver | null>(null);
  const observed = useRef(new Map<string, HTMLElement>());
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    observer.current = new ResizeObserver((entries) => {
      setSizes((current) => {
        let next = current;
        for (const entry of entries) {
          const el = entry.target as HTMLElement;
          const id = el.dataset.nodeId;
          if (!id) continue;
          const w = el.offsetWidth;
          const h = el.offsetHeight;
          if (current[id]?.w === w && current[id]?.h === h) continue;
          if (next === current) next = { ...current };
          next[id] = { w, h };
        }
        return next;
      });
    });
    observed.current.forEach((el) => observer.current?.observe(el));
    return () => observer.current?.disconnect();
  }, []);
  const registerNode = useCallback((id: string, el: HTMLElement | null) => {
    const previous = observed.current.get(id);
    if (previous && previous !== el) observer.current?.unobserve(previous);
    if (el) {
      observed.current.set(id, el);
      observer.current?.observe(el);
    } else observed.current.delete(id);
  }, []);

  const rectOf = useCallback((node: BoardNode) => nodeRect(node, sizes[node.id]), [sizes]);
  const nodesById = useMemo(() => new Map(doc.nodes.map((node) => [node.id, node])), [doc.nodes]);

  /* ── Coordenadas ────────────────────────────────────────────────────── */
  const local = (event: { clientX: number; clientY: number }) => {
    const box = containerRef.current?.getBoundingClientRect();
    return { x: event.clientX - (box?.left ?? 0), y: event.clientY - (box?.top ?? 0) };
  };
  const viewportCenter = () => {
    const box = containerRef.current?.getBoundingClientRect();
    return { x: (box?.width ?? 800) / 2, y: (box?.height ?? 600) / 2 };
  };

  const setView = useCallback(
    (view: BoardDoc["view"], animate = false) => {
      if (animate && !reducedMotion()) {
        setAnimatingView(true);
        window.setTimeout(() => setAnimatingView(false), 360);
      }
      update((current) => ({ ...current, view }), false);
    },
    [update],
  );

  const zoomBy = (factor: number) => {
    const center = viewportCenter();
    const view = docRef.current.view;
    setView(zoomAt(view, view.zoom * factor, center.x, center.y), true);
  };

  const fit = useCallback(() => {
    const box = containerRef.current?.getBoundingClientRect();
    const bounds = boundsOf(docRef.current.nodes.map((node) => nodeRect(node, sizes[node.id])));
    if (!box) return;
    if (!bounds) return setView({ x: box.width / 2, y: box.height / 2, zoom: 1 }, true);
    setView(fitView(bounds, box.width, box.height), true);
  }, [setView, sizes]);

  // Primeiro acesso: origem do mundo no centro da tela.
  useLayoutEffect(() => {
    const view = docRef.current.view;
    if (view.x === 0 && view.y === 0 && view.zoom === 1) {
      const center = viewportCenter();
      const bounds = boundsOf(docRef.current.nodes.map((node) => nodeRect(node)));
      const box = containerRef.current?.getBoundingClientRect();
      const next =
        bounds && box
          ? fitView(bounds, box.width, box.height)
          : { x: center.x, y: center.y, zoom: 1 };
      docRef.current = { ...docRef.current, view: next };
      setDoc(docRef.current);
    }
  }, []);

  /* ── Criação ────────────────────────────────────────────────────────── */
  const flashEdge = (id: string) => {
    setFreshEdges((current) => new Set(current).add(id));
    window.setTimeout(
      () =>
        setFreshEdges((current) => {
          const next = new Set(current);
          next.delete(id);
          return next;
        }),
      700,
    );
  };

  const startEditing = (id: string) => {
    editStart.current = { nodes: docRef.current.nodes, edges: docRef.current.edges };
    setEditingId(id);
  };

  const placeNode = (
    kind: BoardNodeKind,
    worldX: number,
    worldY: number,
    patch: Partial<BoardNode> = {},
  ) => {
    const node = createNode(kind, worldX, worldY, patch);
    update((current) => ({ ...current, nodes: [...current.nodes, node] }));
    setSelected(new Set([node.id]));
    setSelectedEdge(null);
    editStart.current = { nodes: docRef.current.nodes, edges: docRef.current.edges };
    setEditingId(node.id);
    return node;
  };

  const addChild = (parentId: string, direction?: Direction) => {
    const current = docRef.current;
    const parent = current.nodes.find((node) => node.id === parentId);
    if (!parent) return;
    const parentRect = nodeRect(parent, sizes[parent.id]);
    const children = current.edges
      .filter((edge) => edge.from === parentId)
      .map((edge) => current.nodes.find((node) => node.id === edge.to))
      .filter((node): node is BoardNode => !!node);
    const dir =
      direction ??
      (children.length
        ? directionBetween(
            parentRect,
            nodeRect(children[children.length - 1], sizes[children[children.length - 1].id]),
          )
        : "right");
    const occupied = current.nodes.map((node) => nodeRect(node, sizes[node.id]));
    const pos = childPosition(parentRect, dir, occupied);
    const color: BoardColor =
      parent.kind === "topic" && !parent.root ? parent.color : parent.root ? "steel" : parent.color;
    const child: BoardNode = { ...createNode("topic", 0, 0, { color }), x: pos.x, y: pos.y };
    const edge = { id: createId(), from: parentId, to: child.id };
    update({ ...current, nodes: [...current.nodes, child], edges: [...current.edges, edge] });
    flashEdge(edge.id);
    setSelected(new Set([child.id]));
    setSelectedEdge(null);
    editStart.current = { nodes: docRef.current.nodes, edges: docRef.current.edges };
    setEditingId(child.id);
  };

  const addSibling = (nodeId: string) => {
    const current = docRef.current;
    const incoming = current.edges.find((edge) => edge.to === nodeId);
    const parent = incoming && current.nodes.find((node) => node.id === incoming.from);
    const node = current.nodes.find((item) => item.id === nodeId);
    if (!parent || !node) return addChild(nodeId);
    addChild(
      parent.id,
      directionBetween(nodeRect(parent, sizes[parent.id]), nodeRect(node, sizes[node.id])),
    );
  };

  const startMindMap = () => {
    const center = viewportCenter();
    const world = toWorld(docRef.current.view, center.x, center.y);
    placeNode("topic", world.x, world.y, { root: true, color: "graphite", text: "" });
  };

  const finishEditing = useCallback(
    (only?: string) => {
      const id = editingRef.current;
      // Um "blur" atrasado de um campo antigo não pode encerrar a edição nova.
      if (!id || (only && only !== id)) return;
      setEditingId(null);
      const node = docRef.current.nodes.find((item) => item.id === id);
      // Texto livre vazio não deixa lixo no quadro.
      if (node && node.kind === "text" && !node.text.trim()) {
        update((current) => removeNodes(current, new Set([id])), false);
        setSelected(new Set());
      }
      const before = editStart.current;
      editStart.current = null;
      if (before && before.nodes !== docRef.current.nodes) pushHistory(before);
    },
    [update],
  );

  const setText = (id: string, text: string) =>
    update(
      (current) => ({
        ...current,
        nodes: current.nodes.map((node) => (node.id === id ? { ...node, text } : node)),
      }),
      false,
    );

  const patchSelected = (patch: Partial<BoardNode>) => {
    const ids = selectedRef.current;
    update((current) => ({
      ...current,
      nodes: current.nodes.map((node) => (ids.has(node.id) ? { ...node, ...patch } : node)),
    }));
  };

  const deleteSelection = () => {
    if (selectedEdge) {
      update((current) => ({
        ...current,
        edges: current.edges.filter((edge) => edge.id !== selectedEdge),
      }));
      setSelectedEdge(null);
      return;
    }
    if (!selectedRef.current.size) return;
    update((current) => removeNodes(current, selectedRef.current));
    setSelected(new Set());
  };

  const duplicateSelection = () => {
    if (!selectedRef.current.size) return;
    const result = duplicateNodes(docRef.current, selectedRef.current);
    update(result.doc);
    setSelected(new Set(result.created));
  };

  const connect = (from: string, to: string) => {
    if (from === to || hasEdge(docRef.current, from, to)) return;
    const edge = { id: createId(), from, to };
    update((current) => ({ ...current, edges: [...current.edges, edge] }));
    flashEdge(edge.id);
  };

  /* ── Ponteiro ───────────────────────────────────────────────────────── */
  const onCanvasPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button === 2) return;
    if (editingId) finishEditing();
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    containerRef.current?.setPointerCapture(event.pointerId);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      gesture.current = {
        mode: "pinch",
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      };
      setGestureMode("pinch");
      return;
    }
    if (PLACE_TOOLS.includes(tool)) {
      const world = toWorld(docRef.current.view, p.x, p.y);
      placeNode(
        tool as BoardNodeKind,
        world.x,
        world.y,
        tool === "topic" && !docRef.current.nodes.some((n) => n.root)
          ? { root: true, color: "graphite" }
          : {},
      );
      setTool("select");
      return;
    }
    if (tool === "connect") {
      setConnectFrom(null);
      return;
    }
    const pan = tool === "hand" || spaceHeld || event.button === 1 || event.pointerType === "touch";
    if (pan) {
      gesture.current = { mode: "pan", sx: p.x, sy: p.y, view: docRef.current.view };
      setGestureMode("pan");
      return;
    }
    const base = event.shiftKey ? new Set(selectedRef.current) : new Set<string>();
    if (!event.shiftKey) setSelected(new Set());
    setSelectedEdge(null);
    gesture.current = { mode: "marquee", sx: p.x, sy: p.y, base };
    setGestureMode("marquee");
  };

  // O quadro captura o ponteiro para arrastar; com isso o navegador entrega o
  // "dblclick" ao fundo, não ao item. Por isso o duplo clique no item é
  // detectado aqui, pelos dois toques seguidos no mesmo nó.
  const lastNodeDown = useRef<{ id: string; at: number } | null>(null);

  const onNodePointerDown = (event: ReactPointerEvent<HTMLDivElement>, node: BoardNode) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.stopPropagation();
    if (editingId === node.id) return;
    if (editingId) finishEditing();
    const now = performance.now();
    const previous = lastNodeDown.current;
    lastNodeDown.current = { id: node.id, at: now };
    if (tool !== "connect" && previous?.id === node.id && now - previous.at < 400) {
      lastNodeDown.current = null;
      setSelected(new Set([node.id]));
      startEditing(node.id);
      return;
    }
    if (tool === "connect") {
      if (!connectFrom) setConnectFrom(node.id);
      else {
        connect(connectFrom, node.id);
        setConnectFrom(null);
      }
      return;
    }
    if (PLACE_TOOLS.includes(tool) || tool === "hand") setTool("select");
    const p = local(event);
    pointers.current.set(event.pointerId, p);
    let selection = selectedRef.current;
    if (event.shiftKey) {
      selection = new Set(selection);
      if (selection.has(node.id)) selection.delete(node.id);
      else selection.add(node.id);
    } else if (!selection.has(node.id)) selection = new Set([node.id]);
    setSelected(selection);
    setSelectedEdge(null);
    containerRef.current?.setPointerCapture(event.pointerId);
    const origin = new Map<string, { x: number; y: number }>();
    for (const item of docRef.current.nodes)
      if (selection.has(item.id)) origin.set(item.id, { x: item.x, y: item.y });
    gesture.current = {
      mode: "drag",
      sx: p.x,
      sy: p.y,
      origin,
      moved: false,
      before: { nodes: docRef.current.nodes, edges: docRef.current.edges },
      clickedId: node.id,
      additive: event.shiftKey,
    };
  };

  const onResizePointerDown = (event: ReactPointerEvent<HTMLElement>, node: BoardNode) => {
    event.stopPropagation();
    const p = local(event);
    const rect = nodeRect(node, sizes[node.id]);
    containerRef.current?.setPointerCapture(event.pointerId);
    pointers.current.set(event.pointerId, p);
    gesture.current = {
      mode: "resize",
      sx: p.x,
      sy: p.y,
      id: node.id,
      w: rect.w,
      h: rect.h,
      before: { nodes: docRef.current.nodes, edges: docRef.current.edges },
    };
    setGestureMode("resize");
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const p = local(event);
    if (pointers.current.has(event.pointerId)) pointers.current.set(event.pointerId, p);
    if (connectFrom) setCursor(toWorld(docRef.current.view, p.x, p.y));
    const g = gesture.current;
    if (!g) return;
    const view = docRef.current.view;
    if (g.mode === "pinch") {
      if (pointers.current.size < 2) return;
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const zoomed = zoomAt(view, view.zoom * (dist / Math.max(g.dist, 1)), mid.x, mid.y);
      setView({ ...zoomed, x: zoomed.x + mid.x - g.mid.x, y: zoomed.y + mid.y - g.mid.y });
      gesture.current = { mode: "pinch", dist, mid };
      return;
    }
    if (g.mode === "pan") {
      setView({ ...g.view, x: g.view.x + p.x - g.sx, y: g.view.y + p.y - g.sy });
      return;
    }
    if (g.mode === "drag") {
      if (!g.moved && Math.hypot(p.x - g.sx, p.y - g.sy) < 3) return;
      if (!g.moved) {
        g.moved = true;
        setGestureMode("drag");
      }
      const dx = (p.x - g.sx) / view.zoom;
      const dy = (p.y - g.sy) / view.zoom;
      update(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            const origin = g.origin.get(node.id);
            return origin
              ? { ...node, x: Math.round(origin.x + dx), y: Math.round(origin.y + dy) }
              : node;
          }),
        }),
        false,
      );
      return;
    }
    if (g.mode === "resize") {
      const w = Math.max(90, Math.round(g.w + (p.x - g.sx) / view.zoom));
      const h = Math.max(48, Math.round(g.h + (p.y - g.sy) / view.zoom));
      update(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) => (node.id === g.id ? { ...node, w, h } : node)),
        }),
        false,
      );
      return;
    }
    if (g.mode === "marquee") {
      const screen = {
        x: Math.min(g.sx, p.x),
        y: Math.min(g.sy, p.y),
        w: Math.abs(p.x - g.sx),
        h: Math.abs(p.y - g.sy),
      };
      setMarquee(screen);
      const a = toWorld(view, screen.x, screen.y);
      const world = { x: a.x, y: a.y, w: screen.w / view.zoom, h: screen.h / view.zoom };
      const next = new Set(g.base);
      for (const node of docRef.current.nodes)
        if (intersects(world, nodeRect(node, sizes[node.id]))) next.add(node.id);
      setSelected(next);
    }
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    pointers.current.delete(event.pointerId);
    const g = gesture.current;
    if (g?.mode === "pinch" && pointers.current.size === 1) {
      const [rest] = [...pointers.current.values()];
      gesture.current = { mode: "pan", sx: rest.x, sy: rest.y, view: docRef.current.view };
      setGestureMode("pan");
      return;
    }
    if (g?.mode === "drag") {
      if (g.moved) pushHistory(g.before);
      else if (!g.additive && selectedRef.current.size > 1) setSelected(new Set([g.clickedId]));
    }
    if (g?.mode === "resize") pushHistory(g.before);
    gesture.current = null;
    setGestureMode(null);
    setMarquee(null);
  };

  const onDoubleClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if ((event.target as HTMLElement).closest("[data-node-id],[data-board-ui]")) return;
    // Duplo clique que começou num item edita o item; não cria nota nova.
    if (lastNodeDown.current === null && editingRef.current) return;
    if (lastNodeDown.current && performance.now() - lastNodeDown.current.at < 500) return;
    const p = local(event);
    const world = toWorld(docRef.current.view, p.x, p.y);
    placeNode("note", world.x, world.y);
  };

  /* ── Roda do mouse / trackpad ───────────────────────────────────────── */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest("[data-board-ui]")) return;
      if ((event.target as HTMLElement).tagName === "TEXTAREA") return;
      event.preventDefault();
      const box = el.getBoundingClientRect();
      const view = docRef.current.view;
      if (event.ctrlKey || event.metaKey) {
        const next = zoomAt(
          view,
          // Roda do mouse (passos de ~100) limitada; pinça do trackpad (passos pequenos) segue fluida.
          view.zoom * Math.exp(-Math.max(-40, Math.min(40, event.deltaY)) * 0.008),
          event.clientX - box.left,
          event.clientY - box.top,
        );
        update((current) => ({ ...current, view: next }), false);
      } else {
        update(
          (current) => ({
            ...current,
            view: { ...view, x: view.x - event.deltaX, y: view.y - event.deltaY },
          }),
          false,
        );
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [update]);

  /* ── Teclado ────────────────────────────────────────────────────────── */
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      if (!containerRef.current?.isConnected) return;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if (key === " ") {
        event.preventDefault();
        setSpaceHeld(true);
        return;
      }
      if (mod && key === "z") {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (mod && key === "y") {
        event.preventDefault();
        redo();
        return;
      }
      if (mod && key === "d") {
        event.preventDefault();
        duplicateSelection();
        return;
      }
      if (mod && key === "a") {
        event.preventDefault();
        setSelected(new Set(docRef.current.nodes.map((node) => node.id)));
        return;
      }
      if (mod && (key === "=" || key === "+")) {
        event.preventDefault();
        zoomBy(1.2);
        return;
      }
      if (mod && key === "-") {
        event.preventDefault();
        zoomBy(1 / 1.2);
        return;
      }
      if (mod) return;
      const single = selectedRef.current.size === 1 ? [...selectedRef.current][0] : null;
      if (key === "delete" || key === "backspace") {
        event.preventDefault();
        deleteSelection();
        return;
      }
      if (key === "escape") {
        setSelected(new Set());
        setSelectedEdge(null);
        setConnectFrom(null);
        setTool("select");
        return;
      }
      if (key === "tab" && single) {
        event.preventDefault();
        addChild(single);
        return;
      }
      if (key === "enter" && single) {
        event.preventDefault();
        if (event.shiftKey) startEditing(single);
        else addSibling(single);
        return;
      }
      if (key === "f2" && single) {
        startEditing(single);
        return;
      }
      // Com um item selecionado, começar a digitar já edita o texto dele.
      if (single && event.key.length === 1 && !event.altKey) {
        event.preventDefault();
        startEditing(single);
        setText(single, (docRef.current.nodes.find((node) => node.id === single)?.text ?? "") + event.key);
        return;
      }
      if (key.startsWith("arrow") && selectedRef.current.size) {
        event.preventDefault();
        const step = event.shiftKey ? 10 : 1;
        const dx = key === "arrowleft" ? -step : key === "arrowright" ? step : 0;
        const dy = key === "arrowup" ? -step : key === "arrowdown" ? step : 0;
        update((current) => ({
          ...current,
          nodes: current.nodes.map((node) =>
            selectedRef.current.has(node.id) ? { ...node, x: node.x + dx, y: node.y + dy } : node,
          ),
        }));
        return;
      }
      if (event.shiftKey && key === "!") {
        fit();
        return;
      }
      const match = TOOLS.find((item) => item.key.toLowerCase() === key);
      if (match) {
        setTool(match.id);
        setConnectFrom(null);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === " ") setSpaceHeld(false);
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
    };
  });

  /* ── Derivados de renderização ──────────────────────────────────────── */
  const { view } = doc;
  const single = selected.size === 1 ? (nodesById.get([...selected][0]) ?? null) : null;
  const selectionBounds = useMemo(() => {
    const rects = doc.nodes.filter((node) => selected.has(node.id)).map((node) => rectOf(node));
    const bounds = boundsOf(rects);
    if (!bounds) return null;
    return {
      x: bounds.x * view.zoom + view.x,
      y: bounds.y * view.zoom + view.y,
      w: bounds.w * view.zoom,
      h: bounds.h * view.zoom,
    };
  }, [doc.nodes, selected, rectOf, view]);
  const edgeMid = useMemo(() => {
    if (!selectedEdge) return null;
    const edge = doc.edges.find((item) => item.id === selectedEdge);
    const a = edge && nodesById.get(edge.from);
    const b = edge && nodesById.get(edge.to);
    if (!a || !b) return null;
    const ra = rectOf(a);
    const rb = rectOf(b);
    return {
      x: ((ra.x + ra.w / 2 + rb.x + rb.w / 2) / 2) * view.zoom + view.x,
      y: ((ra.y + ra.h / 2 + rb.y + rb.h / 2) / 2) * view.zoom + view.y,
    };
  }, [selectedEdge, doc.edges, nodesById, rectOf, view]);
  // A barra contextual só aparece se a seleção estiver na área visível.
  const selectionVisible =
    !!selectionBounds &&
    selectionBounds.x + selectionBounds.w > 0 &&
    selectionBounds.y + selectionBounds.h > 0 &&
    selectionBounds.x < (containerRef.current?.clientWidth ?? Infinity) &&
    selectionBounds.y < (containerRef.current?.clientHeight ?? Infinity);
  const selectedShapes = doc.nodes.some((node) => selected.has(node.id) && node.kind === "shape");
  const panning = gestureMode === "pan" || gestureMode === "pinch";
  const cursorClass = panning
    ? "cursor-grabbing"
    : tool === "hand" || spaceHeld
      ? "cursor-grab"
      : PLACE_TOOLS.includes(tool) || tool === "connect"
        ? "cursor-crosshair"
        : "cursor-default";
  const gridSize = 24 * view.zoom;

  /* ── Barra de ferramentas: pílula deslizante ────────────────────────── */
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [toolPill, setToolPill] = useState<{ x: number; y: number; w: number; h: number } | null>(
    null,
  );
  useLayoutEffect(() => {
    const measure = () => {
      const active = toolbarRef.current?.querySelector<HTMLElement>("[data-tool-active='true']");
      setToolPill(
        active
          ? {
              x: active.offsetLeft,
              y: active.offsetTop,
              w: active.offsetWidth,
              h: active.offsetHeight,
            }
          : null,
      );
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [tool]);

  return (
    <div
      ref={containerRef}
      className={`tf-board-canvas relative h-full w-full overflow-hidden outline-none ${cursorClass}`}
      style={{
        backgroundSize: `${gridSize}px ${gridSize}px`,
        backgroundPosition: `${view.x}px ${view.y}px`,
      }}
      onPointerDown={onCanvasPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
      role="application"
      aria-label="Quadro livre e mapa mental"
      tabIndex={0}
    >
      {/* Mundo */}
      <div
        className="absolute left-0 top-0 origin-top-left"
        style={{
          transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`,
          transition: animatingView ? "transform 340ms cubic-bezier(0.23, 1, 0.32, 1)" : undefined,
          willChange: panning ? "transform" : undefined,
        }}
      >
        <svg
          className="pointer-events-none absolute left-0 top-0 overflow-visible"
          width="1"
          height="1"
          aria-hidden="true"
        >
          {doc.edges.map((edge) => {
            const a = nodesById.get(edge.from);
            const b = nodesById.get(edge.to);
            if (!a || !b) return null;
            const d = edgePath(rectOf(a), rectOf(b));
            const active =
              selectedEdge === edge.id || selected.has(edge.from) || selected.has(edge.to);
            return (
              <g key={edge.id}>
                <path
                  d={d}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14 / view.zoom}
                  className="pointer-events-auto cursor-pointer"
                  onPointerDown={(event) => {
                    event.stopPropagation();
                    if (tool === "connect") return;
                    setSelectedEdge(edge.id);
                    setSelected(new Set());
                  }}
                />
                <path
                  d={d}
                  fill="none"
                  className={`tf-board-edge ${freshEdges.has(edge.id) ? "tf-board-edge-in" : ""}`}
                  stroke={
                    selectedEdge === edge.id
                      ? "var(--ring)"
                      : active
                        ? "color-mix(in oklab, var(--foreground) 55%, transparent)"
                        : "color-mix(in oklab, var(--muted-foreground) 70%, transparent)"
                  }
                  strokeWidth={selectedEdge === edge.id ? 2.5 : 1.75}
                  strokeLinecap="round"
                />
              </g>
            );
          })}
          {connectFrom && cursor && nodesById.get(connectFrom) && (
            <path
              d={edgePath(rectOf(nodesById.get(connectFrom)!), {
                x: cursor.x - 1,
                y: cursor.y - 1,
                w: 2,
                h: 2,
              })}
              fill="none"
              stroke="var(--ring)"
              strokeWidth={1.75}
              strokeDasharray="6 6"
            />
          )}
        </svg>

        {doc.nodes.map((node) => (
          <BoardNodeView
            key={node.id}
            node={node}
            selected={selected.has(node.id)}
            editing={editingId === node.id}
            connectSource={connectFrom === node.id}
            showHandles={
              single?.id === node.id && !editingId && tool === "select" && gestureMode !== "drag"
            }
            zoom={view.zoom}
            register={registerNode}
            onPointerDown={onNodePointerDown}
            onDoubleClick={() => startEditing(node.id)}
            onText={(text) => setText(node.id, text)}
            onFinish={() => finishEditing(node.id)}
            onTab={() => {
              finishEditing(node.id);
              addChild(node.id);
            }}
            onAddChild={(direction) => addChild(node.id, direction)}
            onResizeStart={onResizePointerDown}
          />
        ))}
      </div>

      {/* Seleção retangular */}
      {marquee && (
        <div
          className="pointer-events-none absolute rounded-[4px] border border-[var(--ring)] bg-[color-mix(in_oklab,var(--ring)_12%,transparent)]"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}

      {/* Barra contextual da seleção */}
      {selectionBounds && selectionVisible && !editingId && gestureMode === null && (
        <div
          key={[...selected].join(",")}
          data-board-ui
          className="tf-board-toolbar tf-board-pop absolute z-20 flex items-center gap-1 rounded-xl p-1"
          style={{
            left: Math.min(Math.max(170, selectionBounds.x + selectionBounds.w / 2), (containerRef.current?.clientWidth ?? 1200) - 170),
            top: Math.max(56, selectionBounds.y - (single ? 42 : 14)),
            transform: "translate(-50%, -100%)",
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="flex items-center gap-1 px-1">
            {COLOR_KEYS.map((key) => (
              <button
                key={key}
                type="button"
                title={BOARD_COLORS[key].label}
                aria-label={`Cor ${BOARD_COLORS[key].label}`}
                onClick={() => patchSelected({ color: key })}
                className="h-5 w-5 rounded-full border transition-transform duration-150 hover:scale-115 active:scale-90"
                style={{ background: BOARD_COLORS[key].bg, borderColor: BOARD_COLORS[key].border }}
              />
            ))}
          </div>
          {selectedShapes && (
            <>
              <span className="mx-0.5 h-5 w-px bg-border" />
              {(
                [
                  ["rect", Square, "Retângulo"],
                  ["ellipse", Circle, "Elipse"],
                  ["diamond", Diamond, "Losango"],
                ] as Array<[BoardShape, typeof Square, string]>
              ).map(([shape, Icon, label]) => (
                <ToolbarButton key={shape} label={label} onClick={() => patchSelected({ shape })}>
                  <Icon className="h-4 w-4" />
                </ToolbarButton>
              ))}
            </>
          )}
          <span className="mx-0.5 h-5 w-px bg-border" />
          {single && (
            <ToolbarButton label="Editar texto (duplo clique)" onClick={() => startEditing(single.id)}>
              <Pencil className="h-4 w-4" />
            </ToolbarButton>
          )}
          {single && (
            <ToolbarButton label="Criar ramo (Tab)" onClick={() => addChild(single.id)}>
              <GitFork className="h-4 w-4" />
            </ToolbarButton>
          )}
          <ToolbarButton label="Duplicar (Ctrl+D)" onClick={duplicateSelection}>
            <Copy className="h-4 w-4" />
          </ToolbarButton>
          <ToolbarButton label="Excluir (Delete)" onClick={deleteSelection} danger>
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}
      {edgeMid && gestureMode === null && (
        <div
          data-board-ui
          className="tf-board-toolbar tf-board-pop absolute z-20 flex rounded-xl p-1"
          style={{ left: edgeMid.x, top: edgeMid.y - 12, transform: "translate(-50%, -100%)" }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <ToolbarButton label="Remover conexão" onClick={deleteSelection} danger>
            <Trash2 className="h-4 w-4" />
          </ToolbarButton>
        </div>
      )}

      {/* Cabeçalho (seletor de quadros) */}
      {header && (
        <div
          data-board-ui
          className="absolute left-3 top-3 z-30 sm:left-4 sm:top-4"
          onPointerDown={(event) => event.stopPropagation()}
        >
          {header}
        </div>
      )}

      {/* Ferramentas */}
      <div
        ref={toolbarRef}
        data-board-ui
        role="toolbar"
        aria-label="Ferramentas do quadro"
        className="tf-board-toolbar absolute bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-0.5 rounded-2xl p-1 md:bottom-auto md:left-4 md:top-1/2 md:-translate-y-1/2 md:translate-x-0 md:flex-col"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        {toolPill && (
          <span
            aria-hidden="true"
            className="absolute left-0 top-0 rounded-xl bg-primary transition-[transform,width,height] duration-[380ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none"
            style={{
              transform: `translate(${toolPill.x}px, ${toolPill.y}px)`,
              width: toolPill.w,
              height: toolPill.h,
            }}
          />
        )}
        {TOOLS.map((item) => {
          const Icon = item.icon;
          const active = tool === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-tool-active={active}
              aria-pressed={active}
              title={`${item.label} (${item.key})`}
              aria-label={item.label}
              onClick={() => {
                setTool(item.id);
                setConnectFrom(null);
              }}
              className={`relative grid h-10 w-10 place-items-center rounded-xl transition-[color,transform] duration-200 active:scale-90 ${
                active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} />
            </button>
          );
        })}
      </div>

      {/* Zoom e histórico */}
      <div
        data-board-ui
        className="tf-board-toolbar absolute bottom-20 right-3 z-30 flex items-center gap-0.5 rounded-xl p-1 md:bottom-4 md:right-4"
        onPointerDown={(event) => event.stopPropagation()}
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <ToolbarButton label="Desfazer (Ctrl+Z)" onClick={undo} disabled={!past.current.length}>
          <Undo2 className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton
          label="Refazer (Ctrl+Shift+Z)"
          onClick={redo}
          disabled={!future.current.length}
        >
          <Redo2 className="h-4 w-4" />
        </ToolbarButton>
        <span className="mx-0.5 h-5 w-px bg-border" />
        <ToolbarButton label="Diminuir zoom" onClick={() => zoomBy(1 / 1.2)}>
          <Minus className="h-4 w-4" />
        </ToolbarButton>
        <button
          type="button"
          title="Voltar para 100%"
          onClick={() => {
            const center = viewportCenter();
            setView(zoomAt(docRef.current.view, 1, center.x, center.y), true);
          }}
          className="h-8 min-w-12 rounded-lg px-1.5 text-xs font-medium tabular-nums text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {Math.round(view.zoom * 100)}%
        </button>
        <ToolbarButton label="Aumentar zoom" onClick={() => zoomBy(1.2)}>
          <Plus className="h-4 w-4" />
        </ToolbarButton>
        <ToolbarButton label="Enquadrar tudo (Shift+1)" onClick={fit}>
          <Scan className="h-4 w-4" />
        </ToolbarButton>
      </div>

      {/* Modo conectar */}
      {tool === "connect" && (
        <div
          data-board-ui
          className="tf-board-toolbar tf-board-pop absolute left-1/2 top-4 z-30 -translate-x-1/2 rounded-full px-4 py-2 text-sm"
        >
          {connectFrom
            ? "Agora clique no item de destino"
            : "Clique no primeiro item para conectar"}
        </div>
      )}

      {/* Estado vazio */}
      {doc.nodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 grid place-items-center p-6">
          <div
            data-board-ui
            className="tf-board-toolbar tf-board-pop pointer-events-auto max-w-sm rounded-2xl p-6 text-center"
            onPointerDown={(event) => event.stopPropagation()}
          >
            <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-xl bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.2)]">
              <Workflow className="h-6 w-6" strokeWidth={1.75} />
            </span>
            <h2 className="text-lg font-semibold tracking-tight">Quadro em branco</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Dê dois cliques em qualquer lugar para criar uma nota. Num tópico,{" "}
              <kbd className="rounded border px-1 text-xs">Tab</kbd> cria um ramo e{" "}
              <kbd className="rounded border px-1 text-xs">Enter</kbd> cria um irmão.
            </p>
            <div className="mt-5 flex flex-wrap justify-center gap-2">
              <button
                type="button"
                onClick={startMindMap}
                className="inline-flex h-9 items-center gap-2 rounded-full bg-primary px-4 text-sm font-medium text-primary-foreground transition-transform duration-150 active:scale-[0.97]"
              >
                <Workflow className="h-4 w-4" /> Começar mapa mental
              </button>
              <button
                type="button"
                onClick={() => {
                  const center = viewportCenter();
                  const world = toWorld(docRef.current.view, center.x, center.y);
                  placeNode("note", world.x, world.y);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-full border bg-background px-4 text-sm font-medium transition-transform duration-150 active:scale-[0.97]"
              >
                <StickyNote className="h-4 w-4" /> Nova nota
              </button>
            </div>
          </div>
        </div>
      )}

      <p className="pointer-events-none absolute bottom-5 left-20 hidden text-xs text-muted-foreground/80 lg:block">
        Duplo clique cria nota · Tab ramo · Enter irmão · Espaço + arrastar move · Ctrl + roda dá
        zoom
      </p>
    </div>
  );
}

function ToolbarButton({
  label,
  onClick,
  children,
  disabled,
  danger,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] duration-150 hover:bg-accent active:scale-90 disabled:pointer-events-none disabled:opacity-35 ${
        danger ? "hover:text-destructive" : "hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const DIRECTIONS: Array<{ dir: Direction; style: CSSProperties }> = [
  { dir: "right", style: { right: -30, top: "50%", transform: "translateY(-50%)" } },
  { dir: "left", style: { left: -30, top: "50%", transform: "translateY(-50%)" } },
  { dir: "down", style: { bottom: -30, left: "50%", transform: "translateX(-50%)" } },
  { dir: "up", style: { top: -30, left: "50%", transform: "translateX(-50%)" } },
];

function BoardNodeView({
  node,
  selected,
  editing,
  connectSource,
  showHandles,
  zoom,
  register,
  onPointerDown,
  onDoubleClick,
  onText,
  onFinish,
  onTab,
  onAddChild,
  onResizeStart,
}: {
  node: BoardNode;
  selected: boolean;
  editing: boolean;
  connectSource: boolean;
  showHandles: boolean;
  zoom: number;
  register: (id: string, el: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLDivElement>, node: BoardNode) => void;
  onDoubleClick: () => void;
  onText: (text: string) => void;
  onFinish: () => void;
  onTab: () => void;
  onAddChild: (direction: Direction) => void;
  onResizeStart: (event: ReactPointerEvent<HTMLElement>, node: BoardNode) => void;
}) {
  const palette = BOARD_COLORS[node.color];
  const fixed = node.kind === "note" || node.kind === "shape";
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  useEffect(() => {
    if (!editing) return;
    const el = textareaRef.current;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }, [editing]);

  const placeholder =
    node.kind === "topic"
      ? node.root
        ? "Ideia central"
        : "Tópico"
      : node.kind === "text"
        ? "Texto"
        : node.kind === "note"
          ? "Escreva algo…"
          : "";

  const base: CSSProperties = { left: node.x, top: node.y };
  let className = "tf-board-node absolute select-none";
  let style: CSSProperties = base;
  if (node.kind === "note") {
    className += " rounded-[6px] p-3.5 text-[14px] leading-[1.45]";
    style = {
      ...base,
      width: node.w ?? DEFAULT_SIZE.note.w,
      height: node.h ?? DEFAULT_SIZE.note.h,
      background: `linear-gradient(160deg, ${palette.bg} 0%, color-mix(in oklab, ${palette.bg} 88%, black) 100%)`,
      color: palette.fg,
      boxShadow: "0 1px 1px rgb(0 0 0 / 0.08), 0 10px 22px -12px rgb(0 0 0 / 0.45)",
    };
  } else if (node.kind === "topic") {
    className += node.root
      ? " rounded-[16px] border px-6 py-3.5 text-[18px] font-semibold tracking-tight"
      : " rounded-[12px] border px-4 py-2.5 text-[14px] font-medium";
    style = {
      ...base,
      minWidth: node.root ? 160 : 96,
      maxWidth: 300,
      background: `linear-gradient(180deg, color-mix(in oklab, ${palette.bg} 92%, white) 0%, ${palette.bg} 100%)`,
      color: palette.fg,
      borderColor: palette.border,
      boxShadow:
        "inset 0 1px 0 rgb(255 255 255 / 0.35), 0 1px 2px rgb(0 0 0 / 0.1), 0 8px 18px -12px rgb(0 0 0 / 0.5)",
    };
  } else if (node.kind === "text") {
    className += " rounded-md px-1 text-[18px] font-medium leading-snug";
    style = {
      ...base,
      minWidth: 40,
      maxWidth: 440,
      color: palette.ink === "currentColor" ? "var(--foreground)" : palette.ink,
    };
  } else {
    className += " grid place-items-center p-4 text-center text-[14px] font-medium";
    style = {
      ...base,
      width: node.w ?? DEFAULT_SIZE.shape.w,
      height: node.h ?? DEFAULT_SIZE.shape.h,
      color: palette.fg,
      ...(node.shape === "diamond"
        ? {}
        : {
            background: palette.bg,
            border: `1.5px solid ${palette.border}`,
            borderRadius: node.shape === "ellipse" ? "9999px" : 12,
            boxShadow: "0 8px 18px -12px rgb(0 0 0 / 0.5)",
          }),
    };
  }

  const editor = (
    <div className="grid">
      <span
        aria-hidden={editing}
        className={`[grid-area:1/1] whitespace-pre-wrap break-words ${editing ? "invisible" : ""} ${!node.text ? "opacity-45" : ""}`}
      >
        {(node.text || placeholder) + (editing ? " " : "")}
      </span>
      {editing && (
        <textarea
          ref={textareaRef}
          value={node.text}
          placeholder={placeholder}
          aria-label="Texto do item"
          onChange={(event) => onText(event.target.value)}
          onBlur={onFinish}
          onPointerDown={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Escape") onFinish();
            if (event.key === "Tab") {
              event.preventDefault();
              onTab();
            }
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              (node.kind !== "note" || event.metaKey || event.ctrlKey)
            ) {
              event.preventDefault();
              onFinish();
            }
          }}
          className={`[grid-area:1/1] w-full resize-none overflow-hidden border-0 bg-transparent p-0 text-inherit outline-none placeholder:opacity-45 ${fixed ? "h-full" : ""}`}
          style={{ font: "inherit", letterSpacing: "inherit", textAlign: "inherit" }}
        />
      )}
    </div>
  );

  return (
    <div
      ref={(el) => register(node.id, el)}
      data-node-id={node.id}
      data-selected={selected || connectSource}
      className={className}
      style={style}
      onPointerDown={(event) => onPointerDown(event, node)}
      onDoubleClick={(event) => {
        event.stopPropagation();
        onDoubleClick();
      }}
    >
      {node.kind === "shape" && node.shape === "diamond" && (
        <svg
          className="pointer-events-none absolute inset-0 h-full w-full overflow-visible"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polygon
            points="50,1 99,50 50,99 1,50"
            fill={palette.bg}
            stroke={palette.border}
            strokeWidth="1.5"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      )}
      <div
        className={`relative ${fixed ? "h-full w-full overflow-hidden" : ""} ${node.kind === "shape" ? "grid place-items-center" : ""}`}
      >
        {editor}
      </div>

      {showHandles &&
        DIRECTIONS.map(({ dir, style: handleStyle }) => (
          <button
            key={dir}
            type="button"
            title="Criar ramo nesta direção"
            aria-label={`Criar ramo para ${dir === "right" ? "a direita" : dir === "left" ? "a esquerda" : dir === "down" ? "baixo" : "cima"}`}
            className="tf-board-handle absolute grid h-6 w-6 place-items-center rounded-full border bg-background text-muted-foreground shadow-sm hover:bg-primary hover:text-primary-foreground"
            style={{ ...handleStyle, scale: `${Math.min(1.6, 1 / zoom)}` }}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onAddChild(dir);
            }}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        ))}
      {showHandles && fixed && (
        <span
          role="presentation"
          className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-[4px] border-2 border-[var(--ring)] bg-background"
          style={{ scale: `${Math.min(1.6, 1 / zoom)}` }}
          onPointerDown={(event) => onResizeStart(event, node)}
        />
      )}
    </div>
  );
}
