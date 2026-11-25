import { Link, useRouterState } from "@tanstack/react-router";
import { useAuth } from "@/hooks/use-auth";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  LayoutDashboard,
  ListChecks,
  Users,
  Building2,
  Settings,
  LogOut,
  Moon,
  Sun,
  PanelLeft,
  PanelRight,
  BarChart3,
  Trash2,
  MessageSquareText,
  Layers3,
  ContactRound,
  Waypoints,
} from "lucide-react";
import { useIsMobile } from "@/hooks/use-mobile";
import { NotificationBell } from "@/components/NotificationBell";
import { UpdateCenter } from "@/components/UpdateCenter";
import { AssignmentPopup } from "@/components/AssignmentPopup";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import taskflowMark from "@/assets/taskflow-mark.png";
import { useMuralUnreadCount } from "@/hooks/use-mural-unread";
import { useMuralLaunchDigest } from "@/hooks/use-mural-launch-digest";
import { useMuralRealtime } from "@/hooks/use-mural-realtime";
import { canSwitchTaskFlowEnvironment } from "@/lib/environment-access";
import { WorkspaceLoadingScreen } from "@/components/WorkspaceLoadingScreen";
import { ClientsNavGroup } from "@/components/ClientsNavGroup";
import { installMarkupPasteGuard } from "@/lib/paste-markup-guard";

function useTheme() {
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window === "undefined") return "dark";
    try {
      const stored = localStorage.getItem("taskfloww-empresa-theme");
      if (stored === "dark" || stored === "light") return stored;
    } catch { /* Use the default if browser storage is unavailable. */ }
    return "dark";
  });
  useEffect(() => {
    const root = document.documentElement;
    // Troca de tema com uma transição curta de cor, sem piscar a tela.
    root.classList.add("tf-theme-switching");
    root.classList.toggle("dark", theme === "dark");
    const timer = window.setTimeout(() => root.classList.remove("tf-theme-switching"), 320);
    try { localStorage.setItem("taskfloww-empresa-theme", theme); } catch { /* Theme still works for this session. */ }
    return () => window.clearTimeout(timer);
  }, [theme]);
  return { theme, toggle: () => setTheme((t) => (t === "dark" ? "light" : "dark")) };
}

type NavItem = { to: string; label: string; icon: typeof LayoutDashboard; adminOnly?: boolean; permission?: string };
const allNav: readonly NavItem[] = [
  { to: "/mural", label: "Mural", icon: MessageSquareText, permission: "mural" },
  { to: "/dashboard", label: "Dashboard", icon: LayoutDashboard, permission: "dashboard" },
  { to: "/tasks", label: "Minhas Tarefas", icon: ListChecks, permission: "tasks" },
  { to: "/quadro", label: "Quadro", icon: Waypoints },
  { to: "/clients", label: "Clientes", icon: Building2, permission: "clients" },
  { to: "/crm", label: "CRM", icon: ContactRound, permission: "crm" },
  { to: "/reports", label: "Relatórios", icon: BarChart3, permission: "reports" },
  { to: "/users", label: "Usuários", icon: Users, adminOnly: true, permission: "users" },
  { to: "/trash", label: "Lixeira", icon: Trash2, permission: "trash" },
  { to: "/settings", label: "Personalizar", icon: Settings, permission: "settings" },
] as const;

const sectionTitle = (pathname: string) => {
  const match = allNav.find((item) => pathname === item.to || pathname.startsWith(item.to + "/"));
  if (match) return match.label;
  if (pathname.startsWith("/client-report")) return "Relatório do cliente";
  if (pathname.startsWith("/ambientes")) return "Ambiente";
  return "Taskfloww";
};

