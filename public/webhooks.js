const refreshBtn = document.getElementById('refresh-webhooks');
const statusEl = document.getElementById('webhook-status');
const updatedEl = document.getElementById('webhook-updated');
const autoRefreshToggle = document.getElementById('webhook-auto-refresh');
const summaryEl = document.getElementById('webhook-summary');
const settingsEl = document.getElementById('webhook-settings');
const statsEl = document.getElementById('webhook-stats');
const activeEl = document.getElementById('webhook-active');
const pendingEl = document.getElementById('webhook-pending');
const historyEl = document.getElementById('webhook-history');
const errorLogEl = document.getElementById('error-log');

const AUTO_REFRESH_INTERVAL = 15000;
let autoRefreshTimer = null;

const setStatus = (text, isError = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
};

const formatPrimitive = (value) => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch (error) {
    return String(value);
  }
};

const summaryLabel = (key, value) => {
  if (Array.isArray(value)) {
    return `${key} [${value.length}]`;
  }
  return key;
};

const renderNode = (key, value, level = 0) => {
  const wrapper = document.createElement('div');
  wrapper.className = 'node';

  if (value && typeof value === 'object') {
    const details = document.createElement('details');
    if (level < 1) {
      details.open = true;
    }
    const summary = document.createElement('summary');
    summary.textContent = summaryLabel(key, value);
    details.appendChild(summary);

    const entries = Array.isArray(value)
      ? Array.from(value.entries())
      : Object.entries(value);

    if (entries.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'leaf';
      empty.textContent = '(порожньо)';
      details.appendChild(empty);
    } else {
      for (const [childKey, childValue] of entries) {
        details.appendChild(renderNode(childKey, childValue, level + 1));
      }
    }

    wrapper.appendChild(details);
    return wrapper;
  }

  const leaf = document.createElement('div');
  leaf.className = 'leaf';
  leaf.textContent = `${key}: ${formatPrimitive(value)}`;
  wrapper.appendChild(leaf);
  return wrapper;
};

const clearElement = (element) => {
  if (!element) {
    return;
  }
  element.innerHTML = '';
};

const ensureEmptyMessage = (element, message = 'Немає записів') => {
  const empty = document.createElement('div');
  empty.className = 'leaf';
  empty.textContent = message;
  element.appendChild(empty);
};

const formatTimestamp = (value) => {
  if (!value) {
    return '—';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('uk-UA');
};

const renderSummary = (state) => {
  if (!summaryEl) {
    return;
  }

  if (!state) {
    summaryEl.classList.add('error');
    summaryEl.textContent = 'Дані недоступні.';
    return;
  }

  const stats = state.stats || {};
  const active = state.active?.length ?? 0;
  const pending = state.pending?.length ?? 0;
  const processed = stats.processed ?? 0;
  const succeeded = stats.succeeded ?? 0;
  const failed = stats.failed ?? 0;

  const last = Array.isArray(state.recent) && state.recent.length > 0 ? state.recent[0] : null;
  let lastPart = 'Останній вебхук: немає записів.';
  if (last) {
    const statusMap = {
      completed: 'успіх',
      failed: 'помилка',
      processing: 'в роботі',
      queued: 'у черзі'
    };
    const statusLabel = statusMap[last.status] || last.status || 'невідомо';
    const keycrm = last.keycrmOrderId ? `KeyCRM #${last.keycrmOrderId}` : 'без ID';
    const time = last.completedAt || last.startedAt || last.enqueuedAt;
    lastPart = `Останній вебхук: ${statusLabel} (${keycrm}, ${formatTimestamp(time)}).`;
  }

  summaryEl.classList.remove('error');
  summaryEl.textContent = `Активні: ${active} · У черзі: ${pending} · Оброблено: ${processed} (успішно ${succeeded}, помилок ${failed}). ${lastPart}`;
};

const renderViewer = (element, data, title) => {
  clearElement(element);
  if (!element) {
    return;
  }

  element.appendChild(renderNode(title, data ?? {}));
};

const renderJobsList = (element, jobs = []) => {
  clearElement(element);
  if (!Array.isArray(jobs) || jobs.length === 0) {
    ensureEmptyMessage(element);
    return;
  }

  const statusLabels = {
    completed: 'Успіх',
    failed: 'Помилка',
    processing: 'В роботі',
    queued: 'У черзі'
  };

  jobs.forEach((job, index) => {
    const details = document.createElement('details');
    details.className = `queue-item status-${job.status || 'unknown'}`;
    if (index === 0) {
      details.open = true;
    }

    const summary = document.createElement('summary');
    const status = job.status || 'unknown';
    const label = statusLabels[status] || status;
    const keycrm = job.keycrmOrderId ? `KeyCRM #${job.keycrmOrderId}` : 'KeyCRM ?';
    const rozetka = job.rozetkaOrderId ? `Rozetka #${job.rozetkaOrderId}` : '';
    const pair = [keycrm, rozetka].filter(Boolean).join(' · ');
    const attempts = job.attempts ?? 0;
    summary.textContent = `${index + 1}. ${label} — ${pair}${attempts > 1 ? ` (спроб: ${attempts})` : ''}`;
    details.appendChild(summary);

    const meta = {
      status,
      attempts: job.attempts ?? 0,
      updated: job.updated ?? null,
      enqueuedAt: formatTimestamp(job.enqueuedAt),
      startedAt: formatTimestamp(job.startedAt),
      completedAt: formatTimestamp(job.completedAt),
      message: job.message || null,
      eventType: job.eventType || null
    };

    details.appendChild(renderNode('meta', meta));

    if (job.summary) {
      details.appendChild(renderNode('payloadSummary', job.summary));
    }

    if (job.urls && job.urls.length > 0) {
      details.appendChild(renderNode('urls', job.urls));
    }

    if (job.value) {
      details.appendChild(renderNode('fieldValue', job.value));
    }

    if (job.debug) {
      details.appendChild(renderNode('debug', job.debug));
    }

    if (job.payloadPreview) {
      details.appendChild(renderNode('payloadPreview', job.payloadPreview));
    }

    element.appendChild(details);
  });
};

const renderErrorLog = (entries = []) => {
  clearElement(errorLogEl);
  if (!errorLogEl) {
    return;
  }

  if (!Array.isArray(entries) || entries.length === 0) {
    ensureEmptyMessage(errorLogEl, 'Помилок не зафіксовано.');
    return;
  }

  entries.forEach((entry, index) => {
    const details = document.createElement('details');
    details.className = `queue-item status-${entry.level || 'info'}`;
    if (index === 0) {
      details.open = true;
    }

    const summary = document.createElement('summary');
    const timestamp = formatTimestamp(entry.timestamp);
    const levelLabel = (entry.level || 'info').toUpperCase();
    summary.textContent = `${timestamp} · ${levelLabel} · ${entry.message}`;
    details.appendChild(summary);

    const payload = {
      source: entry.source || null,
      context: entry.context || null
    };

    details.appendChild(renderNode('details', payload));
    errorLogEl.appendChild(details);
  });
};

const fetchErrorLog = async () => {
  if (!errorLogEl) {
    return;
  }

  try {
    const response = await fetch('/api/logs/errors?limit=50');
    if (!response.ok) {
      throw new Error(`Помилка читання логів (${response.status})`);
    }

    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Логи недоступні');
    }

    renderErrorLog(payload.data);
  } catch (error) {
    clearElement(errorLogEl);
    const problem = document.createElement('div');
    problem.className = 'leaf error';
    problem.textContent = error.message || 'Не вдалося завантажити логи';
    errorLogEl.appendChild(problem);
  }
};

