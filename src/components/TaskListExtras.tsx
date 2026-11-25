import { useEffect, useMemo, useState, type MouseEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  FileText,
  Image as ImageIcon,
  Link2,
  Paperclip,
  Plus,
  Tag as TagIcon,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useTaskCardRelated } from "@/hooks/use-task-card-related";
import { readCardAttachments, type CardAttachment } from "@/lib/task-card-reads";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { AttachmentPreviewDialog } from "@/components/AttachmentPreviewDialog";

const LINK_MIME = "text/uri-list";
const stop = (event: MouseEvent) => event.stopPropagation();

type ListTag = { id: string; name: string; color: string };
type ListTask = { id: string; tag_id?: string | null };

export function readableText(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#111";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}

const NEW_TAG_COLORS = [
  "#5b6b8c",
  "#3b74b0",
  "#3f8a5a",
  "#b0811c",
  "#b5524f",
  "#7058b5",
  "#4b5563",
];

/** Tags da tarefa na Lista: mostra todas, marca/desmarca e cria tags novas ali mesmo. */
export function ListTagsCell({ task, tags }: { task: ListTask; tags: ListTag[] }) {
  const related = useTaskCardRelated(task.id);
  const qc = useQueryClient();
  const { user } = useAuth();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(NEW_TAG_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => setTagIds(related.data?.tagIds ?? []), [related.data]);

  const selected = useMemo(() => {
    const ids = [...new Set([...(task.tag_id ? [task.tag_id] : []), ...tagIds])];
    return ids
      .map((id) => tags.find((tag) => tag.id === id))
      .filter((tag): tag is ListTag => !!tag);
  }, [tagIds, tags, task.tag_id]);

  const toggle = async (tagId: string) => {
    if (saving) return;
    const has = tagIds.includes(tagId) || task.tag_id === tagId;
    const next = has ? tagIds.filter((id) => id !== tagId) : [...tagIds, tagId];
    setTagIds(next);
    setSaving(true);
    try {
      if (has) {
        const { error } = await supabase
          .from("task_tag_links")
          .delete()
          .eq("task_id", task.id)
          .eq("tag_id", tagId);
        if (error) throw error;
        if (task.tag_id === tagId) {
          const { error: taskError } = await supabase
            .from("tasks")
            .update({ tag_id: next[0] ?? null })
            .eq("id", task.id);
          if (taskError) throw taskError;
        }
      } else {
        const { error } = await supabase
          .from("task_tag_links")
          .insert({ task_id: task.id, tag_id: tagId });
        if (error) throw error;
        if (!task.tag_id) {
          const { error: taskError } = await supabase
            .from("tasks")
            .update({ tag_id: tagId })
            .eq("id", task.id);
          if (taskError) throw taskError;
        }
      }
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["task_card_related"] }),
        qc.invalidateQueries({ queryKey: ["task_tag_filter"] }),
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (error) {
      setTagIds(related.data?.tagIds ?? []);
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a tag.");
    } finally {
      setSaving(false);
    }
  };

  const createTag = async () => {
    const name = newName.trim();
    if (!name || creating || !user?.id) return;
    const existing = tags.find((tag) => tag.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      setNewName("");
      if (!(tagIds.includes(existing.id) || task.tag_id === existing.id)) await toggle(existing.id);
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("task_tags")
        .insert({ name, color: newColor, created_by: user.id, position: tags.length })
        .select("id")
        .single();
      if (error) throw error;
      setNewName("");
      await qc.invalidateQueries({ queryKey: ["task_tags"] });
      if (data?.id) await toggle(data.id);
      toast.success(`Tag “${name}” criada`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a tag.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stop}
          title="Adicionar ou remover tags"
          className="flex min-h-7 w-full flex-wrap items-center gap-1 rounded-md px-1 py-0.5 text-left transition-colors hover:bg-muted/70"
        >
          {selected.map((tag) => (
            <span
              key={tag.id}
              className="rounded-[5px] px-1.5 py-0.5 text-[11px] font-semibold leading-tight"
              style={{ background: tag.color, color: readableText(tag.color) }}
            >
              {tag.name}
            </span>
          ))}
          {selected.length === 0 ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <TagIcon className="h-3 w-3" /> Adicionar
            </span>
          ) : (
            <span className="grid h-5 w-5 place-items-center rounded border border-dashed text-muted-foreground">
              <Plus className="h-3 w-3" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-60 p-1.5" onClick={stop}>
        <p className="px-1.5 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">Tags</p>
        <div className="max-h-64 space-y-0.5 overflow-y-auto">
          {tags.length === 0 ? (
            <p className="px-1.5 py-2 text-xs text-muted-foreground">
              Nenhuma tag ainda. Crie a primeira abaixo.
            </p>
          ) : (
            tags.map((tag) => {
              const checked = tagIds.includes(tag.id) || task.tag_id === tag.id;
              return (
                <button
                  key={tag.id}
                  type="button"
                  disabled={saving}
                  onClick={() => void toggle(tag.id)}
                  className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-muted disabled:opacity-60"
                >
                  <span
                    className={`grid h-4 w-4 shrink-0 place-items-center rounded border ${checked ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}
                  >
                    {checked ? <Check className="h-3 w-3" /> : null}
                  </span>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ background: tag.color }}
                  />
                  <span className="min-w-0 break-words">{tag.name}</span>
                </button>
              );
            })
          )}
        </div>
        <form
          className="mt-1.5 space-y-1.5 border-t px-1 pt-2"
          onSubmit={(event) => {
            event.preventDefault();
            void createTag();
          }}
        >
          <div className="flex items-center gap-1.5">
            <input
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
              placeholder="Nova tag"
              aria-label="Nome da nova tag"
              maxLength={40}
              className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
            <button
              type="submit"
              disabled={!newName.trim() || creating}
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-md bg-primary px-2.5 text-xs font-medium text-primary-foreground transition-transform active:scale-95 disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" /> {creating ? "Criando…" : "Criar"}
            </button>
          </div>
          <div
            className="flex items-center gap-1.5 px-0.5"
            role="radiogroup"
            aria-label="Cor da nova tag"
          >
            {NEW_TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={newColor === color}
                aria-label={`Cor ${color}`}
                onClick={() => setNewColor(color)}
                className={`h-5 w-5 rounded-full transition-transform active:scale-90 ${newColor === color ? "ring-2 ring-ring ring-offset-2 ring-offset-popover" : ""}`}
                style={{ background: color }}
              />
            ))}
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

const fileIcon = (file: CardAttachment) =>
  file.mime_type === LINK_MIME
    ? Link2
    : file.mime_type?.startsWith("image/")
      ? ImageIcon
      : FileText;

/** Arquivos da tarefa na Lista: quantidade e abertura direta, sem abrir a tarefa. */
export function ListFilesCell({
  taskId,
  hideEmpty = false,
  compact = false,
}: {
  taskId: string;
  hideEmpty?: boolean;
  /** Versão mínima (clipe + número) para espaços apertados, como o Calendário. */
  compact?: boolean;
}) {
  const { user, activeWorkspace } = useAuth();
  const [preview, setPreview] = useState<CardAttachment | null>(null);
  const { data: files = [], isLoading } = useQuery({
    queryKey: ["task_list_attachments", user?.id ?? null, activeWorkspace?.id ?? null, taskId],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: () => readCardAttachments(`${user?.id}:${activeWorkspace?.id ?? ""}`, taskId),
  });

  const open = (file: CardAttachment) => {
    if (file.mime_type === LINK_MIME) {
      window.open(file.storage_path, "_blank", "noopener,noreferrer");
      return;
    }
    setPreview(file);
  };

  if (isLoading) return hideEmpty ? null : <span className="text-muted-foreground">…</span>;
  if (!files.length) return hideEmpty ? null : <span className="text-muted-foreground">—</span>;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={stop}
            onPointerDown={(event) => event.stopPropagation()}
            title={`Ver arquivos da tarefa (${files.length})`}
            aria-label={`Ver ${files.length} ${files.length === 1 ? "arquivo" : "arquivos"} da tarefa`}
            className={
              compact
                ? "inline-flex min-h-6 shrink-0 items-center gap-0.5 rounded-md border bg-card px-1 text-[10px] font-semibold tabular-nums text-muted-foreground shadow-sm transition-[background-color,color,transform] hover:bg-muted hover:text-foreground active:scale-95"
                : "inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs font-medium transition-[background-color,transform] hover:bg-muted active:scale-95"
            }
          >
            <Paperclip className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            {compact
              ? files.length
              : `${files.length} ${files.length === 1 ? "arquivo" : "arquivos"}`}
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-72 p-1.5" onClick={stop}>
          <p className="px-1.5 pb-1 pt-0.5 text-xs font-medium text-muted-foreground">Arquivos</p>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {files.map((file) => {
              const Icon = fileIcon(file);
              return (
                <button
                  key={file.id}
                  type="button"
                  onClick={() => open(file)}
                  className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left text-sm transition-colors hover:bg-muted"
                >
                  <Icon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 break-words">{file.file_name}</span>
                </button>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
      {/* O visualizador fica dentro da linha no React: o clique não pode abrir a tarefa. */}
      <div onClick={stop} className="contents">
        <AttachmentPreviewDialog
          open={!!preview}
          onOpenChange={(value) => !value && setPreview(null)}
          attachment={preview}
        />
      </div>
    </>
  );
}

/** Cliente na Lista com a cor preenchida, como a faixa do card no Kanban. */
export function ClientChip({ name, color }: { name: string; color?: string | null }) {
  if (!color)
    return (
      <span className="inline-flex max-w-full rounded-md border px-2 py-0.5 text-xs font-semibold leading-tight">
        {name}
      </span>
    );
  return (
    <span
      className="inline-flex max-w-full items-center rounded-md px-2 py-0.5 text-xs font-bold uppercase leading-tight tracking-wide shadow-[inset_0_1px_0_rgb(255_255_255/0.22),inset_0_-1px_0_rgb(0_0_0/0.12)]"
      style={{ background: color, color: readableText(color) }}
    >
      {name}
    </span>
  );
}

/**
 * Seletor de tags do formulário de nova tarefa: marca várias tags e cria uma
 * tag nova (com cor) sem sair do formulário. Só altera a seleção; quem chama
 * grava os vínculos depois que a tarefa existir.
 */
export function TagChipsPicker({
  tags,
  selected,
  onChange,
}: {
  tags: ListTag[];
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState(NEW_TAG_COLORS[0]);
  const [creating, setCreating] = useState(false);
  const [adding, setAdding] = useState(false);

  const toggle = (id: string) =>
    onChange(selected.includes(id) ? selected.filter((tagId) => tagId !== id) : [...selected, id]);

  const create = async () => {
    const name = newName.trim();
    if (!name || creating || !user?.id) return;
    const existing = tags.find((tag) => tag.name.trim().toLowerCase() === name.toLowerCase());
    if (existing) {
      if (!selected.includes(existing.id)) onChange([...selected, existing.id]);
      setNewName("");
      setAdding(false);
      return;
    }
    setCreating(true);
    try {
      const { data, error } = await supabase
        .from("task_tags")
        .insert({ name, color: newColor, created_by: user.id, position: tags.length })
        .select("id")
        .single();
      if (error) throw error;
      await qc.invalidateQueries({ queryKey: ["task_tags"] });
      if (data?.id) onChange([...selected, data.id]);
      setNewName("");
      setAdding(false);
      toast.success(`Tag “${name}” criada`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível criar a tag.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {tags.map((tag) => {
          const active = selected.includes(tag.id);
          return (
            <button
              key={tag.id}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(tag.id)}
              className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold transition-[background-color,border-color,color,transform] duration-150 active:scale-95 ${
                active
                  ? "border-transparent shadow-sm"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
              style={active ? { background: tag.color, color: readableText(tag.color) } : undefined}
            >
              {active ? (
                <Check className="h-3 w-3" />
              ) : (
                <span className="h-2 w-2 rounded-full" style={{ background: tag.color }} />
              )}
              {tag.name}
            </button>
          );
        })}
        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed px-2.5 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <Plus className="h-3 w-3" /> Nova tag
          </button>
        )}
      </div>
      {adding && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border bg-muted/30 p-2">
          <input
            autoFocus
            value={newName}
            onChange={(event) => setNewName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void create();
              }
              if (event.key === "Escape") {
                event.stopPropagation();
                setAdding(false);
              }
            }}
            placeholder="Nome da tag"
            aria-label="Nome da nova tag"
            maxLength={40}
            className="h-8 min-w-0 flex-1 rounded-md border bg-background px-2 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="flex items-center gap-1.5" role="radiogroup" aria-label="Cor da nova tag">
            {NEW_TAG_COLORS.map((color) => (
              <button
                key={color}
                type="button"
                role="radio"
                aria-checked={newColor === color}
                aria-label={`Cor ${color}`}
                onClick={() => setNewColor(color)}
                className={`h-5 w-5 rounded-full transition-transform active:scale-90 ${newColor === color ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""}`}
                style={{ background: color }}
              />
            ))}
          </div>
          <button
            type="button"
            disabled={!newName.trim() || creating}
            onClick={() => void create()}
            className="inline-flex h-8 items-center gap-1 rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground transition-transform active:scale-95 disabled:opacity-50"
          >
            {creating ? "Criando…" : "Criar"}
          </button>
          <button
            type="button"
            onClick={() => setAdding(false)}
            className="h-8 rounded-md px-2 text-xs text-muted-foreground hover:text-foreground"
          >
            Cancelar
          </button>
        </div>
      )}
    </div>
  );
}
