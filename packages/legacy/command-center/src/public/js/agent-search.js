import { escapeHtml } from './helpers.js';

function buildSearchTokens(agent) {
  return `${agent.name ?? ''} ${agent.title ?? ''} ${agent.department ?? ''} ${agent.team ?? ''} ${agent.matrixId ?? ''}`.toLowerCase();
}

function filterAgents(agents, query, maxResults) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return agents.slice(0, maxResults);
  }

  const ranked = [];
  for (const agent of agents) {
    const haystack = buildSearchTokens(agent);
    if (!haystack.includes(normalized)) {
      continue;
    }

    let score = 3;
    if ((agent.matrixId ?? '').toLowerCase().startsWith(normalized)) {
      score = 0;
    } else if ((agent.name ?? '').toLowerCase().startsWith(normalized)) {
      score = 1;
    } else if ((agent.title ?? '').toLowerCase().includes(normalized)) {
      score = 2;
    }

    ranked.push({ score, agent });
  }

  ranked.sort((a, b) => {
    if (a.score !== b.score) {
      return a.score - b.score;
    }
    return String(a.agent.name ?? '').localeCompare(String(b.agent.name ?? ''));
  });

  return ranked.slice(0, maxResults).map((entry) => entry.agent);
}

export function attachAgentSearch({
  inputNode,
  resultsNode,
  agents,
  onSelect,
  maxResults = 8,
}) {
  if (!inputNode || !resultsNode) {
    return () => {};
  }

  let closed = false;

  const hide = () => {
    resultsNode.classList.add('hidden');
    resultsNode.innerHTML = '';
  };

  const pick = (matrixId) => {
    inputNode.value = matrixId;
    hide();
    onSelect?.(matrixId);
  };

  const renderMatches = () => {
    if (closed) {
      return;
    }

    const matches = filterAgents(Array.isArray(agents) ? agents : [], inputNode.value, maxResults);
    if (matches.length === 0) {
      hide();
      return;
    }

    resultsNode.innerHTML = matches
      .map((agent) => {
        return `
          <button type="button" class="assignee-result-item" data-matrix-id="${escapeHtml(agent.matrixId)}">
            <strong>${escapeHtml(agent.name)}</strong>
            <span>${escapeHtml(agent.title)} · ${escapeHtml(agent.department)}</span>
            <small>${escapeHtml(agent.matrixId)}</small>
          </button>
        `;
      })
      .join('');
    resultsNode.classList.remove('hidden');

    resultsNode.querySelectorAll('.assignee-result-item').forEach((button) => {
      button.addEventListener('click', () => {
        const matrixId = button.dataset.matrixId ?? '';
        if (!matrixId) {
          return;
        }
        pick(matrixId);
      });
    });
  };

  const handleInput = () => renderMatches();
  const handleFocus = () => renderMatches();
  const handleBlur = () => {
    // Allow click event on suggestion before closing.
    setTimeout(() => {
      if (!resultsNode.contains(document.activeElement)) {
        hide();
      }
    }, 80);
  };
  const handleDocumentClick = (event) => {
    if (event.target === inputNode || resultsNode.contains(event.target)) {
      return;
    }
    hide();
  };

  inputNode.addEventListener('input', handleInput);
  inputNode.addEventListener('focus', handleFocus);
  inputNode.addEventListener('blur', handleBlur);
  document.addEventListener('click', handleDocumentClick);

  return () => {
    closed = true;
    inputNode.removeEventListener('input', handleInput);
    inputNode.removeEventListener('focus', handleFocus);
    inputNode.removeEventListener('blur', handleBlur);
    document.removeEventListener('click', handleDocumentClick);
    hide();
  };
}
