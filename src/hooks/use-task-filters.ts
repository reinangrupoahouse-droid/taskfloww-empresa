import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { TaskFilterValue } from "@/components/TaskFilters";

/**
 * Filtros de tarefas que continuam valendo ao sair e voltar da tela.
 *
 * Kanban, Lista e Calendário compartilham os mesmos filtros por pessoa e
 * ambiente; ficam gravados neste navegador (conveniência pessoal, não dado
 * compartilhado). Se o armazenamento estiver bloqueado, funcionam só na sessão.
 */
const filtersKey = (userId?: string | null, workspaceId?: string | null) =>
  `taskfloww-filtros-tarefas:${userId ?? "anon"}:${workspaceId ?? "default"}`;

function readStored(key: string): TaskFilterValue | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as TaskFilterValue)
      : null;
  } catch {
    return null;
  }
}

export function usePersistentTaskFilters(
  initial: () => TaskFilterValue,
  /** preferInitial: um link explícito (ex.: ?mine=1) vale mais que o filtro salvo. */
  options: {
    persist?: boolean;
    preferInitial?: boolean;
    /** Campos que esta tela não lê nem grava no filtro compartilhado (ex.: período no Calendário). */
    localFields?: Array<keyof TaskFilterValue>;
  } = {},
) {
  const persist = options.persist ?? true;
  const localFields = options.localFields ?? [];
  const localRef = useRef(localFields);
  const { user, activeWorkspace } = useAuth();
  const key = filtersKey(user?.id, activeWorkspace?.id);
  const withoutLocal = (value: TaskFilterValue | null) => {
    if (!value) return null;
    const copy = { ...value };
    for (const field of localRef.current) delete copy[field];
    return copy;
  };
  const stored = useRef<TaskFilterValue | null>(
    persist && !options.preferInitial && typeof window !== "undefined"
      ? withoutLocal(readStored(key))
      : null,
  );
  /** true quando a tela abriu com filtros salvos (não reaplicar padrões por cima). */
  const restored = stored.current !== null;
  const [filters, setFiltersState] = useState<TaskFilterValue>(() =>
    stored.current ? { ...initial(), ...stored.current } : initial(),
  );

  // Trocar de pessoa/ambiente carrega os filtros daquele contexto.
  const lastKey = useRef(key);
  useEffect(() => {
    if (!persist || lastKey.current === key) return;
    lastKey.current = key;
    const next = withoutLocal(readStored(key));
    if (next) setFiltersState(next);
  }, [key, persist]);

  useEffect(() => {
    if (!persist) return;
    try {
      // Campos locais desta tela não sobrescrevem o que as outras telas salvaram.
      const previous = readStored(key) ?? {};
      const next: TaskFilterValue = { ...filters };
      for (const field of localRef.current) {
        if (field in previous) (next as Record<string, unknown>)[field] = previous[field];
        else delete next[field];
      }
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      /* Sem armazenamento: o filtro vale só nesta sessão. */
    }
  }, [filters, key, persist]);

  const setFilters = useCallback(
    (value: SetStateAction<TaskFilterValue>) => setFiltersState(value),
    [],
  );
  return [filters, setFilters, restored] as const;
}

/** Ids das tarefas que têm alguma das tags do filtro (além da tag principal). */
export function useTagFilterTaskIds(tagIds?: string[]) {
  const tags = [...(tagIds ?? [])].sort();
  const { data } = useQuery({
    queryKey: ["task_tag_filter", tags],
    enabled: tags.length > 0,
    staleTime: 30_000,
    queryFn: async () => {
      const ids = new Set<string>();
      const pageSize = 1000;
      for (let from = 0; ; from += pageSize) {
        const { data: rows, error } = await supabase
          .from("task_tag_links")
          .select("task_id")
          .in("tag_id", tags)
          .order("task_id")
          .range(from, from + pageSize - 1);
        if (error) throw error;
        for (const row of rows ?? []) ids.add(row.task_id);
        if (!rows || rows.length < pageSize) break;
      }
      return ids;
    },
  });
  return tags.length > 0 ? (data ?? new Set<string>()) : null;
}
