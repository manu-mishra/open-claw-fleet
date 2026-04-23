"use client";

import { useEffect, useMemo, useState } from "react";
import { StatusBadge } from "@/components/ui/status-badge";
import { PeopleSearchField } from "@/features/dashboard/components/people-search-field";
import { WorkItemTypeTabs } from "@/features/dashboard/components/work-item-type-tabs";
import type {
  ActivityEvent,
  DirectoryPerson,
  Task,
  TaskPriority,
  TaskStatus,
  WorkItemType,
} from "@/lib/command-center/types";
import { formatTimestamp } from "@/lib/utils/time";

interface TaskDetailsProps {
  task: Task | null;
  allTasks: Task[];
  activity: ActivityEvent[];
  parentTask: Task | null;
  childTasks: Task[];
  statuses: TaskStatus[];
  priorities: TaskPriority[];
  onSaveTask: (
    taskId: string,
    payload: {
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
    },
  ) => Promise<void>;
  onAddComment: (taskId: string, message: string) => Promise<void>;
  onUploadAttachment: (taskId: string, file: File) => Promise<void>;
  onLinkAttachment: (taskId: string, sharedPath: string) => Promise<void>;
  onSearchPeople: (query: string) => Promise<DirectoryPerson[]>;
  onOpenTask: (taskId: string) => void;
  onCreateChildTask: (parentTask: Task) => void;
}

function isMatrixId(value: string): boolean {
  return value.trim().startsWith("@");
}

function ownerChain(task: Task): string {
  const entries = [task.vp, task.director, task.manager].filter((entry) => entry && entry !== "Unknown");
  return entries.length ? entries.join(" / ") : "Not set";
}

function taskLabel(task: Task): string {
  return `${task.workItemType.toUpperCase()} · ${task.title}`;
}

function canLinkAsParent(allTasks: Task[], taskId: string, parentCandidateId: string): boolean {
  if (taskId === parentCandidateId) {
    return false;
  }

  const byId = new Map(allTasks.map((entry) => [entry.id, entry]));
  let cursor = byId.get(parentCandidateId) ?? null;
  const visited = new Set<string>();

  while (cursor) {
    if (cursor.id === taskId) {
      return false;
    }

    if (!cursor.parentTaskId || visited.has(cursor.parentTaskId)) {
      return true;
    }

    visited.add(cursor.parentTaskId);
    cursor = byId.get(cursor.parentTaskId) ?? null;
  }

  return true;
}

