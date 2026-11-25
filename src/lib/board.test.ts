import { describe, expect, it } from "vitest";
import {
  childPosition,
  createNode,
  duplicateNodes,
  edgePath,
  fitView,
  mergeBoards,
  parseBoard,
  removeNodes,
  zoomAt,
  type Board,
  type BoardDoc,
} from "./board";

const doc = (): BoardDoc => {
  const a = { ...createNode("topic", 0, 0), id: "a" };
  const b = { ...createNode("topic", 300, 0), id: "b" };
  const c = { ...createNode("note", 0, 300), id: "c" };
  return {
    nodes: [a, b, c],
    edges: [
      { id: "e1", from: "a", to: "b" },
      { id: "e2", from: "a", to: "c" },
    ],
    view: { x: 0, y: 0, zoom: 1 },
  };
};

describe("quadro", () => {
  it("keeps the point under the cursor fixed when zooming", () => {
    const view = { x: 100, y: 50, zoom: 1 };
    const next = zoomAt(view, 2, 300, 250);
    expect((300 - next.x) / next.zoom).toBeCloseTo((300 - view.x) / view.zoom);
    expect((250 - next.y) / next.zoom).toBeCloseTo((250 - view.y) / view.zoom);
    expect(zoomAt(view, 99, 0, 0).zoom).toBe(3);
  });

  it("places a new branch beside the parent without overlapping its siblings", () => {
    const parent = { x: 0, y: 0, w: 140, h: 44 };
    const first = childPosition(parent, "right", [parent]);
    expect(first.x).toBeGreaterThan(parent.x + parent.w);
    const second = childPosition(parent, "right", [parent, { ...first, w: 140, h: 44 }]);
    expect(second.x).toBe(first.x);
    expect(second.y).toBeGreaterThanOrEqual(first.y + 44);
    expect(childPosition(parent, "left", [parent]).x).toBeLessThan(parent.x);
  });

  it("draws connections from the facing sides", () => {
    const path = edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 0, w: 100, h: 40 });
    expect(path.startsWith("M 100 20")).toBe(true);
    expect(path.endsWith("300 20")).toBe(true);
  });

  it("removes a node together with its connections and duplicates internal links", () => {
    const removed = removeNodes(doc(), new Set(["a"]));
    expect(removed.nodes.map((n) => n.id)).toEqual(["b", "c"]);
    expect(removed.edges).toHaveLength(0);
    const { doc: copy, created } = duplicateNodes(doc(), new Set(["a", "b"]));
    expect(created).toHaveLength(2);
    expect(copy.edges).toHaveLength(3);
  });

  it("reads damaged saves safely and keeps the newest copy when merging", () => {
    const parsed = parseBoard({
      id: "x",
      name: "",
      doc: {
        nodes: [
          { id: "n", kind: "bogus" },
          { id: "ok", kind: "note", x: "1" },
        ],
        edges: [{ id: "e", from: "ok", to: "gone" }],
        view: { zoom: 40 },
      },
    });
    expect(parsed?.name).toBe("Quadro sem nome");
    expect(parsed?.doc.nodes.map((n) => n.id)).toEqual(["ok"]);
    expect(parsed?.doc.edges).toHaveLength(0);
    expect(parsed?.doc.view.zoom).toBe(3);
    expect(parseBoard(null)).toBeNull();
    const old: Board = { id: "1", name: "Velho", doc: doc(), updatedAt: "2026-11-01T00:00:00Z" };
    const fresh: Board = { ...old, name: "Novo", updatedAt: "2026-11-25T00:00:00Z" };
    expect(mergeBoards([old], [fresh])[0].name).toBe("Novo");
    expect(mergeBoards([fresh], [old])[0].name).toBe("Novo");
  });

  it("fits content inside the viewport", () => {
    const view = fitView({ x: 0, y: 0, w: 1000, h: 500 }, 800, 600);
    expect(view.zoom).toBeLessThan(1);
    expect(1000 * view.zoom).toBeLessThanOrEqual(800);
  });
});
