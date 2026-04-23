"use client";

import { useEffect } from "react";
import { TaskDetails } from "@/features/dashboard/components/task-details";
import type { ActivityEvent, DirectoryPerson, Task, TaskPriority, TaskStatus, WorkItemType } from "@/lib/command-center/types";

interface TaskDetailsModalProps {
  open: boolean;
  task: Task | null;
  allTasks: Task[];
  parentTask: Task | null;
  childTasks: Task[];
  activity: ActivityEvent[];
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  onSaveTask: (taskId: string, payload: {
    status: string;
    workItemType: WorkItemType;
    priority: string;
    assigneeMatrixId: string | null;
    parentTaskId: string | null;
    deliverable: string;
    blockedReason: string | null;
    nextAction: string | null;
    blockerOwnerMatrixId: string | null;
    escalateToMatrixId: string | null;
  }) => Promise<void>;
  onAddComment: (taskId: string, message: string) => Promise<void>;
  onUploadAttachment: (taskId: string, file: File) => Promise<void>;
  onLinkAttachment: (taskId: string, sharedPath: string) => Promise<void>;
  onSearchPeople: (query: string) => Promise<DirectoryPerson[]>;
  onOpenTask: (taskId: string) => void;
  onCreateChildTask: (parentTask: Task) => void;
  onClose: () => void;
}

export function TaskDetailsModal({
  open,
  task,
  allTasks,
  parentTask,
  childTasks,
  activity,
  statuses,
  priorities,
  onSaveTask,
  onAddComment,
  onUploadAttachment,
  onLinkAttachment,
  onSearchPeople,
  onOpenTask,
  onCreateChildTask,
  onClose,
}: TaskDetailsModalProps) {
  useEffect(() => {
    if (!open) {
      return;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose]);

  if (!open) {
    return null;
  }

  return (
    <div
      className="cc-modal-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="cc-modal" role="dialog" aria-modal="true" aria-label="Task details">
        <header className="cc-modal-header">
          <h3>Task Details</h3>
          <button type="button" onClick={onClose} className="cc-modal-close">
            Close
          </button>
        </header>
        <TaskDetails
          task={task}
          allTasks={allTasks}
          parentTask={parentTask}
          childTasks={childTasks}
          activity={activity}
          statuses={statuses}
          priorities={priorities}
          onSaveTask={onSaveTask}
          onAddComment={onAddComment}
          onUploadAttachment={onUploadAttachment}
          onLinkAttachment={onLinkAttachment}
          onSearchPeople={onSearchPeople}
          onOpenTask={onOpenTask}
          onCreateChildTask={onCreateChildTask}
        />
      </div>
    </div>
  );
}
