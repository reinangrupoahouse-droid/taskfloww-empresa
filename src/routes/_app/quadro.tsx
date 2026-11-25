import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, Cloud, HardDrive, Pencil, Plus, Trash2, Workflow } from "lucide-react";
import { MindBoard } from "@/components/board/MindBoard";
import { useBoards } from "@/hooks/use-boards";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_app/quadro")({ component: QuadroPage });

const ACTIVE_KEY = "taskfloww-quadro-ativo";

function QuadroPage() {
  const { boards, create, saveDoc, rename, remove, sync } = useBoards();
  const [activeId, setActiveId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(ACTIVE_KEY);
    } catch {
      return null;
    }
  });
  const [renaming, setRenaming] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const nameInput = useRef<HTMLInputElement | null>(null);

  // Sempre existe ao menos um quadro para começar a escrever.
  const seeded = useRef(false);
  useEffect(() => {
    if (boards.length || seeded.current) return;
    seeded.current = true;
    const board = create("Meu quadro");
    setActiveId(board.id);
  }, [boards.length, create]);

  const active = boards.find((board) => board.id === activeId) ?? boards[0] ?? null;
  useEffect(() => {
    if (!active) return;
    try {
      localStorage.setItem(ACTIVE_KEY, active.id);
    } catch {
      /* Lembrar o último quadro é só conveniência. */
    }
  }, [active]);

  useEffect(() => {
    if (renaming) nameInput.current?.select();
  }, [renaming]);

  if (!active) return null;

  const commitName = () => {
    rename(active.id, draftName);
    setRenaming(false);
  };

  const header = (
    <div className="flex items-center gap-2">
      <div className="tf-board-toolbar flex items-center gap-1 rounded-xl p-1 pr-1.5">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground shadow-[inset_0_1px_0_rgb(255_255_255/0.18)]">
          <Workflow className="h-4 w-4" strokeWidth={1.75} />
        </span>
        {renaming ? (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              commitName();
            }}
            className="flex items-center"
          >
            <input
              ref={nameInput}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
              onBlur={commitName}
              onKeyDown={(event) => event.key === "Escape" && setRenaming(false)}
              aria-label="Nome do quadro"
              maxLength={80}
              className="h-8 w-44 rounded-md border bg-background px-2 text-sm font-semibold outline-none focus:ring-2 focus:ring-ring sm:w-56"
            />
          </form>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="flex h-8 max-w-[11rem] items-center gap-1.5 rounded-lg px-2 text-sm font-semibold tracking-tight transition-colors hover:bg-accent sm:max-w-[16rem]"
              >
                <span className="truncate">{active.name}</span>
                <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
              <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
                Seus quadros
              </DropdownMenuLabel>
              <div className="max-h-72 overflow-y-auto">
                {boards.map((board) => (
                  <DropdownMenuItem
                    key={board.id}
                    onSelect={() => setActiveId(board.id)}
                    className="gap-2"
                  >
                    <span className="min-w-0 flex-1 truncate">{board.name}</span>
                    <span className="text-[11px] tabular-nums text-muted-foreground">
                      {board.doc.nodes.length}
                    </span>
                    {board.id === active.id && <Check className="h-3.5 w-3.5" />}
                  </DropdownMenuItem>
                ))}
              </div>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  const board = create(`Quadro ${boards.length + 1}`);
                  setActiveId(board.id);
                }}
                className="gap-2"
              >
                <Plus className="h-4 w-4" /> Novo quadro
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        {!renaming && (
          <>
            <button
              type="button"
              title="Renomear quadro"
              aria-label="Renomear quadro"
              onClick={() => {
                setDraftName(active.name);
                setRenaming(true);
              }}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-foreground active:scale-90"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              title="Excluir quadro"
              aria-label="Excluir quadro"
              onClick={() => setConfirmDelete(true)}
              className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-[color,background-color,transform] hover:bg-accent hover:text-destructive active:scale-90"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
      <span
        className="tf-board-toolbar hidden items-center gap-1.5 rounded-full px-3 py-1.5 text-xs text-muted-foreground sm:inline-flex"
        title={
          sync === "local"
            ? "Salvo automaticamente neste aparelho"
            : sync === "error"
              ? "Não foi possível sincronizar agora; o quadro continua salvo neste aparelho"
              : "Salvo automaticamente e sincronizado"
        }
      >
        {sync === "local" || sync === "error" ? (
          <HardDrive className="h-3.5 w-3.5" />
        ) : (
          <Cloud className="h-3.5 w-3.5" />
        )}
        {sync === "syncing"
          ? "Sincronizando…"
          : sync === "error"
            ? "Salvo só aqui"
            : sync === "local"
              ? "Salvo neste aparelho"
              : "Sincronizado"}
      </span>
    </div>
  );

  return (
    <div className="h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] md:h-[calc(100dvh-3rem)]">
      <MindBoard
        key={active.id}
        initialDoc={active.doc}
        onSave={(doc) => saveDoc(active.id, doc)}
        header={header}
      />
      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir “{active.name}”?</AlertDialogTitle>
            <AlertDialogDescription>
              O quadro e tudo o que está nele serão apagados. Essa ação não pode ser desfeita.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                const next = boards.find((board) => board.id !== active.id);
                remove(active.id);
                setActiveId(next?.id ?? null);
              }}
            >
              Excluir quadro
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
