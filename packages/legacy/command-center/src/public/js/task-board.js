export function createTaskBoard({
  boardNode,
  taskCardTemplate,
  statusLabels,
  formatTimestamp,
  onTaskSelect,
  onTaskMove,
}) {
  function normalizeTaskId(taskId) {
    if (taskId === null || taskId === undefined) {
      return '';
    }
    return String(taskId).trim();
  }

  const dragState = {
    taskId: null,
    fromStatus: null,
    inFlight: false,
  };

  function clearDropTargets() {
    boardNode.querySelectorAll('.column-list').forEach((column) => {
      column.classList.remove('drop-target');
    });
  }

  function resetDragState() {
    dragState.taskId = null;
    dragState.fromStatus = null;
    clearDropTargets();
  }

  function handleCardDragStart(event) {
    if (dragState.inFlight) {
      event.preventDefault();
      return;
    }

    const card = event.currentTarget;
    dragState.taskId = normalizeTaskId(card.dataset.taskId);
    dragState.fromStatus = card.dataset.taskStatus ?? null;

    if (event.dataTransfer && dragState.taskId) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData('text/plain', dragState.taskId);
    }

    card.classList.add('dragging');
  }

  function handleCardDragEnd(event) {
    const card = event.currentTarget;
    card.classList.remove('dragging');
    resetDragState();
  }

  function handleColumnDragOver(event) {
    if (!dragState.taskId || dragState.inFlight) {
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = 'move';
    }
  }

  function handleColumnDragEnter(event) {
    if (!dragState.taskId || dragState.inFlight) {
      return;
    }
    event.preventDefault();
    event.currentTarget.classList.add('drop-target');
  }

  function handleColumnDragLeave(event) {
    const column = event.currentTarget;
    const related = event.relatedTarget;
    if (related instanceof Node && column.contains(related)) {
      return;
    }
    if (column.classList.contains('column-list')) {
      column.classList.remove('drop-target');
      return;
    }

    const list = column.querySelector('.column-list');
    list?.classList.remove('drop-target');
  }

  async function handleColumnDrop(event) {
    event.preventDefault();

    if (dragState.inFlight) {
      return;
    }

    const column = event.currentTarget;
    if (column.classList.contains('column-list')) {
      column.classList.remove('drop-target');
    } else {
      const list = column.querySelector('.column-list');
      list?.classList.remove('drop-target');
    }

    const nextStatus = column.dataset.status ?? column.closest('.column')?.dataset.status ?? '';
    const taskId = normalizeTaskId(dragState.taskId || (event.dataTransfer ? event.dataTransfer.getData('text/plain') : ''));
    const fromStatus = dragState.fromStatus;
    resetDragState();

    if (!taskId || !nextStatus || nextStatus === fromStatus) {
      return;
    }

    try {
      dragState.inFlight = true;
      await onTaskMove(taskId, nextStatus);
    } finally {
      dragState.inFlight = false;
    }
  }

  function highlightSelected(selectedTaskId) {
    const normalizedSelectedTaskId = normalizeTaskId(selectedTaskId);
    boardNode.querySelectorAll('.task-card').forEach((card) => {
      card.classList.toggle('selected', normalizeTaskId(card.dataset.taskId) === normalizedSelectedTaskId);
    });
  }

  function render(statuses, tasks, selectedTaskId) {
    const normalizedSelectedTaskId = normalizeTaskId(selectedTaskId);
    boardNode.innerHTML = '';

    for (const status of statuses) {
      const columnTasks = tasks.filter((task) => task.status === status);

      const column = document.createElement('section');
      column.className = 'column';
      column.dataset.status = status;
      column.innerHTML = `
        <header>
          <h3>${statusLabels[status] ?? status}</h3>
          <span>${columnTasks.length}</span>
        </header>
        <div class="column-list" data-status="${status}"></div>
      `;

      column.addEventListener('dragover', handleColumnDragOver);
      column.addEventListener('dragenter', handleColumnDragEnter);
      column.addEventListener('dragleave', handleColumnDragLeave);
      column.addEventListener('drop', handleColumnDrop);

      const columnList = column.querySelector('.column-list');
      columnList.addEventListener('dragover', handleColumnDragOver);
      columnList.addEventListener('dragenter', handleColumnDragEnter);
      columnList.addEventListener('dragleave', handleColumnDragLeave);
      columnList.addEventListener('drop', handleColumnDrop);

      for (const task of columnTasks) {
        const taskId = normalizeTaskId(task.id);
        const fragment = taskCardTemplate.content.cloneNode(true);
        const card = fragment.querySelector('.task-card');
        const title = fragment.querySelector('h4');
        const priority = fragment.querySelector('.priority');
        const description = fragment.querySelector('.task-desc');
        const deliverable = fragment.querySelector('.task-deliverable');
        const meta = fragment.querySelector('.task-meta');

        card.dataset.taskId = taskId;
        card.dataset.taskStatus = task.status;
        card.draggable = true;
        card.tabIndex = 0;
        if (taskId === normalizedSelectedTaskId) {
          card.classList.add('selected');
        }

        title.textContent = task.title;
        priority.textContent = task.priority;
        priority.classList.add(`priority-${task.priority}`);
        description.textContent = task.description || 'No description provided.';
        deliverable.textContent = `Deliverable: ${task.deliverable || 'Missing'}`;
        meta.textContent = `${task.assigneeMatrixId ?? 'Unassigned'} · ${formatTimestamp(task.updatedAt)}`;

        card.addEventListener('pointerdown', () => onTaskSelect(taskId));
        card.addEventListener('click', () => onTaskSelect(taskId));
        card.addEventListener('pointerup', () => onTaskSelect(taskId));
        card.addEventListener('mousedown', (event) => {
          if (event.button === 0) {
            onTaskSelect(taskId);
          }
        });
        card.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            onTaskSelect(taskId);
          }
        });
        card.addEventListener('dragstart', handleCardDragStart);
        card.addEventListener('dragend', handleCardDragEnd);

        columnList.appendChild(fragment);
      }

      boardNode.appendChild(column);
    }
  }

  return {
    render,
    highlightSelected,
  };
}
