import type { Subtask, Task } from "@/hooks/use-data";

export type CalendarTaskEntry =
  | { kind: "task"; task: Task; subtasks: Subtask[] }
  | { kind: "subtask"; task: Task; subtask: Subtask };

/** Keep children with the parent only when their deadline is the same (or absent). */
/**
 * Dia (no fuso de quem usa) de um prazo salvo. Prazos só com data ficam como
 * estão; prazos com horário viram a data local, para uma tarefa com prazo à
 * noite não cair no dia seguinte por causa do UTC.
 */
export function localDayOf(value?: string | null): string | undefined {
  if (!value) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function calendarTaskEntriesForDay(
  tasks: Task[],
  subtasksByTaskId: Map<string, Subtask[]>,
  day: string,
  showSubtasks: boolean,
): CalendarTaskEntry[] {
  const entries: CalendarTaskEntry[] = [];
  for (const task of tasks) {
    const parentDay = localDayOf(task.due_date);
    const children = showSubtasks ? (subtasksByTaskId.get(task.id) ?? []) : [];
    if (parentDay === day) {
      entries.push({
        kind: "task",
        task,
        subtasks: children.filter(
          (subtask) => !subtask.due_date || localDayOf(subtask.due_date) === day,
        ),
      });
    }
    for (const subtask of children) {
      if (localDayOf(subtask.due_date) === day && parentDay !== day) {
        entries.push({ kind: "subtask", task, subtask });
      }
    }
  }
  return entries;
}

/** Personal completed parts stay on their own calendar date without restoring the parent card. */
export function completedPersonalSubtaskEntriesForDay(
  completedParts: Array<{ subtask: Subtask; parent: Task }>,
  day: string,
): CalendarTaskEntry[] {
  return completedParts
    .filter(
      ({ subtask, parent }) =>
        localDayOf(subtask.due_date ?? subtask.completed_at ?? parent.due_date) === day,
    )
    .map(({ subtask, parent }) => ({ kind: "subtask" as const, task: parent, subtask }));
}