const applyState = (state) => {
  renderSummary(state);
  renderViewer(settingsEl, state?.settings || {}, 'settings');
  renderViewer(statsEl, state?.stats || {}, 'stats');
  renderJobsList(activeEl, state?.active || []);
  renderJobsList(pendingEl, state?.pending || []);
  renderJobsList(historyEl, state?.recent || []);
};

const stopAutoRefresh = () => {
  if (autoRefreshTimer) {
    clearTimeout(autoRefreshTimer);
    autoRefreshTimer = null;
  }
};

const scheduleAutoRefresh = () => {
  stopAutoRefresh();
  if (!autoRefreshToggle.checked) {
    return;
  }
  autoRefreshTimer = setTimeout(() => {
    fetchQueueState();
  }, AUTO_REFRESH_INTERVAL);
};

const fetchQueueState = async (manual = false) => {
  stopAutoRefresh();
  if (manual) {
    setStatus('Оновлення…');
  } else {
    setStatus('Оновлення…');
  }
  refreshBtn.disabled = true;

  try {
    const response = await fetch('/api/queue/status');
    if (!response.ok) {
      throw new Error(`Сталася помилка (${response.status})`);
    }

    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Черга недоступна');
    }

    applyState(payload.data);
    await fetchErrorLog();
    const updatedAt = new Date().toLocaleString('uk-UA');
    updatedEl.textContent = `Оновлено: ${updatedAt}`;
    setStatus('Оновлено');
  } catch (error) {
    setStatus(error.message || 'Не вдалося отримати дані', true);
    summaryEl.classList.add('error');
    summaryEl.textContent = 'Дані недоступні.';
    clearElement(settingsEl);
    clearElement(statsEl);
    ensureEmptyMessage(activeEl, 'Немає активних задач');
    ensureEmptyMessage(pendingEl, 'Немає задач у черзі');
    ensureEmptyMessage(historyEl, 'Немає історії вебхуків');
    await fetchErrorLog();
  } finally {
    refreshBtn.disabled = false;
    scheduleAutoRefresh();
  }
};

refreshBtn.addEventListener('click', () => fetchQueueState(true));

autoRefreshToggle.addEventListener('change', () => {
  if (autoRefreshToggle.checked) {
    scheduleAutoRefresh();
  } else {
    stopAutoRefresh();
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopAutoRefresh();
  } else if (autoRefreshToggle.checked) {
    fetchQueueState();
  }
});

document.addEventListener('DOMContentLoaded', () => {
  fetchQueueState();
});
