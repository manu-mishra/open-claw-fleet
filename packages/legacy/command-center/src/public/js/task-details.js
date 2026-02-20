export function renderTaskDetails({
  selectedTaskNode,
  commentForm,
  task,
  priorities,
  statuses,
  statusLabels,
  activityEvents,
  formatTimestamp,
  escapeHtml,
  onSave,
  wireAssigneeSearch,
}) {
  if (!task) {
    selectedTaskNode.classList.add('empty');
    selectedTaskNode.textContent = 'Select a task card to inspect comments and update details.';
    commentForm.classList.add('hidden');
    return;
  }

  selectedTaskNode.classList.remove('empty');

  const commentsHtml = task.comments
    .slice()
    .reverse()
    .map((comment) => {
      return `
        <article class="comment-item">
          <strong>${escapeHtml(comment.authorMatrixId)}</strong>
          <p>${escapeHtml(comment.message)}</p>
          <time>${formatTimestamp(comment.createdAt)}</time>
        </article>
      `;
    })
    .join('');

  const taskActivityItems = (activityEvents ?? [])
    .filter((event) => event.taskId === task.id)
    .map((event) => ({
      actor: event.actorMatrixId ?? 'system',
      message: event.message ?? 'Task updated',
      createdAt: event.createdAt ?? task.updatedAt,
    }));

  const taskCommentItems = task.comments.map((comment) => ({
    actor: comment.authorMatrixId,
    message: comment.message,
    createdAt: comment.createdAt,
  }));

  const runningLogHtml = [...taskActivityItems, ...taskCommentItems]
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((entry) => {
      return `
        <article class="activity-item">
          <strong>${escapeHtml(entry.actor)}</strong>
          <p>${escapeHtml(entry.message)}</p>
          <time>${formatTimestamp(entry.createdAt)}</time>
        </article>
      `;
    })
    .join('');

  selectedTaskNode.innerHTML = `
    <h3>${escapeHtml(task.title)}</h3>
    <p>${escapeHtml(task.description || 'No description provided.')}</p>
    <div class="task-meta-grid">
      <span><strong>ID:</strong> ${escapeHtml(task.id)}</span>
      <span><strong>Created:</strong> ${escapeHtml(formatTimestamp(task.createdAt))}</span>
      <span><strong>Updated:</strong> ${escapeHtml(formatTimestamp(task.updatedAt))}</span>
    </div>
    <div class="row">
      <label>Status</label>
      <select id="selectedStatus">
        ${statuses
          .map((status) => `<option value="${status}" ${status === task.status ? 'selected' : ''}>${statusLabels[status] ?? status}</option>`)
          .join('')}
      </select>
    </div>
    <div class="row">
      <label>Priority</label>
      <select id="selectedPriority">
        ${priorities
          .map((priority) => `<option value="${priority}" ${priority === task.priority ? 'selected' : ''}>${priority}</option>`)
          .join('')}
      </select>
    </div>
    <div class="row align-start">
      <label>Assignee</label>
      <div class="assignee-field">
        <input id="selectedAssignee" type="text" value="${escapeHtml(task.assigneeMatrixId ?? '')}" placeholder="Search by name, title, or Matrix ID" list="agentSuggestions" autocomplete="off" />
        <div id="selectedAssigneeResults" class="assignee-results hidden"></div>
      </div>
    </div>
    <div class="row">
      <label>Deliverable</label>
      <input id="selectedDeliverable" type="text" value="${escapeHtml(task.deliverable ?? '')}" placeholder="Expected output" />
    </div>
    <button id="saveTaskButton" type="button">Save Task</button>
    <section>
      <h3>Comments (${task.comments.length})</h3>
      <div>${commentsHtml || '<p class="task-desc">No comments yet.</p>'}</div>
    </section>
    <section>
      <h3>Running Log</h3>
      <div>${runningLogHtml || '<p class="task-desc">No log entries yet.</p>'}</div>
    </section>
  `;

  const selectedAssignee = document.getElementById('selectedAssignee');
  const selectedAssigneeResults = document.getElementById('selectedAssigneeResults');
  wireAssigneeSearch?.(selectedAssignee, selectedAssigneeResults);

  const saveTaskButton = document.getElementById('saveTaskButton');
  saveTaskButton.addEventListener('click', async () => {
    const deliverable = document.getElementById('selectedDeliverable').value.trim();
    if (!deliverable) {
      alert('Deliverable is required.');
      return;
    }

    const payload = {
      status: document.getElementById('selectedStatus').value,
      priority: document.getElementById('selectedPriority').value,
      assigneeMatrixId: document.getElementById('selectedAssignee').value.trim() || null,
      deliverable,
    };

    try {
      saveTaskButton.disabled = true;
      await onSave(payload);
    } finally {
      saveTaskButton.disabled = false;
    }
  });

  commentForm.classList.remove('hidden');
}
