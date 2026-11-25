import { supabase } from "@/integrations/supabase/client";

/**
 * Anexos ao vivo nos cards do Kanban com UMA conexão para a tela inteira.
 *
 * Antes cada card abria o próprio canal no Supabase Realtime; com dezenas de
 * cards isso significava dezenas de assinaturas abertas e deixava o quadro
 * lento. Aqui um canal único recebe as mudanças da tabela `attachments` (o
 * RLS continua filtrando o que a pessoa pode ver) e repassa a cada card só o
 * que é da tarefa dele.
 */
type InsertListener = (row: Record<string, unknown>) => void;
type DeleteListener = (id: string) => void;
type Listener = { onInsert: InsertListener; onDelete: DeleteListener };

const listeners = new Map<string, Set<Listener>>();
let channel: ReturnType<typeof supabase.channel> | null = null;
let closeTimer: ReturnType<typeof setTimeout> | undefined;

function ensureChannel() {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = undefined;
  }
  if (channel) return;
  channel = supabase
    .channel(`task-card-attachments-shared-${Math.random().toString(36).slice(2)}`)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "attachments" },
      ({ new: raw }: { new: Record<string, unknown> }) => {
        const taskId = typeof raw.task_id === "string" ? raw.task_id : null;
        if (!taskId) return;
        listeners.get(taskId)?.forEach((listener) => listener.onInsert(raw));
      },
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "attachments" },
      ({ old }: { old: { id?: string; task_id?: string } }) => {
        if (!old?.id) return;
        // Sem "replica identity full" o DELETE traz só o id: avisa todos os
        // cards e cada um remove o anexo se ele estiver na sua lista.
        const targets = old.task_id ? [listeners.get(old.task_id)] : [...listeners.values()];
        targets.forEach((set) => set?.forEach((listener) => listener.onDelete(old.id!)));
      },
    )
    .subscribe((status: string, err?: Error) => {
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || err) {
        console.warn("[attachments realtime] canal não conectou:", status, err);
      }
    });
}

export function subscribeTaskAttachments(taskId: string, listener: Listener) {
  let set = listeners.get(taskId);
  if (!set) {
    set = new Set();
    listeners.set(taskId, set);
  }
  set.add(listener);
  ensureChannel();
  return () => {
    const current = listeners.get(taskId);
    current?.delete(listener);
    if (current && !current.size) listeners.delete(taskId);
    // Fecha o canal pouco depois do último card sair (trocar de aba não
    // derruba e reabre a conexão à toa).
    if (!listeners.size && channel) {
      closeTimer = setTimeout(() => {
        if (listeners.size || !channel) return;
        void supabase.removeChannel(channel);
        channel = null;
      }, 5000);
    }
  };
}
