import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { createBoard, mergeBoards, parseBoard, type Board, type BoardDoc } from "@/lib/board";

/**
 * Quadros do usuário.
 *
 * Salva imediatamente neste aparelho (funciona offline). Quando a tabela
 * `public.quadros` existe no Supabase, também sincroniza entre aparelhos;
 * se ela ainda não foi criada, o Quadro continua funcionando só localmente.
 */
/**
 * A tabela `quadros` vem da migração 20261125190000 e ainda não está nos tipos
 * gerados do Supabase; este é o único ponto sem tipagem estrita.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const quadrosTable = () => (supabase as any).from("quadros");

const storageKey = (userId?: string, workspaceId?: string) =>
  `taskfloww-quadros:${userId ?? "anon"}:${workspaceId ?? "default"}`;

function readLocal(key: string): Board[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.map(parseBoard).filter((b): b is Board => b !== null)
      : [];
  } catch {
    return [];
  }
}

function writeLocal(key: string, boards: Board[]) {
  try {
    localStorage.setItem(key, JSON.stringify(boards));
  } catch {
    /* Armazenamento cheio ou bloqueado: o quadro segue na memória desta sessão. */
  }
}

export type BoardSyncState = "local" | "syncing" | "synced" | "error";

export function useBoards() {
  const { user, activeWorkspace } = useAuth();
  const key = storageKey(user?.id, activeWorkspace?.id);
  const [boards, setBoards] = useState<Board[]>(() =>
    typeof window === "undefined" ? [] : readLocal(key),
  );
  const [sync, setSync] = useState<BoardSyncState>("local");
  const remoteReady = useRef(false);
  const pending = useRef(new Map<string, Board>());
  const timer = useRef<number | undefined>(undefined);

  // Recarrega ao trocar de usuário/ambiente e tenta o banco.
  useEffect(() => {
    const local = readLocal(key);
    setBoards(local);
    remoteReady.current = false;
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await quadrosTable()
        .select("id, name, data, updated_at")
        .eq("owner_id", user.id)
        .order("updated_at", { ascending: false });
      if (cancelled || error) return;
      remoteReady.current = true;
      const remote = (
        (data ?? []) as Array<{ id: string; name: string; data: unknown; updated_at: string }>
      )
        .map((row) =>
          parseBoard({ id: row.id, name: row.name, doc: row.data, updatedAt: row.updated_at }),
        )
        .filter((b): b is Board => b !== null);
      const merged = mergeBoards(local, remote);
      setBoards(merged);
      writeLocal(key, merged);
      setSync("synced");
      // Quadros criados antes da tabela existir sobem agora.
      const remoteIds = new Set(remote.map((b) => b.id));
      for (const board of merged)
        if (!remoteIds.has(board.id)) pending.current.set(board.id, board);
      if (pending.current.size) flushSoon();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, user?.id]);

  const flush = useCallback(async () => {
    if (!remoteReady.current || !user?.id || !pending.current.size) return;
    const rows = [...pending.current.values()].map((board) => ({
      id: board.id,
      owner_id: user.id,
      workspace_id: activeWorkspace?.id ?? null,
      name: board.name,
      data: board.doc,
      updated_at: board.updatedAt,
    }));
    pending.current.clear();
    setSync("syncing");
    const { error } = await quadrosTable().upsert(rows);
    setSync(error ? "error" : "synced");
  }, [user?.id, activeWorkspace?.id]);

  const flushSoon = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => void flush(), 1200);
  }, [flush]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const boardsRef = useRef(boards);
  boardsRef.current = boards;

  /** Grava a nova lista (local na hora) e agenda o envio do quadro alterado. */
  const commit = useCallback(
    (next: Board[], changed?: Board) => {
      boardsRef.current = next;
      setBoards(next);
      writeLocal(key, next);
      if (changed && remoteReady.current) {
        pending.current.set(changed.id, changed);
        flushSoon();
      }
    },
    [key, flushSoon],
  );

  const create = useCallback(
    (name?: string) => {
      const board = createBoard(name);
      commit([board, ...boardsRef.current], board);
      return board;
    },
    [commit],
  );

  const patch = useCallback(
    (id: string, change: (board: Board) => Board) => {
      let changed: Board | undefined;
      const next = boardsRef.current.map((board) => {
        if (board.id !== id) return board;
        changed = { ...change(board), updatedAt: new Date().toISOString() };
        return changed;
      });
      if (changed) commit(next, changed);
    },
    [commit],
  );

  const saveDoc = useCallback(
    (id: string, doc: BoardDoc) => patch(id, (board) => ({ ...board, doc })),
    [patch],
  );

  const rename = useCallback(
    (id: string, name: string) =>
      patch(id, (board) => ({ ...board, name: name.trim() || board.name })),
    [patch],
  );

  const remove = useCallback(
    (id: string) => {
      commit(boardsRef.current.filter((board) => board.id !== id));
      pending.current.delete(id);
      if (remoteReady.current) void quadrosTable().delete().eq("id", id);
    },
    [commit],
  );

  return { boards, create, saveDoc, rename, remove, sync };
}
