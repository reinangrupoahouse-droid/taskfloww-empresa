import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ user: { id: "u1" }, activeWorkspace: { id: "w1" } }),
}));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

const { TagChipsPicker, ClientChip } = await import("./TaskListExtras");

const render = (node: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(QueryClientProvider, { client: new QueryClient() }, node));

describe("tags na criação da tarefa", () => {
  const tags = [
    { id: "consultoria", name: "Consultoria", color: "#3b74b0" },
    { id: "urgente", name: "Urgente", color: "#b5524f" },
  ];

  it("shows every tag, fills the selected ones with their color and offers a new tag", () => {
    const html = render(
      createElement(TagChipsPicker, { tags, selected: ["consultoria"], onChange: () => {} }),
    );
    expect(html).toContain("Consultoria");
    expect(html).toContain("Urgente");
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("background:#3b74b0");
    expect(html).toContain("Nova tag");
  });

  it("fills the client chip with the client color and readable text", () => {
    const html = render(
      createElement(ClientChip, { name: "Magalhães Advocacia", color: "#8b1e1e" }),
    );
    expect(html).toContain("background:#8b1e1e");
    expect(html).toContain("color:#fff");
  });
});
