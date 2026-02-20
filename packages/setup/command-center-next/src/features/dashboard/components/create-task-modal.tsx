"use client";

import { useEffect, useState } from "react";
import { PeopleSearchField } from "@/features/dashboard/components/people-search-field";
import { WorkItemTypeTabs } from "@/features/dashboard/components/work-item-type-tabs";
import type { DirectoryPerson, Task, TaskPriority, WorkItemType } from "@/lib/command-center/types";

interface CreateTaskPayload {
  title: string;
  description: string;
  workItemType: WorkItemType;
  deliverable: string;
  priority: TaskPriority;
  assigneeMatrixId: string | null;
  parentTaskId?: string | null;
}

interface CreateTaskModalProps {
  open: boolean;
  tasks: Task[];
  priorities: TaskPriority[];
  defaultParentTaskId?: string | null;
  seed?: number;
  onClose: () => void;
  onCreate: (payload: CreateTaskPayload) => Promise<void>;
  onSearchPeople: (query: string) => Promise<DirectoryPerson[]>;
}

function toParentLabel(task: Task): string {
  return `${task.title} (${task.id})`;
}

export function CreateTaskModal({
  open,
  tasks,
  priorities,
  defaultParentTaskId,
  seed = 0,
  onClose,
  onCreate,
  onSearchPeople,
}: CreateTaskModalProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [workItemType, setWorkItemType] = useState<WorkItemType>("task");
  const [deliverable, setDeliverable] = useState("");
  const [priority, setPriority] = useState<TaskPriority>("medium");
  const [assigneeQuery, setAssigneeQuery] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [parentTaskQuery, setParentTaskQuery] = useState("");
  const [selectedParentTaskId, setSelectedParentTaskId] = useState<string | null>(null);
  const [parentTaskResults, setParentTaskResults] = useState<Task[]>([]);
  const [parentTaskResultOpen, setParentTaskResultOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [statusText, setStatusText] = useState("");

  useEffect(() => {
    if (!open) {
      return;
    }

    const defaultParent = defaultParentTaskId ? tasks.find((task) => task.id === defaultParentTaskId) ?? null : null;
    const defaultAssignee = defaultParent?.assigneeMatrixId ?? null;

    setTitle("");
    setDescription("");
    setWorkItemType(defaultParent ? "story" : "task");
    setDeliverable("");
    setPriority("medium");
    setAssigneeQuery(defaultAssignee ?? "");
    setSelectedAssignee(defaultAssignee);
    setSelectedParentTaskId(defaultParent?.id ?? null);
    setParentTaskQuery(defaultParent ? toParentLabel(defaultParent) : "");
    setParentTaskResultOpen(false);
    setParentTaskResults([]);
    setStatusText(defaultParent ? `Child task mode: parent set to ${defaultParent.id}` : "");
  }, [open, seed, defaultParentTaskId]);

  useEffect(() => {
    if (!open) {
      return;
    }

    const query = parentTaskQuery.trim().toLowerCase();
    if (!query || query.length < 2) {
      setParentTaskResults([]);
      setParentTaskResultOpen(false);
      return;
    }

    const selectedParent = selectedParentTaskId ? tasks.find((task) => task.id === selectedParentTaskId) ?? null : null;
    if (selectedParent && parentTaskQuery === toParentLabel(selectedParent)) {
      setParentTaskResults([]);
      setParentTaskResultOpen(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      const matches = tasks
        .filter((task) => `${task.id} ${task.title} ${task.description}`.toLowerCase().includes(query))
        .slice(0, 10);
      setParentTaskResults(matches);
      setParentTaskResultOpen(matches.length > 0);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [open, parentTaskQuery, selectedParentTaskId, tasks]);

  if (!open) {
    return null;
  }

  function applyParentSelection(parentTask: Task): void {
    setSelectedParentTaskId(parentTask.id);
    setParentTaskQuery(toParentLabel(parentTask));
    setParentTaskResultOpen(false);
    if ((!selectedAssignee && !assigneeQuery.trim()) && parentTask.assigneeMatrixId) {
      setSelectedAssignee(parentTask.assigneeMatrixId);
      setAssigneeQuery(parentTask.assigneeMatrixId);
      setStatusText(`Linked parent ${parentTask.id}. Assignee pre-filled from parent.`);
      return;
    }
    setStatusText(`Linked parent: ${parentTask.id}`);
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    const trimmedTitle = title.trim();
    const trimmedDeliverable = deliverable.trim();
    if (!trimmedTitle || !trimmedDeliverable) {
      setStatusText("Title and deliverable are required.");
      return;
    }

    const directAssignee = assigneeQuery.trim().startsWith("@") ? assigneeQuery.trim() : null;
    const assigneeMatrixId = selectedAssignee ?? directAssignee;

    setSubmitting(true);
    setStatusText("Creating task...");
    try {
      await onCreate({
        title: trimmedTitle,
        description: description.trim(),
        workItemType,
        deliverable: trimmedDeliverable,
        priority,
        assigneeMatrixId,
        parentTaskId: selectedParentTaskId,
      });
      setStatusText("");
      onClose();
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to create task");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="cc-modal-backdrop" role="presentation" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="cc-modal cc-modal-sm" role="dialog" aria-modal="true" aria-label="Create task">
        <header className="cc-modal-header">
          <h3>{selectedParentTaskId ? "Create Child Task" : "Create Task"}</h3>
          <button type="button" onClick={onClose} className="cc-modal-close">
            Close
          </button>
        </header>

        <form className="cc-form" onSubmit={handleSubmit}>
          <label className="cc-field">
            <span>Title</span>
            <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" />
          </label>

          <div className="cc-field">
            <span>Task Type</span>
            <WorkItemTypeTabs value={workItemType} onChange={setWorkItemType} disabled={submitting} />
          </div>

          <label className="cc-field">
            <span>Description</span>
            <textarea
              rows={3}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="What should be done?"
            />
          </label>

          <label className="cc-field">
            <span>Deliverable</span>
            <input
              value={deliverable}
              onChange={(event) => setDeliverable(event.target.value)}
              placeholder="Required output"
            />
          </label>

          <label className="cc-field">
            <span>Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {(priorities.length ? priorities : ["low", "medium", "high", "urgent"]).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </label>

          <PeopleSearchField
            label="Assignee (optional)"
            value={assigneeQuery}
            selectedMatrixId={selectedAssignee}
            onValueChange={setAssigneeQuery}
            onSelectedMatrixIdChange={setSelectedAssignee}
            onSearchPeople={onSearchPeople}
            onStatus={setStatusText}
            disabled={submitting}
          />

          <label className="cc-field">
            <span>Parent Task (optional)</span>
            <div className="cc-inline-input">
              <input
                value={parentTaskQuery}
                onChange={(event) => {
                  setParentTaskQuery(event.target.value);
                  setSelectedParentTaskId(null);
                  setParentTaskResultOpen(false);
                }}
                placeholder="Search by id or title"
              />
            </div>
          </label>

          {parentTaskResultOpen ? (
            <div className="cc-search-results">
              {parentTaskResults.map((task) => (
                <button
                  key={task.id}
                  type="button"
                  className={selectedParentTaskId === task.id ? "cc-search-result is-selected" : "cc-search-result"}
                  onClick={() => applyParentSelection(task)}
                >
                  <strong>{task.title}</strong>
                  <span>
                    {task.workItemType} · {task.status}
                  </span>
                  <small>{task.id}</small>
                </button>
              ))}
            </div>
          ) : null}

          {selectedParentTaskId ? (
            <div className="cc-chip-list">
              <span className="cc-chip">Parent: {selectedParentTaskId}</span>
              <button
                type="button"
                className="cc-chip cc-chip-button cc-chip-danger"
                onClick={() => {
                  setSelectedParentTaskId(null);
                  setParentTaskQuery("");
                }}
              >
                Remove Link
              </button>
            </div>
          ) : null}

          <div className="cc-form-actions">
            <button type="button" className="cc-button is-secondary" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="cc-button" disabled={submitting}>
              {submitting ? "Creating..." : "Create Task"}
            </button>
          </div>

          {statusText ? <p className="cc-status-text">{statusText}</p> : null}
        </form>
      </div>
    </div>
  );
}
