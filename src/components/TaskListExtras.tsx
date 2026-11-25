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

function readableText(hex: string) {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#111";
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
}

/** Tags da tarefa na Lista: mostra todas e permite marcar/desmarcar ali mesmo. */
export function ListTagsCell({ task, tags }: { task: ListTask; tags: ListTag[] }) {
  const related = useTaskCardRelated(task.id);
  const qc = useQueryClient();
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
        qc.invalidateQueries({ queryKey: ["tasks"] }),
      ]);
    } catch (error) {
      setTagIds(related.data?.tagIds ?? []);
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a tag.");
    } finally {
      setSaving(false);
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
              Nenhuma tag criada. Crie tags em Personalizar.
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
export function ListFilesCell({ taskId }: { taskId: string }) {
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

  if (isLoading) return <span className="text-muted-foreground">…</span>;
  if (!files.length) return <span className="text-muted-foreground">—</span>;

  return (
    <>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            onClick={stop}
            title="Ver arquivos da tarefa"
            className="inline-flex items-center gap-1.5 rounded-md border bg-background/60 px-2 py-1 text-xs font-medium transition-[background-color,transform] hover:bg-muted active:scale-95"
          >
            <Paperclip className="h-3.5 w-3.5" />
            {files.length} {files.length === 1 ? "arquivo" : "arquivos"}
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