/** Marca: o símbolo do TaskFlow em aço escovado, sem o logotipo da LA. */
function BrandMark({ expanded = true }: { expanded?: boolean }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="tf-brand-mark grid h-9 w-9 shrink-0 place-items-center rounded-[0.7rem]">
        <img src={taskflowMark} alt="" className="h-6 w-6 object-contain" />
      </span>
      <span
        aria-hidden={!expanded}
        className={`tf-brand-word overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 motion-reduce:transition-none ${expanded ? "max-w-40 opacity-100" : "max-w-0 opacity-0"}`}
      >
        Taskfloww
      </span>
    </div>
  );
}

/** Pílula que desliza até o item ativo do menu (mesma posição real do item). */
function useNavIndicator(deps: unknown[]) {
  const navRef = useRef<HTMLElement | null>(null);
  const [rect, setRect] = useState<{ top: number; height: number; left: number; width: number } | null>(null);
  const measure = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const active = nav.querySelector<HTMLElement>("[data-nav-active='true']");
    const row = active?.querySelector<HTMLElement>("[data-nav-row]") ?? active;
    if (!row) return setRect(null);
    const navBox = nav.getBoundingClientRect();
    const box = row.getBoundingClientRect();
    setRect({ top: box.top - navBox.top + nav.scrollTop, height: box.height, left: box.left - navBox.left, width: box.width });
  }, []);
  useLayoutEffect(() => {
    measure();
    // A largura do menu anima ao recolher; mede de novo ao fim da transição.
    const timer = window.setTimeout(measure, 320);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => {
    const nav = navRef.current;
    if (!nav || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => measure());
    observer.observe(nav);
    return () => observer.disconnect();
  }, [measure]);
  return { navRef, rect, measure };
}