export function TaskDetails({
  task,
  allTasks,
  activity,
  parentTask,
  childTasks,
  statuses,
  priorities,
  onSaveTask,
  onAddComment,
  onUploadAttachment,
  onLinkAttachment,
  onSearchPeople,
  onOpenTask,
  onCreateChildTask,
}: TaskDetailsProps) {
  const [status, setStatus] = useState<string>("inbox");
  const [workItemType, setWorkItemType] = useState<WorkItemType>("task");
  const [priority, setPriority] = useState<string>("medium");
  const [deliverable, setDeliverable] = useState("");
  const [blockedReason, setBlockedReason] = useState("");
  const [nextAction, setNextAction] = useState("");
  const [blockerOwnerMatrixId, setBlockerOwnerMatrixId] = useState("");
  const [escalateToMatrixId, setEscalateToMatrixId] = useState("");
  const [assigneeInput, setAssigneeInput] = useState("");
  const [selectedAssignee, setSelectedAssignee] = useState<string | null>(null);
  const [parentQuery, setParentQuery] = useState("");
  const [selectedParentTaskId, setSelectedParentTaskId] = useState<string | null>(null);
  const [parentSearchResults, setParentSearchResults] = useState<Task[]>([]);
  const [parentResultsOpen, setParentResultsOpen] = useState(false);
  const [commentMessage, setCommentMessage] = useState("");
  const [sharedLinkPath, setSharedLinkPath] = useState("");
  const [statusText, setStatusText] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingComment, setSendingComment] = useState(false);
  const [uploadingAttachment, setUploadingAttachment] = useState(false);

  const tasksById = useMemo(() => new Map(allTasks.map((entry) => [entry.id, entry])), [allTasks]);

  useEffect(() => {
    if (!task) {
      return;
    }

    const resolvedParent = task.parentTaskId ? tasksById.get(task.parentTaskId) ?? null : null;

    setStatus(task.status);
    setWorkItemType(task.workItemType);
    setPriority(task.priority);
    setDeliverable(task.deliverable ?? "");
    setBlockedReason(task.blockedReason ?? "");
    setNextAction(task.nextAction ?? "");
    setBlockerOwnerMatrixId(task.blockerOwnerMatrixId ?? "");
    setEscalateToMatrixId(task.escalateToMatrixId ?? "");
    setAssigneeInput(task.assigneeMatrixId ?? "");
    setSelectedAssignee(task.assigneeMatrixId ?? null);
    setSelectedParentTaskId(task.parentTaskId ?? null);
    setParentQuery(resolvedParent ? `${resolvedParent.title} (${resolvedParent.id})` : "");
    setParentSearchResults([]);
    setParentResultsOpen(false);
    setCommentMessage("");
    setSharedLinkPath("");
    setStatusText("");
  }, [task, tasksById]);

  useEffect(() => {
    if (!task) {
      return;
    }

    const query = parentQuery.trim().toLowerCase();
    if (!query || query.length < 2) {
      setParentSearchResults([]);
      setParentResultsOpen(false);
      return;
    }

    const selectedParent = selectedParentTaskId ? tasksById.get(selectedParentTaskId) ?? null : null;
    if (selectedParent && parentQuery === `${selectedParent.title} (${selectedParent.id})`) {
      setParentSearchResults([]);
      setParentResultsOpen(false);
      return;
    }

    const timeout = window.setTimeout(() => {
      const matches = allTasks
        .filter((candidate) => {
          if (candidate.id === task.id) {
            return false;
          }

          if (!canLinkAsParent(allTasks, task.id, candidate.id)) {
            return false;
          }

          const searchable = `${candidate.id} ${candidate.title} ${candidate.description}`.toLowerCase();
          return searchable.includes(query);
        })
        .slice(0, 12);

      setParentSearchResults(matches);
      setParentResultsOpen(matches.length > 0);
    }, 220);

    return () => window.clearTimeout(timeout);
  }, [task, parentQuery, selectedParentTaskId, allTasks, tasksById]);

  if (!task) {
    return <p className="cc-empty-copy">Select a task card to inspect details.</p>;
  }
  const taskId = task.id;

  const taskActivity = activity.filter((entry) => entry.taskId === task.id);
  const taskComments = task.comments.map((comment) => ({
    id: comment.id,
    actorMatrixId: comment.authorMatrixId,
    message: comment.message,
    createdAt: comment.createdAt,
  }));

  const runningLog = [...taskActivity, ...taskComments].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  async function handleSaveTask(): Promise<void> {
    const trimmedDeliverable = deliverable.trim();
    if (!trimmedDeliverable) {
      setStatusText("Deliverable is required.");
      return;
    }
    if (status === "blocked") {
      if (!blockedReason.trim()) {
        setStatusText("Blocked reason is required when status is blocked.");
        return;
      }
      if (!nextAction.trim()) {
        setStatusText("Next action is required when status is blocked.");
        return;
      }
    }

    const directAssignee = isMatrixId(assigneeInput) ? assigneeInput.trim() : null;
    const assigneeMatrixId = selectedAssignee ?? directAssignee;

    setSaving(true);
    setStatusText("Saving task...");
    try {
      await onSaveTask(taskId, {
        status,
        workItemType,
        priority,
        assigneeMatrixId,
        parentTaskId: selectedParentTaskId,
        deliverable: trimmedDeliverable,
        blockedReason: blockedReason.trim() || null,
        nextAction: nextAction.trim() || null,
        blockerOwnerMatrixId: blockerOwnerMatrixId.trim() || null,
        escalateToMatrixId: escalateToMatrixId.trim() || null,
      });
      setStatusText("Task updated.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to update task");
    } finally {
      setSaving(false);
    }
  }

  async function handleAddComment(): Promise<void> {
    const message = commentMessage.trim();
    if (!message) {
      setStatusText("Comment message is required.");
      return;
    }

    setSendingComment(true);
    setStatusText("Posting comment...");
    try {
      await onAddComment(taskId, message);
      setCommentMessage("");
      setStatusText("Comment posted.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to add comment");
    } finally {
      setSendingComment(false);
    }
  }

  async function handleUploadAttachment(file: File): Promise<void> {
    if (!file) {
      return;
    }
    setUploadingAttachment(true);
    setStatusText(`Uploading ${file.name}...`);
    try {
      await onUploadAttachment(taskId, file);
      setStatusText(`Attached file: ${file.name}`);
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to upload attachment");
    } finally {
      setUploadingAttachment(false);
    }
  }

  async function handleLinkAttachment(): Promise<void> {
    const trimmed = sharedLinkPath.trim();
    if (!trimmed) {
      setStatusText("Shared file path is required.");
      return;
    }
    setUploadingAttachment(true);
    setStatusText("Linking shared file...");
    try {
      await onLinkAttachment(taskId, trimmed);
      setSharedLinkPath("");
      setStatusText("Linked shared file to task.");
    } catch (error) {
      setStatusText(error instanceof Error ? error.message : "Failed to link shared file");
    } finally {
      setUploadingAttachment(false);
    }
  }

  const attachments = [...(task.attachments ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  return (
    <div className="cc-task-detail-layout">
      <div className="cc-task-detail">
        <header className="cc-task-detail-header">
          <h3>{task.title}</h3>
          <StatusBadge value={task.status} tone={task.status === "blocked" ? "alert" : "neutral"} />
        </header>

        <p>{task.description || "No description provided."}</p>

        <section className="cc-deliverable">
          <h4>Deliverable</h4>
          <p>{task.deliverable || "Missing deliverable."}</p>
          {task.blockedReason ? (
            <p>
              <strong>Blocked Reason:</strong> {task.blockedReason}
            </p>
          ) : null}
          {task.nextAction ? (
            <p>
              <strong>Next Action:</strong> {task.nextAction}
            </p>
          ) : null}
        </section>

        <div className="cc-meta-grid">
          <span>
            <strong>ID:</strong> {task.id}
          </span>
          <span>
            <strong>Type:</strong> {task.workItemType}
          </span>
          <span>
            <strong>Team:</strong> {task.team ?? "Unknown"}
          </span>
          <span>
            <strong>Department:</strong> {task.department}
          </span>
          <span>
            <strong>Owner Chain:</strong> {ownerChain(task)}
          </span>
          <span>
            <strong>Creator:</strong> {task.creatorMatrixId}
          </span>
          <span>
            <strong>Owner:</strong> {task.ownerName ?? task.ownerMatrixId ?? "Unknown"}
          </span>
          <span>
            <strong>Assignee:</strong> {task.assigneeMatrixId ?? "Unassigned"}
          </span>
          <span>
            <strong>Children:</strong> {childTasks.length}
          </span>
          <span>
            <strong>Thread Room:</strong> {task.matrixRoomId ?? "Not set"}
          </span>
          <span>
            <strong>Thread Root:</strong> {task.matrixThreadRootEventId ?? "Not set"}
          </span>
          <span>
            <strong>Updated:</strong> {formatTimestamp(task.updatedAt)}
          </span>
        </div>

        <section className="cc-task-edit">
          <div className="cc-task-edit-header">
            <h4>Update Task</h4>
            <button type="button" className="cc-button is-secondary" onClick={() => onCreateChildTask(task)}>
              Create Child Task
            </button>
          </div>
          <div className="cc-field">
            <span>Status</span>
            <select value={status} onChange={(event) => setStatus(event.target.value)}>
              {(statuses.length ? statuses : ["inbox", "assigned", "in_progress", "review", "done", "blocked"]).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          <div className="cc-field">
            <span>Task Type</span>
            <WorkItemTypeTabs value={workItemType} onChange={setWorkItemType} disabled={saving} />
          </div>

          <div className="cc-field">
            <span>Priority</span>
            <select value={priority} onChange={(event) => setPriority(event.target.value)}>
              {(priorities.length ? priorities : ["low", "medium", "high", "urgent"]).map((entry) => (
                <option key={entry} value={entry}>
                  {entry}
                </option>
              ))}
            </select>
          </div>

          <PeopleSearchField
            label="Assignee"
            value={assigneeInput}
            selectedMatrixId={selectedAssignee}
            onValueChange={setAssigneeInput}
            onSelectedMatrixIdChange={setSelectedAssignee}
            onSearchPeople={onSearchPeople}
            onStatus={setStatusText}
            disabled={saving}
          />

          <div className="cc-field">
            <span>Parent Task</span>
            <div className="cc-inline-input">
              <input
                value={parentQuery}
                onChange={(event) => {
                  setParentQuery(event.target.value);
                  setSelectedParentTaskId(null);
                  setParentResultsOpen(false);
                }}
                placeholder="Search task by title or id"
              />
            </div>
          </div>

          {parentResultsOpen ? (
            <div className="cc-search-results">
              {parentSearchResults.map((candidate) => (
                <button
                  key={candidate.id}
                  type="button"
                  className={selectedParentTaskId === candidate.id ? "cc-search-result is-selected" : "cc-search-result"}
                  onClick={() => {
                    setSelectedParentTaskId(candidate.id);
                    setParentQuery(`${candidate.title} (${candidate.id})`);
                    setParentResultsOpen(false);
                    setStatusText(`Linked parent: ${candidate.id}`);
                  }}
                >
                  <strong>{candidate.title}</strong>
                  <span>
                    {candidate.workItemType} · {candidate.status}
                  </span>
                  <small>{candidate.id}</small>
                </button>
              ))}
            </div>
          ) : null}

          {selectedParentTaskId ? (
            <div className="cc-chip-list">
              <button
                type="button"
                className="cc-chip cc-chip-button"
                onClick={() => onOpenTask(selectedParentTaskId)}
                title="Open linked parent"
              >
                Parent: {selectedParentTaskId}
              </button>
              <button
                type="button"
                className="cc-chip cc-chip-button cc-chip-danger"
                onClick={() => {
                  setSelectedParentTaskId(null);
                  setParentQuery("");
                }}
              >
                Remove Link
              </button>
            </div>
          ) : null}

          <div className="cc-field">
            <span>Deliverable</span>
            <input value={deliverable} onChange={(event) => setDeliverable(event.target.value)} placeholder="Expected output" />
          </div>

          <div className="cc-field">
            <span>Blocked Reason</span>
            <textarea
              rows={2}
              value={blockedReason}
              onChange={(event) => setBlockedReason(event.target.value)}
              placeholder={status === "blocked" ? "Required while blocked" : "Optional (used when blocked)"}
            />
          </div>

          <div className="cc-field">
            <span>Next Action</span>
            <input
              value={nextAction}
              onChange={(event) => setNextAction(event.target.value)}
              placeholder={status === "blocked" ? "Required next step to unblock" : "Optional"}
            />
          </div>

          <div className="cc-field">
            <span>Blocker Owner</span>
            <input
              value={blockerOwnerMatrixId}
              onChange={(event) => setBlockerOwnerMatrixId(event.target.value)}
              placeholder="@owner:anycompany.corp"
            />
          </div>

          <div className="cc-field">
            <span>Escalate To</span>
            <input
              value={escalateToMatrixId}
              onChange={(event) => setEscalateToMatrixId(event.target.value)}
              placeholder="@vp.or.director:anycompany.corp"
            />
          </div>

          <div className="cc-form-actions">
            <button type="button" className="cc-button" disabled={saving} onClick={handleSaveTask}>
              {saving ? "Saving..." : "Save Task"}
            </button>
          </div>
        </section>

        <section className="cc-linked-work">
          <h4>Linked Work</h4>
          {parentTask ? (
            <button type="button" className="cc-linked-item" onClick={() => onOpenTask(parentTask.id)}>
              <strong>Parent</strong>
              <span>{taskLabel(parentTask)}</span>
              <small>{parentTask.id}</small>
            </button>
          ) : (
            <p className="cc-empty-copy">No parent task.</p>
          )}

          {childTasks.length ? (
            <div className="cc-linked-grid">
              {childTasks.map((child) => (
                <button key={child.id} type="button" className="cc-linked-item" onClick={() => onOpenTask(child.id)}>
                  <strong>{child.workItemType}</strong>
                  <span>{child.title}</span>
                  <small>{child.id}</small>
                </button>
              ))}
            </div>
          ) : (
            <p className="cc-empty-copy">No child tasks.</p>
          )}
        </section>

        <section className="cc-log">
          <h4>Attachments</h4>
          <div className="cc-field">
            <span>Upload File</span>
            <input
              type="file"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) {
                  void handleUploadAttachment(file);
                }
                event.currentTarget.value = "";
              }}
              disabled={uploadingAttachment}
            />
          </div>

          <div className="cc-field">
            <span>Link Shared Path</span>
            <div className="cc-inline-input">
              <input
                value={sharedLinkPath}
                onChange={(event) => setSharedLinkPath(event.target.value)}
                placeholder="shared/path/to/file.pdf"
                disabled={uploadingAttachment}
              />
              <button type="button" className="cc-button is-secondary" onClick={handleLinkAttachment} disabled={uploadingAttachment}>
                Link
              </button>
            </div>
          </div>

          {attachments.length ? (
            <div className="cc-list">
              {attachments.map((attachment) => {
                const base = `/api/command-center/tasks/${encodeURIComponent(task.id)}/attachments/${encodeURIComponent(attachment.id)}`;
                return (
                  <article key={attachment.id} className="cc-list-item">
                    <div>
                      <p>{attachment.fileName}</p>
                      <small>
                        {attachment.contentType} · {attachment.sizeBytes} bytes · {attachment.sourceKind}
                      </small>
                    </div>
                    <div className="cc-inline-actions">
                      <a className="cc-button is-secondary" href={`${base}?inline=1`} target="_blank" rel="noreferrer">
                        View
                      </a>
                      <a className="cc-button is-secondary" href={base} target="_blank" rel="noreferrer">
                        Download
                      </a>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="cc-empty-copy">No attachments yet.</p>
          )}
        </section>

        <section className="cc-log">
          <h4>Add Comment</h4>
          <textarea
            rows={3}
            value={commentMessage}
            onChange={(event) => setCommentMessage(event.target.value)}
            placeholder="Share progress, blockers, or notes"
          />
          <div className="cc-form-actions">
            <button type="button" className="cc-button" disabled={sendingComment} onClick={handleAddComment}>
              {sendingComment ? "Posting..." : "Post Comment"}
            </button>
          </div>
        </section>

        <section className="cc-log">
          <h4>Running Log</h4>
          {runningLog.length ? (
            runningLog.map((entry) => (
              <article key={entry.id} className="cc-log-item">
                <strong>{entry.actorMatrixId}</strong>
                <p>{entry.message}</p>
                <time>{formatTimestamp(entry.createdAt)}</time>
              </article>
            ))
          ) : (
            <p className="cc-empty-copy">No updates yet.</p>
          )}
        </section>

        {statusText ? <p className="cc-status-text">{statusText}</p> : null}
      </div>

      <aside className="cc-task-map" aria-label="Task relationship map">
        <h4>Task Map</h4>
        <div className="cc-task-map-tree">
          <div className="cc-task-map-level">
            <span className="cc-task-map-label">Parent</span>
            {parentTask ? (
              <button type="button" className="cc-map-node" onClick={() => onOpenTask(parentTask.id)}>
                <strong>{parentTask.workItemType.toUpperCase()}</strong>
                <span>{parentTask.title}</span>
                <small>{parentTask.id}</small>
              </button>
            ) : (
              <div className="cc-map-empty">No parent</div>
            )}
          </div>

          <div className="cc-task-map-connector" aria-hidden="true" />

          <div className="cc-task-map-level">
            <span className="cc-task-map-label">Current</span>
            <div className="cc-map-node is-current">
              <strong>{task.workItemType.toUpperCase()}</strong>
              <span>{task.title}</span>
              <small>{task.id}</small>
            </div>
          </div>

          <div className="cc-task-map-connector" aria-hidden="true" />

          <div className="cc-task-map-level">
            <span className="cc-task-map-label">Children ({childTasks.length})</span>
            {childTasks.length ? (
              <div className="cc-map-children">
                {childTasks.map((child) => (
                  <button key={child.id} type="button" className="cc-map-node is-child" onClick={() => onOpenTask(child.id)}>
                    <strong>{child.workItemType.toUpperCase()}</strong>
                    <span>{child.title}</span>
                    <small>{child.id}</small>
                  </button>
                ))}
              </div>
            ) : (
              <div className="cc-map-empty">No child tasks</div>
            )}
          </div>
        </div>
      </aside>
    </div>
  );
}
