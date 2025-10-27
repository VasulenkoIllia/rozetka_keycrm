const statusEl = document.getElementById('status');
const matchInfoEl = document.getElementById('match-info');
const rozetkaOrderEl = document.getElementById('rozetka-order');
const keycrmOrderEl = document.getElementById('keycrm-order');
const rozetkaRawEl = document.getElementById('rozetka-raw');
const keycrmRawEl = document.getElementById('keycrm-raw');
const refreshBtn = document.getElementById('refresh');
const syncRozetkaLinkBtn = document.getElementById('sync-rozetka-link');
const associationInfoEl = document.getElementById('association-info');
const associationItemsEl = document.getElementById('association-items');
const associationRozetkaEl = document.getElementById('association-rozetka');
const associationKeycrmEl = document.getElementById('association-keycrm');
const associationKeycrmFallbackEl = document.getElementById(
  'association-keycrm-fallback'
);
const matchesSummaryEl = document.getElementById('matches-summary');
const matchesListEl = document.getElementById('matches-list');
const queueSummaryEl = document.getElementById('queue-summary-text');

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

const renderOrder = (element, order, title) => {
  element.innerHTML = '';
  if (!order) {
    const empty = document.createElement('div');
    empty.className = 'leaf error';
    empty.textContent = 'Дані відсутні';
    element.appendChild(empty);
    return;
  }

  element.appendChild(renderNode(title, order));
};

const renderArray = (element, items, title) => {
  element.innerHTML = '';
  if (!items || items.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'leaf';
    empty.textContent = 'Порожньо';
    element.appendChild(empty);
    return;
  }

  element.appendChild(renderNode(title, items));
};

const renderAssociation = (association) => {
  associationInfoEl.innerHTML = '';
  associationItemsEl.innerHTML = '';
  associationRozetkaEl.innerHTML = '';
  associationKeycrmEl.innerHTML = '';
  associationKeycrmFallbackEl.innerHTML = '';

  if (!association) {
    const empty = document.createElement('div');
    empty.className = 'leaf error';
    empty.textContent = 'Дані не знайдені';
    associationInfoEl.appendChild(empty);
    return;
  }

  const info = {
    rozetkaOrderId: association.rozetkaOrderId ?? null,
    rozetkaSourceUuid: association.rozetkaSourceUuid ?? null,
    keycrmOrderId: association.keycrmOrderId ?? null,
    matchField: association.matchField ?? null,
    matchValue: association.matchValue ?? null
  };

  associationInfoEl.appendChild(renderNode('association', info));
  renderArray(
    associationItemsEl,
    association.purchaseItems || [],
    'purchaseItems'
  );

  if (association.rozetkaOrder) {
    associationRozetkaEl.appendChild(
      renderNode('rozetkaOrder', association.rozetkaOrder)
    );
  } else {
    const empty = document.createElement('div');
    empty.className = 'leaf';
    empty.textContent = 'Rozetka order відсутній';
    associationRozetkaEl.appendChild(empty);
  }

  if (association.keycrmOrder) {
    associationKeycrmEl.appendChild(
      renderNode('keycrmOrder', association.keycrmOrder)
    );
  } else {
    const empty = document.createElement('div');
    empty.className = 'leaf';
    empty.textContent = 'KeyCRM order відсутній';
    associationKeycrmEl.appendChild(empty);
  }

  if (association.keycrmFallbackOrder) {
    associationKeycrmFallbackEl.appendChild(
      renderNode('keycrmFallbackOrder', association.keycrmFallbackOrder)
    );
  }
};