export function AppShell({ children }: { children: ReactNode }) {
  const mobileViewport = useIsMobile();
  const {
    profile,
    user,
    signOut,
    isAdmin,
    hasPermission,
    workspaces,
    activeWorkspace,
    isWorkspaceTransitioning,
  } = useAuth();
  const muralUnreadCount = useMuralUnreadCount();
  // Resumo da atividade leve do mural desde a última visita — em qualquer
  // tela, uma vez por carregamento do sistema.
  useMuralLaunchDigest();
  // Atividade do mural ao vivo em qualquer tela (avisos + cache fresco).
  useMuralRealtime();
  const canSwitchEnvironments = canSwitchTaskFlowEnvironment(workspaces.length);
  const nav = useMemo(
    () =>
      allNav.filter((item) => {
        if (item.adminOnly && !isAdmin) return false;
        return !item.permission || hasPermission(item.permission);
      }),
    [isAdmin, hasPermission],
  );

  const { theme, toggle } = useTheme();
  const [sidebarOpen, setSidebarOpen] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      const stored = localStorage.getItem("sidebar-open");
      return stored === null ? true : stored === "true";
    } catch {
      return true;
    }
  });
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  useEffect(() => {
    try { localStorage.setItem("sidebar-open", String(sidebarOpen)); } catch { /* Preference is optional. */ }
  }, [sidebarOpen]);
  // Every text field: copied markup ("<span>…</span>") is pasted without the tags.
  useEffect(() => installMarkupPasteGuard(), []);
  // Luz dos cards (.tf-spot): um único ouvinte delegado grava a posição do
  // cursor no próprio card, sem re-renderizar nada.
  useEffect(() => {
    if (!window.matchMedia?.("(hover: hover) and (pointer: fine)").matches) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      const target = (event.target as Element | null)?.closest?.(".tf-spot") as HTMLElement | null;
      if (!target) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = target.getBoundingClientRect();
        target.style.setProperty("--mx", `${event.clientX - box.left}px`);
        target.style.setProperty("--my", `${event.clientY - box.top}px`);
      });
    };
    document.addEventListener("pointermove", onMove, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("pointermove", onMove);
    };
  }, []);

  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const initials = (profile?.full_name || user?.email || "?").slice(0, 2).toUpperCase();
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + "/");
  const section = sectionTitle(pathname);
  const sectionKey = "/" + (pathname.split("/")[1] ?? "");

  const { navRef, rect } = useNavIndicator([pathname, sidebarOpen, nav.length]);

  // Ao trocar de aba, o conteúdo entra com um leve deslize e desfoque. Usa
  // WAAPI para não remontar a página (formulários e filtros continuam intactos).
  const pageRef = useRef<HTMLDivElement | null>(null);
  const mainRef = useRef<HTMLElement | null>(null);
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    mainRef.current?.scrollTo({ top: 0 });
    const page = pageRef.current;
    if (!page || typeof page.animate !== "function") return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    page.animate(
      reduce
        ? [{ opacity: 0.4 }, { opacity: 1 }]
        : [
            { opacity: 0, transform: "translateY(10px) scale(0.995)", filter: "blur(4px)" },
            { opacity: 1, transform: "none", filter: "blur(0)" },
          ],
      { duration: reduce ? 160 : 380, easing: "cubic-bezier(0.23, 1, 0.32, 1)" },
    );
  }, [sectionKey]);

  const renderNavLink = (n: NavItem, opts: { expanded: boolean; mobile?: boolean }) => {
    const active = isActive(n.to);
    const Icon = n.icon;
    return (
      <Link
        key={n.to}
        to={n.to}
        data-nav-active={opts.mobile ? undefined : active}
        data-nav-row
        onClick={opts.mobile ? () => setMobileMenuOpen(false) : undefined}
        aria-current={active ? "page" : undefined}
        className={`tf-nav-item relative z-[1] flex items-center rounded-[0.8rem] text-sm ${
          opts.expanded ? "w-full gap-3 px-2.5 py-2" : "mx-auto h-10 w-10 justify-center p-1"
        } ${active ? "tf-nav-item-active font-medium text-sidebar-foreground" : "text-sidebar-foreground/65 hover:text-sidebar-foreground"} ${
          opts.mobile && active ? "tf-nav-item-mobile-active" : ""
        }`}
        title={opts.expanded ? undefined : n.label}
      >
        <span className="tf-nav-icon grid h-7 w-7 shrink-0 place-items-center rounded-[0.55rem]">
          <Icon className="h-[17px] w-[17px]" strokeWidth={1.75} />
        </span>
        <span
          aria-hidden={!opts.expanded}
          className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-300 motion-reduce:transition-none ${opts.expanded ? "max-w-40 opacity-100" : "sr-only max-w-0 opacity-0"}`}
        >
          {n.label}
        </span>
        {n.to === "/mural" && muralUnreadCount > 0 && (
          <span
            className={`tf-badge-pop grid h-5 min-w-5 place-items-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white ${opts.expanded ? "ml-auto" : "absolute -right-1 -top-1"}`}
          >
            {muralUnreadCount > 99 ? "99+" : muralUnreadCount}
          </span>
        )}
      </Link>
    );
  };

  return (
    <div className="tf-shell flex h-dvh overflow-hidden bg-background">
      <aside
        className={`tf-sidebar hidden h-dvh shrink-0 flex-col overflow-hidden text-sidebar-foreground transition-[width] duration-300 ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none md:flex ${
          sidebarOpen ? "w-60" : "w-[4.5rem] items-center"
        }`}
      >
        <div className={`flex h-16 w-full shrink-0 items-center ${sidebarOpen ? "px-4" : "justify-center px-2"}`}>
          <Link to="/dashboard" aria-label="Taskfloww — início" className="rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <BrandMark expanded={sidebarOpen} />
          </Link>
        </div>

        <nav
          ref={navRef}
          aria-label="Navegação principal"
          className="sidebar-nav relative min-h-0 w-full flex-1 space-y-0.5 overflow-y-auto px-3 pb-3 pt-1"
        >
          {rect && (
            <span
              aria-hidden="true"
              className="tf-nav-indicator pointer-events-none absolute z-0 rounded-[0.8rem]"
              style={{
                transform: `translate(${rect.left}px, ${rect.top}px)`,
                width: rect.width,
                height: rect.height,
                top: 0,
                left: 0,
              }}
            />
          )}
          {nav.map((n) => {
            if (n.to === "/clients")
              return (
                <div key={`${activeWorkspace?.id}:clients`} data-nav-active={isActive("/clients")} className="relative z-[1]">
                  <ClientsNavGroup expanded={sidebarOpen} active={pathname.startsWith("/clients")} />
                </div>
              );
            return renderNavLink(n, { expanded: sidebarOpen });
          })}
        </nav>

        <div className={`border-t border-sidebar-border/70 ${sidebarOpen ? "p-3" : "flex flex-col items-center gap-2 p-1.5"}`}>
          <div className={`flex items-center gap-3 rounded-xl ${sidebarOpen ? "flex-wrap p-1.5" : "flex-col p-1"}`}>
            <Avatar className="tf-avatar h-8 w-8 rounded-[0.6rem]">
              <AvatarImage
                src={profile?.avatar_url || undefined}
                alt={profile?.full_name || user?.email || "Usuário"}
                className="rounded-[0.6rem]"
              />
              <AvatarFallback className="rounded-[0.6rem] bg-sidebar-primary text-xs text-sidebar-primary-foreground">
                {initials}
              </AvatarFallback>
            </Avatar>
            {sidebarOpen && (
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
                <p className="truncate text-xs text-sidebar-foreground/55">{user?.email}</p>
              </div>
            )}
            <div className={`flex ${sidebarOpen ? "w-full justify-end gap-1" : "flex-col gap-1.5"}`}>
              <Button
                size="icon"
                variant="ghost"
                className="tf-press h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={toggle}
                aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo escuro"}
                title={theme === "dark" ? "Modo claro" : "Modo escuro"}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="tf-press h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={() => setSidebarOpen((open) => !open)}
                aria-label={sidebarOpen ? "Recolher menu" : "Expandir menu"}
                aria-expanded={sidebarOpen}
                title={sidebarOpen ? "Recolher menu" : "Expandir menu"}
              >
                {sidebarOpen ? <PanelLeft className="h-4 w-4" /> : <PanelRight className="h-4 w-4" />}
              </Button>
              <Button
                size="icon"
                variant="ghost"
                className="tf-press h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                onClick={signOut}
                aria-label="Sair"
                title="Sair"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="tf-topbar fixed inset-x-0 top-0 z-40 flex h-[calc(3.5rem+env(safe-area-inset-top))] items-center justify-between gap-2 px-3 pt-[env(safe-area-inset-top)] md:hidden">
        <Button
          size="icon"
          variant="ghost"
          className="tf-press"
          aria-label="Abrir menu"
          aria-expanded={mobileMenuOpen}
          onClick={() => setMobileMenuOpen(true)}
        >
          <PanelLeft className="h-5 w-5" />
        </Button>
        <span key={section} className="tf-title-swap min-w-0 truncate font-semibold tracking-tight">{section}</span>
        <div className="flex shrink-0 items-center gap-1">
          <UpdateCenter />
          {canSwitchEnvironments && workspaces.length > 1 && (
            <Button asChild variant="ghost" size="icon" title="Trocar ambiente">
              <Link to="/ambientes">
                <Layers3 className="h-5 w-5" />
              </Link>
            </Button>
          )}
          {mobileViewport && <NotificationBell key={`${user?.id}:${activeWorkspace?.id}`} mobile />}
        </div>
      </div>

      {/* Mobile overlay sidebar */}
      <div
        className={`fixed inset-0 z-50 flex md:hidden ${mobileMenuOpen ? "" : "pointer-events-none"}`}
        aria-hidden={!mobileMenuOpen}
        inert={!mobileMenuOpen}
      >
        <div
          className={`tf-sidebar flex w-[min(18rem,calc(100vw-3rem))] min-w-0 flex-col pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)] transition-transform duration-[420ms] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none ${mobileMenuOpen ? "translate-x-0" : "-translate-x-full"}`}
        >
          <div className="flex h-16 items-center px-5">
            <BrandMark />
          </div>
          <nav aria-label="Navegação principal" className="tf-stagger min-h-0 flex-1 space-y-0.5 overflow-y-auto px-3 pb-3" data-open={mobileMenuOpen}>
            {nav.map((n) => {
              if (n.to === "/clients")
                return (
                  <ClientsNavGroup
                    key={`${activeWorkspace?.id}:clients-mobile`}
                    expanded
                    active={pathname.startsWith("/clients")}
                    onNavigate={() => setMobileMenuOpen(false)}
                  />
                );
              return renderNavLink(n, { expanded: true, mobile: true });
            })}
          </nav>
          <div className="border-t border-sidebar-border/70 p-3">
            <div className="flex items-center gap-3 rounded-xl p-1.5">
              <Avatar className="h-8 w-8 rounded-[0.6rem]">
                <AvatarImage
                  src={profile?.avatar_url || undefined}
                  alt={profile?.full_name || user?.email || "Usuário"}
                  className="rounded-[0.6rem]"
                />
                <AvatarFallback className="rounded-[0.6rem] bg-sidebar-primary text-xs text-sidebar-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{profile?.full_name || user?.email}</p>
                <p className="truncate text-xs text-sidebar-foreground/55">{user?.email}</p>
              </div>
              <Button size="icon" variant="ghost" className="tf-press h-8 w-8 shrink-0" onClick={toggle} aria-label={theme === "dark" ? "Usar modo claro" : "Usar modo escuro"}>
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
              <Button size="icon" variant="ghost" className="tf-press h-8 w-8 shrink-0" aria-label="Fechar menu" onClick={() => setMobileMenuOpen(false)}>
                <PanelLeft className="h-4 w-4" />
              </Button>
              <Button size="icon" variant="ghost" className="tf-press h-8 w-8 shrink-0" onClick={signOut} aria-label="Sair">
                <LogOut className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </div>
        <div
          className={`min-w-0 flex-1 bg-black/55 backdrop-blur-[2px] transition-opacity duration-300 ease-out motion-reduce:transition-none ${mobileMenuOpen ? "opacity-100" : "opacity-0"}`}
          onClick={() => setMobileMenuOpen(false)}
        />
      </div>

      <main ref={mainRef} className="tf-main min-w-0 flex-1 overflow-x-hidden overflow-y-auto pt-[calc(3.5rem+env(safe-area-inset-top))] md:pt-0">
        <div className="tf-topbar sticky top-0 z-40 hidden h-12 shrink-0 items-center gap-2 px-5 md:flex">
          <span key={section} className="tf-title-swap mr-auto truncate text-sm font-semibold tracking-tight text-foreground/90">
            {section}
          </span>
          <UpdateCenter />
          {canSwitchEnvironments && workspaces.length > 1 && (
            <Button asChild variant="ghost" className="h-9 gap-2 rounded-full px-3 text-sm" title="Trocar ambiente">
              <Link to="/ambientes">
                <Layers3 className="h-4 w-4" />
                <span>{activeWorkspace?.name ?? "Ambiente"}</span>
              </Link>
            </Button>
          )}
          {!mobileViewport && <NotificationBell key={`${user?.id}:${activeWorkspace?.id}`} />}
        </div>
        <div ref={pageRef} className="tf-page min-h-0">
          {children}
        </div>
      </main>
      <AssignmentPopup key={`${user?.id}:${activeWorkspace?.id}`} />
      {isWorkspaceTransitioning && <WorkspaceLoadingScreen workspaceName={activeWorkspace?.name} />}
    </div>
  );
}
