import { useState } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Building2, ChevronDown } from "lucide-react";
import { useClients } from "@/hooks/use-data";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

export function ClientsNavGroup({
  expanded,
  active,
  onNavigate,
}: {
  expanded: boolean;
  active: boolean;
  onNavigate?: () => void;
}) {
  const { data: clients = [], isLoading, isError } = useClients();
  const [open, setOpen] = useState(active);
  const selectedId = useRouterState({
    select: (state) => (state.location.search as { client?: string }).client,
  });
  const links = clients.map((client) => (
    <Link
      key={client.id}
      to="/clients"
      search={{ client: client.id }}
      onClick={onNavigate}
      className={`block min-w-0 cursor-pointer rounded-lg px-3 py-2 text-xs transition hover:bg-sidebar-accent ${active && selectedId === client.id ? "bg-sidebar-accent font-semibold text-sidebar-foreground" : "text-sidebar-foreground/70"}`}
    >
      <span className="block truncate" title={client.name}>
        {client.name}
      </span>
      {!client.is_active && <span className="text-[10px] text-muted-foreground">Inativo</span>}
    </Link>
  ));
  const status = isLoading
    ? "Carregando clientes…"
    : isError
      ? "Não foi possível carregar os clientes."
      : !clients.length
        ? "Nenhum cliente disponível."
        : null;

  if (!expanded)
    return (
      <div className="relative mx-auto h-10 w-10">
        <Link
          to="/clients"
          search={{}}
          onClick={onNavigate}
          data-nav-row
          title="Clientes · calendário geral"
          className={`tf-nav-item grid h-10 w-10 cursor-pointer place-items-center rounded-[0.8rem] ${active ? "tf-nav-item-active text-sidebar-foreground" : "text-sidebar-foreground/65 hover:text-sidebar-foreground"}`}
        >
          <span className="tf-nav-icon grid h-7 w-7 place-items-center rounded-[0.55rem]">
            <Building2 className="h-[17px] w-[17px]" strokeWidth={1.75} />
          </span>
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Abrir lista de clientes"
              className="absolute -bottom-1 -right-1 grid h-5 w-5 cursor-pointer place-items-center rounded-full border bg-background shadow-sm transition-transform duration-150 active:scale-90"
            >
              <ChevronDown className="h-3 w-3" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="right"
            align="start"
            className="max-h-[65dvh] w-60 overflow-y-auto"
          >
            <DropdownMenuItem asChild>
              <Link to="/clients" search={{}} onClick={onNavigate}>
                Todos os clientes no calendário
              </Link>
            </DropdownMenuItem>
            {clients.map((client) => (
              <DropdownMenuItem key={client.id} asChild>
                <Link
                  to="/clients"
                  search={{ client: client.id }}
                  onClick={onNavigate}
                  className="truncate"
                >
                  {client.name}
                </Link>
              </DropdownMenuItem>
            ))}
            {status && <p className="p-2 text-xs text-muted-foreground">{status}</p>}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="space-y-1">
      <div
        data-nav-row
        className={`tf-nav-item flex items-center rounded-[0.8rem] ${active ? "tf-nav-item-active font-medium text-sidebar-foreground" : "text-sidebar-foreground/65 hover:text-sidebar-foreground"} ${onNavigate && active ? "tf-nav-item-mobile-active" : ""}`}
      >
        <Link
          to="/clients"
          search={{}}
          onClick={onNavigate}
          className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-2 pl-2.5 text-sm"
        >
          <span className="tf-nav-icon grid h-7 w-7 shrink-0 place-items-center rounded-[0.55rem]">
            <Building2 className="h-[17px] w-[17px]" strokeWidth={1.75} />
          </span>
          Clientes
        </Link>
        <button
          type="button"
          aria-label={open ? "Recolher lista de clientes" : "Abrir lista de clientes"}
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
          className="mr-1 grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-[0.6rem] hover:bg-sidebar-accent"
        >
          <ChevronDown className={`h-4 w-4 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)] ${open ? "rotate-180" : ""}`} />
        </button>
      </div>
      <CollapsibleContent className="tf-collapsible ml-6 max-h-[45dvh] space-y-0.5 overflow-y-auto border-l border-sidebar-border pl-2">
        {links}
        {status && <p className="p-2 text-xs text-muted-foreground">{status}</p>}
      </CollapsibleContent>
    </Collapsible>
  );
}