const renderMatches = (matches) => {
  matchesSummaryEl.innerHTML = '';
  matchesListEl.innerHTML = '';

  if (!matches) {
    const empty = document.createElement('div');
    empty.className = 'leaf';
    empty.textContent = 'Немає даних про зіставлення.';
    matchesSummaryEl.appendChild(empty);
    return;
  }

  const stats = matches.stats || {};
  const summaryText = [
    `Rozetka: ${stats.rozetkaCount ?? 0}`,
    `KeyCRM: ${stats.keycrmCount ?? 0}`,
    `Зіставлено: ${stats.pairedCount ?? 0}`,
    `Без пари (Rozetka): ${stats.unmatchedRozetkaCount ?? 0}`,
    `Без пари (KeyCRM): ${stats.unmatchedKeycrmCount ?? 0}`
  ].join(' · ');

  const summary = document.createElement('div');
  summary.textContent = summaryText;
  matchesSummaryEl.appendChild(summary);

  const pairs = matches.pairs || [];

  pairs.forEach((pair, index) => {
    const details = document.createElement('details');
    details.className = 'match-item';
    if (index === 0) {
      details.open = true;
    }

    const summaryEl = document.createElement('summary');
    const roId = pair.rozetkaOrder?.id ?? pair.rozetkaOrder?.order_id ?? '—';
    const keyId =
      pair.keycrmOrder?.id ??
      pair.keycrmOrder?.order_id ??
      pair.keycrmOrder?.number ??
      '—';
    const matchLabel = pair.matchField
      ? `${pair.matchField} = ${pair.matchValue}`
      : 'без деталі збігу';
    summaryEl.textContent = `Rozetka #${roId} ↔ KeyCRM #${keyId} (${matchLabel})`;
    details.appendChild(summaryEl);

    const roWrapper = document.createElement('div');
    roWrapper.className = 'match-section';
    roWrapper.appendChild(renderNode('rozetkaOrder', pair.rozetkaOrder));
    details.appendChild(roWrapper);

    const keyWrapper = document.createElement('div');
    keyWrapper.className = 'match-section';
    keyWrapper.appendChild(renderNode('keycrmOrder', pair.keycrmOrder));
    details.appendChild(keyWrapper);

    if (pair.purchaseItems && pair.purchaseItems.length > 0) {
      const itemsWrapper = document.createElement('div');
      itemsWrapper.className = 'match-section';
      itemsWrapper.appendChild(renderNode('purchaseItems', pair.purchaseItems));
      details.appendChild(itemsWrapper);
    }

    matchesListEl.appendChild(details);
  });

  const unmatchedRozetka = matches.unmatchedRozetka || [];
  if (unmatchedRozetka.length > 0) {
    const unmatchedDetails = document.createElement('details');
    unmatchedDetails.className = 'match-item';
    const summaryEl = document.createElement('summary');
    summaryEl.textContent = `Rozetka без пари (${unmatchedRozetka.length})`;
    unmatchedDetails.appendChild(summaryEl);

    unmatchedRozetka.forEach((entry, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'match-section';
      wrapper.appendChild(renderNode(`order_${idx + 1}`, entry.order));
      if (entry.purchaseItems && entry.purchaseItems.length > 0) {
        wrapper.appendChild(
          renderNode('purchaseItems', entry.purchaseItems)
        );
      }
      unmatchedDetails.appendChild(wrapper);
    });

    matchesListEl.appendChild(unmatchedDetails);
  }

  const unmatchedKeycrm = matches.unmatchedKeycrm || [];
  if (unmatchedKeycrm.length > 0) {
    const unmatchedDetails = document.createElement('details');
    unmatchedDetails.className = 'match-item';
    const summaryEl = document.createElement('summary');
    summaryEl.textContent = `KeyCRM без пари (${unmatchedKeycrm.length})`;
    unmatchedDetails.appendChild(summaryEl);

    unmatchedKeycrm.forEach((order, idx) => {
      const wrapper = document.createElement('div');
      wrapper.className = 'match-section';
      wrapper.appendChild(renderNode(`order_${idx + 1}`, order));
      unmatchedDetails.appendChild(wrapper);
    });

    matchesListEl.appendChild(unmatchedDetails);
  }
};

const setStatus = (text, isError = false) => {
  statusEl.textContent = text;
  statusEl.classList.toggle('error', isError);
};

const formatQueueTimestamp = (value) => {
  if (!value) {
    return 'невідомий час';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return String(value);
  }

  return date.toLocaleString('uk-UA');
};

const queueSummaryOk = (text) => {
  if (!queueSummaryEl) {
    return;
  }
  queueSummaryEl.classList.remove('error');
  queueSummaryEl.textContent = text;
};

const queueSummaryError = (message) => {
  if (!queueSummaryEl) {
    return;
  }
  queueSummaryEl.classList.add('error');
  queueSummaryEl.textContent = message || 'Дані про вебхуки недоступні.';
};

const renderQueueSummary = (state) => {
  if (!queueSummaryEl) {
    return;
  }

  if (!state) {
    queueSummaryError('Дані про вебхуки недоступні.');
    return;
  }

  const stats = state.stats || {};
  const active = state.active?.length ?? 0;
  const pending = state.pending?.length ?? 0;
  const succeeded = stats.succeeded ?? 0;
  const failed = stats.failed ?? 0;
  const last = Array.isArray(state.recent) && state.recent.length > 0 ? state.recent[0] : null;

  let lastMessage = 'Останній вебхук: немає записів.';
  if (last) {
    const statusMap = {
      completed: 'успіх',
      failed: 'помилка',
      processing: 'в роботі',
      queued: 'у черзі'
    };
    const statusLabel = statusMap[last.status] || last.status || 'невідомо';
    const keycrm = last.keycrmOrderId ? `KeyCRM #${last.keycrmOrderId}` : 'без ідентифікатора';
    const time = last.completedAt || last.startedAt || last.enqueuedAt;
    lastMessage = `Останній вебхук: ${statusLabel} (${keycrm}, ${formatQueueTimestamp(time)}).`;
  }

  const summaryText = `Активні: ${active} · У черзі: ${pending} · Успішно: ${succeeded} · Помилки: ${failed}. ${lastMessage}`;
  queueSummaryOk(summaryText);
};

