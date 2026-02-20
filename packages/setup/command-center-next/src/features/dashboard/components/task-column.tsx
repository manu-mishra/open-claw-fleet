import type { DragEvent } from "react";
import type { Task, TaskStatus } from "@/lib/command-center/types";
import { formatTimestamp } from "@/lib/utils/time";

const STATUS_LABELS: Record<string, string> = {
  inbox: "Inbox",
  assigned: "Assigned",
  in_progress: "In Progress",
  review: "Review",
  done: "Done",
  blocked: "Blocked",
};

interface TaskColumnProps {
  status: TaskStatus;
  tasks: Task[];
  childCountByParentId: Record<string, number>;
  selectedTaskId: string | null;
  onSelect: (taskId: string) => void;
  onMove: (taskId: string, nextStatus: string) => void | Promise<void>;
}

function handleDragEnter(event: DragEvent<HTMLDivElement>) {
  event.currentTarget.classList.add("is-drop-target");
}

function handleDragLeave(event: DragEvent<HTMLDivElement>) {
  event.currentTarget.classList.remove("is-drop-target");
}

function compactMatrixId(matrixId: string | null): string {
  if (!matrixId) {
    return "Unassigned";
  }
  const [localPart] = matrixId.split(":");
  return localPart.startsWith("@") ? localPart.slice(1) : localPart;
}

export function TaskColumn({ status, tasks, childCountByParentId, selectedTaskId, onSelect, onMove }: TaskColumnProps) {
  const statusKey = String(status);
  const nextStatus = statusKey;

  return (
    <section className={`cc-task-column cc-task-column--${statusKey}`}>
      <header>
        <h3>{STATUS_LABELS[String(status)] ?? status}</h3>
        <span className="cc-column-count">{tasks.length}</span>
      </header>

      <div
        className="cc-task-column-list"
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={(event) => {
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = "move";
          }
        }}
        onDrop={async (event) => {
          event.preventDefault();
          event.currentTarget.classList.remove("is-drop-target");

          const taskId =
            event.dataTransfer.getData("application/x-task-id").trim() || event.dataTransfer.getData("text/plain").trim();
          const fromStatus = event.dataTransfer.getData("application/x-task-status").trim();
          if (!taskId || !nextStatus || fromStatus === nextStatus) {
            return;
          }

          await onMove(taskId, nextStatus);
        }}
      >
        {tasks.map((task) => {
          const active = selectedTaskId === task.id;
          const priorityClass = `cc-task-priority cc-task-priority--${String(task.priority).toLowerCase()}`;
          const childCount = childCountByParentId[task.id] ?? 0;
          return (
            <button
              key={task.id}
              type="button"
              draggable
              onClick={() => onSelect(task.id)}
              onDragStart={(event) => {
                if (event.dataTransfer) {
                  event.dataTransfer.effectAllowed = "move";
                  event.dataTransfer.setData("application/x-task-id", task.id);
                  event.dataTransfer.setData("application/x-task-status", String(task.status));
                  event.dataTransfer.setData("text/plain", task.id);
                }
                event.currentTarget.classList.add("is-dragging");
              }}
              onDragEnd={(event) => {
                event.currentTarget.classList.remove("is-dragging");
              }}
              className={active ? "cc-task-card is-active" : "cc-task-card"}
            >
              <div className="cc-task-card-title">
                <h4>{task.title}</h4>
                <span className={priorityClass}>{task.priority}</span>
              </div>
              <div className="cc-task-card-tags">
                <span className="cc-chip">{task.workItemType}</span>
                {task.department ? <span className="cc-chip">{task.department}</span> : null}
                {task.parentTaskId ? <span className="cc-chip">child</span> : null}
                {childCount > 0 ? <span className="cc-chip">children {childCount}</span> : null}
              </div>
              <p className="cc-task-card-deliverable">{task.deliverable || "No deliverable defined"}</p>
              <small>
                {compactMatrixId(task.assigneeMatrixId)} · {formatTimestamp(task.updatedAt)}
              </small>
            </button>
          );
        })}
      </div>
    </section>
  );
}