const fetchQueueSummary = async () => {
  if (!queueSummaryEl) {
    return;
  }

  try {
    const response = await fetch('/api/queue/status');
    if (!response.ok) {
      throw new Error(`Помилка моніторингу (${response.status})`);
    }

    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Дані про чергу недоступні');
    }

    renderQueueSummary(payload.data);
  } catch (error) {
    queueSummaryError(error.message || 'Не вдалося завантажити інформацію про вебхуки.');
  }
};

const renderMatchInfo = (data) => {
  if (!data || !data.keycrm) {
    matchInfoEl.textContent = '';
    return;
  }

  if (data.keycrm.matchInfo) {
    const { field, value } = data.keycrm.matchInfo;
    matchInfoEl.textContent = `Збіг знайдено за полем ${field} зі значенням ${value}.`;
    return;
  }

  if (data.keycrm.matchedOrder) {
    matchInfoEl.textContent = 'Збіг знайдено.';
    return;
  }

  if (data.keycrm.fallbackOrder) {
    matchInfoEl.textContent =
      'Збіг не знайдено, показуємо останнє замовлення з KeyCRM.';
    return;
  }

  matchInfoEl.textContent = 'KeyCRM не повернув замовлення.';
};

const fetchData = async () => {
  setStatus('Завантаження даних...');
  refreshBtn.disabled = true;

  try {
    const response = await fetch('/api/combined-orders');
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message =
        errorPayload?.message || `Сталася помилка (${response.status})`;
      throw new Error(message);
    }

    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Сталася невідома помилка');
    }

    const data = payload.data;
    const { rozetka, keycrm, association, matches, meta } = data;

    renderOrder(rozetkaOrderEl, rozetka.order, 'order');
    renderOrder(
      keycrmOrderEl,
      keycrm.matchedOrder || keycrm.fallbackOrder,
      'order'
    );
    renderArray(rozetkaRawEl, rozetka.all, 'orders');
    renderArray(keycrmRawEl, keycrm.all, 'orders');
    renderMatchInfo(data);
    renderAssociation(association);
    renderMatches(matches);

    await fetchQueueSummary();

    const updatedAt = meta?.fetchedAt
      ? new Date(meta.fetchedAt).toLocaleString('uk-UA')
      : new Date().toLocaleString('uk-UA');
    setStatus(`Оновлено: ${updatedAt}`);
  } catch (error) {
    setStatus(error.message || 'Сталася помилка', true);
    matchInfoEl.textContent = '';
    rozetkaOrderEl.innerHTML = '';
    keycrmOrderEl.innerHTML = '';
    rozetkaRawEl.innerHTML = '';
    keycrmRawEl.innerHTML = '';
    associationInfoEl.innerHTML = '';
    associationItemsEl.innerHTML = '';
    associationRozetkaEl.innerHTML = '';
    associationKeycrmEl.innerHTML = '';
    associationKeycrmFallbackEl.innerHTML = '';
    matchesSummaryEl.innerHTML = '';
    matchesListEl.innerHTML = '';
    queueSummaryError('Недоступно');
  } finally {
    refreshBtn.disabled = false;
  }
};

refreshBtn.addEventListener('click', fetchData);

document.addEventListener('DOMContentLoaded', () => {
  fetchData();
});

const syncRozetkaLink = async () => {
  setStatus('Синхронізація посилань...');
  refreshBtn.disabled = true;
  syncRozetkaLinkBtn.disabled = true;

  try {
    const response = await fetch('/api/sync-rozetka-link', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      }
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      const message =
        errorPayload?.message || `Помилка синхронізації (${response.status})`;
      throw new Error(message);
    }

    const payload = await response.json();
    if (!payload.success) {
      throw new Error(payload.message || 'Невідома помилка синхронізації');
    }

    const result = payload.data || {};
    if (result.updated) {
      const urlsText = Array.isArray(result.urls)
        ? result.urls.join(', ')
        : result.value;
      await fetchData();
      setStatus(
        `Синхронізовано: KeyCRM #${result.keycrmOrderId} ← ${urlsText}`
      );
    } else {
      setStatus(result.reason || 'Немає даних для синхронізації.');
    }
  } catch (error) {
    setStatus(error.message || 'Помилка синхронізації', true);
  } finally {
    syncRozetkaLinkBtn.disabled = false;
    refreshBtn.disabled = false;
  }
};

syncRozetkaLinkBtn.addEventListener('click', syncRozetkaLink);
