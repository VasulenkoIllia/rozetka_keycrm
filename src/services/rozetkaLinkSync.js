const fetchCombinedOrders = require('./combinedOrdersFetcher');
const KeyCRMService = require('./keycrmService');
const RozetkaService = require('./rozetkaService');

const DEFAULT_FIELD_UUID = 'OR_1002';
const MAX_URLS = 10;
const DEFAULT_ROZETKA_SEARCH_MAX_PAGES = 5;
const DEFAULT_ROZETKA_SEARCH_PAGE_SIZE = 100;
const ROZETKA_MAX_PER_PAGE = 100;
const DEFAULT_KEYCRM_SEARCH_MAX_ATTEMPTS = 5;
const DEBUG_LIST_LIMIT = 10;
const KEYCRM_HINT_FIELDS = [
  'id',
  'order_id',
  'orderId',
  'number',
  'order_number',
  'source_uuid',
  'global_source_uuid'
];
const ROZETKA_LINK_FIELDS = [
  'id',
  'order_id',
  'number',
  'order_number',
  'source_uuid',
  'global_source_uuid'
];

const parsePositiveInt = (value, fallback, max) => {
  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  if (max) {
    return Math.min(parsed, max);
  }

  return parsed;
};

const uniqueUrls = (items = []) => {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const url = item?.itemUrl;
    if (!url || seen.has(url)) {
      continue;
    }
    seen.add(url);
    result.push(url);
  }
  return result;
};

const stringifyUrls = (urls = []) => {
  if (!Array.isArray(urls) || urls.length === 0) {
    return '';
  }

  return urls
    .slice(0, MAX_URLS)
    .map((url) => String(url).trim())
    .filter((url) => url.length > 0)
    .join('\n');
};

const safeStringSet = (values = []) => {
  const set = new Set();
  values.forEach((value) => {
    if (value === undefined || value === null) {
      return;
    }

    set.add(String(value));
  });
  return set;
};

const collectFieldValuesDeep = (record, fields, depth = 2, visited = new Set()) => {
  if (!record || typeof record !== 'object' || visited.has(record) || depth < 0) {
    return [];
  }

  visited.add(record);
  const ownValues = fields
    .map((field) => (Object.prototype.hasOwnProperty.call(record, field) ? record[field] : undefined))
    .filter((value) => value !== undefined && value !== null);

  if (depth === 0) {
    return ownValues;
  }

  const nestedValues = [];
  for (const value of Object.values(record)) {
    if (value && typeof value === 'object') {
      nestedValues.push(...collectFieldValuesDeep(value, fields, depth - 1, visited));
    }
  }

  return [...ownValues, ...nestedValues];
};

const collectHints = (record, fields, depth = 2) => {
  if (!record || typeof record !== 'object') {
    return new Set();
  }

  const values = collectFieldValuesDeep(record, fields, depth);
  return safeStringSet(values);
};

const findKeycrmOrderId = (record) => {
  if (!record || typeof record !== 'object') {
    return null;
  }

  for (const field of ['id', 'order_id', 'orderId']) {
    if (record[field] !== undefined && record[field] !== null) {
      return record[field];
    }
  }

  return null;
};

const bestEffortPayloadOrder = (payload) => {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  if (payload.order && typeof payload.order === 'object') {
    return payload.order;
  }

  if (payload.data && typeof payload.data === 'object') {
    if (payload.data.order && typeof payload.data.order === 'object') {
      return payload.data.order;
    }
    return payload.data;
  }

  return payload;
};

const resolveKeycrmOrderId = (pair, data) => {
  const primary =
    pair?.keycrmOrder ||
    data?.association?.keycrmOrder ||
    data?.keycrm?.matchedOrder ||
    data?.keycrm?.fallbackOrder ||
    null;

  return (
    primary?.id ||
    primary?.order_id ||
    data?.association?.keycrmOrderId ||
    null
  );
};

const mergeSets = (...collections) => {
  const result = new Set();
  collections.forEach((collection) => {
    if (!collection) {
      return;
    }

    if (collection instanceof Set) {
      collection.forEach((value) => result.add(String(value)));
      return;
    }

    if (Array.isArray(collection)) {
      collection.forEach((value) => {
        if (value === undefined || value === null) {
          return;
        }
        result.add(String(value));
      });
    }
  });
  return result;
};

const summarizeOrderForHints = (payload) => {
  const orderCandidate = bestEffortPayloadOrder(payload);

  const keycrmHints = mergeSets(
    collectHints(payload, KEYCRM_HINT_FIELDS),
    collectHints(orderCandidate, KEYCRM_HINT_FIELDS)
  );

  const rozetkaHints = mergeSets(
    collectHints(payload, ROZETKA_LINK_FIELDS),
    collectHints(orderCandidate, ROZETKA_LINK_FIELDS)
  );

  const keycrmOrderId =
    findKeycrmOrderId(orderCandidate) ?? findKeycrmOrderId(payload);

  return {
    orderCandidate,
    keycrmHints,
    rozetkaHints,
    keycrmOrderId
  };
};

const toLimitedArray = (iterable, limit = 10) => {
  if (!iterable) {
    return [];
  }

  const array = Array.isArray(iterable) ? iterable : Array.from(iterable);
  if (array.length <= limit) {
    return array;
  }

  return array.slice(0, limit);
};

const limitDebugList = (values = []) => {
  if (!Array.isArray(values)) {
    return [];
  }

  if (values.length <= DEBUG_LIST_LIMIT) {
    return values.slice();
  }

  return values.slice(-DEBUG_LIST_LIMIT);
};

const findMatchedPairByHints = (matches, hints) => {
  if (!matches || !Array.isArray(matches.pairs) || hints.size === 0) {
    return null;
  }

  for (const pair of matches.pairs) {
    const keycrmOrder = pair?.keycrmOrder;
    if (!keycrmOrder || typeof keycrmOrder !== 'object') {
      continue;
    }

    for (const field of KEYCRM_HINT_FIELDS) {
      const value = keycrmOrder[field];
      if (value === undefined || value === null) {
        continue;
      }

      if (hints.has(String(value))) {
        return pair;
      }
    }
  }

  return null;
};

const findKeycrmOrderByHints = (orders, hints) => {
  if (!Array.isArray(orders) || hints.size === 0) {
    return null;
  }

  return orders.find((order) => {
    if (!order || typeof order !== 'object') {
      return false;
    }

    return KEYCRM_HINT_FIELDS.some((field) => {
      const value = order[field];
      if (value === undefined || value === null) {
        return false;
      }
      return hints.has(String(value));
    });
  });
};

const findRozetkaOrderByHints = (orders, hints) => {
  if (!Array.isArray(orders) || hints.size === 0) {
    return null;
  }

  return orders.find((order) => {
    if (!order || typeof order !== 'object') {
      return false;
    }

    return ROZETKA_LINK_FIELDS.some((field) => {
      const value = order[field];
      if (value === undefined || value === null) {
        return false;
      }
      return hints.has(String(value));
    });
  });
};

const extractPurchaseItemsFromOrder = (rozetkaOrder) => {
  if (
    !rozetkaOrder ||
    !Array.isArray(rozetkaOrder.purchases) ||
    rozetkaOrder.purchases.length === 0
  ) {
    return [];
  }

  const resolveItemUrl = (item, purchase) => {
    const candidates = [
      item?.url,
      item?.href,
      item?.link,
      item?.product_url,
      item?.productUrl,
      purchase?.url,
      purchase?.product_url,
      purchase?.productUrl,
      purchase?.link
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const stringCandidate = String(candidate).trim();
      if (stringCandidate.length > 0) {
        return stringCandidate;
      }
    }

    return null;
  };

  const resolveItemName = (item, purchase) => {
    const candidates = [
      item?.name,
      item?.name_ua,
      item?.title,
      item?.product_name,
      purchase?.name,
      purchase?.title
    ];

    for (const candidate of candidates) {
      if (!candidate) {
        continue;
      }
      const stringCandidate = String(candidate).trim();
      if (stringCandidate.length > 0) {
        return stringCandidate;
      }
    }

    return null;
  };

  return rozetkaOrder.purchases
    .map((purchase) => {
      const item = purchase?.item;
      if (!item) {
        return null;
      }

      return {
        itemId: item.id ?? null,
        itemUrl: resolveItemUrl(item, purchase),
        itemName: resolveItemName(item, purchase),
        itemPrice: item.price ?? null,
        purchaseId: purchase.id ?? null,
        quantity: purchase.quantity ?? null
      };
    })
    .filter(
      (item) =>
        item &&
        (item.itemId !== null || item.itemUrl !== null || item.itemName !== null)
    );
};

function buildRozetkaSearchConfig(env = process.env) {
  const perPage = parsePositiveInt(
    env.ROZETKA_SEARCH_PAGE_SIZE ?? env.ROZETKA_ORDER_LIMIT,
    DEFAULT_ROZETKA_SEARCH_PAGE_SIZE,
    ROZETKA_MAX_PER_PAGE
  );
  const maxPages = parsePositiveInt(
    env.ROZETKA_SEARCH_MAX_PAGES,
    DEFAULT_ROZETKA_SEARCH_MAX_PAGES
  );

  return {
    perPage,
    maxPages,
    expand: env.ROZETKA_EXPAND || 'user,delivery,purchases'
  };
}

async function searchRozetkaOrderFallback(
  service,
  hints,
  config,
  { skipPages = new Set(), debug } = {}
) {
  if (!service || !hints || hints.size === 0) {
    return { order: null, attempts: [] };
  }

  const attempts = [];

  for (let page = 1; page <= config.maxPages; page += 1) {
    if (skipPages.has(page)) {
      continue;
    }

    try {
      const orders = await service.fetchRecentOrders({
        perPage: config.perPage,
        page,
        expand: config.expand
      });

      attempts.push(page);

      if (!Array.isArray(orders) || orders.length === 0) {
      if (debug) {
        debug.reachedEnd = true;
      }
      break;
    }

    const match = findRozetkaOrderByHints(orders, hints);
    if (match) {
      if (debug) {
        debug.foundOnPage = page;
        debug.attempts = limitDebugList([...attempts]);
      }
      return {
        order: match,
        page,
        attempts: attempts.slice()
      };
      }
    } catch (error) {
      if (debug) {
        debug.lastError = error.message || String(error);
      }
      break;
    }
  }

  if (debug) {
    debug.attempts = limitDebugList([...attempts]);
  }

  return {
    order: null,
    attempts
  };
}

async function fetchKeycrmOrderDirect(
  service,
  hints,
  include,
  maxAttempts = DEFAULT_KEYCRM_SEARCH_MAX_ATTEMPTS,
  debug
) {
  if (!service || !hints || hints.size === 0) {
    if (debug) {
      debug.attempts = [];
    }
    return { order: null, attempts: [] };
  }

  const attempts = [];
  const params = include ? { include } : {};

  for (const hint of hints) {
    if (maxAttempts && attempts.length >= maxAttempts) {
      break;
    }

    const candidate = String(hint ?? '').trim();
    if (!candidate) {
      continue;
    }

    attempts.push(candidate);

    try {
      const order = await service.fetchOrderById(candidate, params);
      if (order) {
        if (debug) {
          debug.found = true;
          debug.foundId = candidate;
          const existing = Array.isArray(debug.attempts) ? debug.attempts : [];
          const merged = Array.from(new Set([...existing, ...attempts]));
          debug.attempts = limitDebugList(merged);
        }
        return {
          order,
          id: candidate,
          attempts: attempts.slice()
        };
      }
    } catch (error) {
      if (debug) {
        debug.lastError = error.message || String(error);
      }
    }
  }

  if (debug) {
    const existing = Array.isArray(debug.attempts) ? debug.attempts : [];
    const merged = Array.from(new Set([...existing, ...attempts]));
    debug.attempts = limitDebugList(merged);
  }

  return {
    order: null,
    attempts
  };
}

const syncLatestRozetkaLink = async (env = process.env) => {
  const keycrmApiKey = env.KEYCRM_API_KEY;
  const rozetkaToken = env.ROZETKA_API_TOKEN;

  if (!keycrmApiKey || !rozetkaToken) {
    return {
      updated: false,
      reason: 'Missing KEYCRM_API_KEY or ROZETKA_API_TOKEN environment variables.'
    };
  }

  const data = await fetchCombinedOrders(env);
  const primaryPair = data.matches?.pairs?.[0] || null;

  if (!primaryPair) {
    return {
      updated: false,
      reason: 'No matched orders found between Rozetka and KeyCRM.'
    };
  }

  const urls = uniqueUrls(primaryPair.purchaseItems || []);
  if (urls.length === 0) {
    return {
      updated: false,
      reason: 'No Rozetka product URLs found for the latest matched order.'
    };
  }

  const keycrmOrderId = resolveKeycrmOrderId(primaryPair, data);

  if (!keycrmOrderId) {
    return {
      updated: false,
      reason: 'Unable to resolve KeyCRM order ID for the matched order.'
    };
  }

  const fieldUuid = env.KEYCRM_ROZETKA_LINK_UUID?.trim() || DEFAULT_FIELD_UUID;
  const value = stringifyUrls(urls);

  if (!value) {
    return {
      updated: false,
      reason: 'Resolved product URLs list is empty.'
    };
  }

  const service = new KeyCRMService({
    apiKey: keycrmApiKey,
    baseUrl: env.KEYCRM_BASE_URL
  });

  await service.updateOrder(keycrmOrderId, {
    custom_fields: [
      {
        uuid: fieldUuid,
        value
      }
    ]
  });

  return {
    updated: true,
    keycrmOrderId,
    rozetkaOrderId: primaryPair.rozetkaOrder?.id ?? null,
    fieldUuid,
    value,
    urls
  };
};

const syncRozetkaLinkForPayload = async (payload, env = process.env) => {
  const keycrmApiKey = env.KEYCRM_API_KEY;
  const rozetkaToken = env.ROZETKA_API_TOKEN;

  if (!keycrmApiKey || !rozetkaToken) {
    return {
      updated: false,
      reason:
        'Missing KEYCRM_API_KEY or ROZETKA_API_TOKEN environment variables.',
      debug: {
        missingKeycrmApiKey: !keycrmApiKey,
        missingRozetkaToken: !rozetkaToken
      }
    };
  }

  const rozetkaService = new RozetkaService({
    token: rozetkaToken,
    baseUrl: env.ROZETKA_BASE_URL
  });

  const keycrmService = new KeyCRMService({
    apiKey: keycrmApiKey,
    baseUrl: env.KEYCRM_BASE_URL
  });

  const keycrmInclude = env.KEYCRM_INCLUDE;

  const {
    keycrmHints,
    rozetkaHints: initialRozetkaHints,
    keycrmOrderId,
    orderCandidate
  } = summarizeOrderForHints(payload);
  let resolvedKeycrmOrderId = keycrmOrderId;
  let rozetkaHints = new Set(initialRozetkaHints || []);

  const data = await fetchCombinedOrders(env);
  const matches = data.matches || {};
  const keycrmCandidates = [];
  const rozetkaCandidates = [];
  const rozetkaSearchConfig = buildRozetkaSearchConfig(env);
  const keycrmDirectMaxAttempts = parsePositiveInt(
    env.KEYCRM_SEARCH_MAX_ATTEMPTS,
    DEFAULT_KEYCRM_SEARCH_MAX_ATTEMPTS
  );
  const rozetkaFallbackDebug = {
    enabled: false,
    attempts: [],
    foundOnPage: null,
    perPage: rozetkaSearchConfig.perPage,
    maxPages: rozetkaSearchConfig.maxPages,
    reachedEnd: false,
    lastError: null
  };
  const keycrmFallbackDebug = {
    attempts: [],
    found: false,
    foundId: null,
    lastError: null,
    maxAttempts: keycrmDirectMaxAttempts
  };

  let matchedPair = findMatchedPairByHints(matches, keycrmHints) || null;
  let rozetkaOrder = matchedPair?.rozetkaOrder || null;
  let purchaseItems = matchedPair?.purchaseItems || [];
  let purchaseItemsSource = matchedPair ? 'matchedPair' : 'unknown';

  if (matchedPair?.keycrmOrder) {
    keycrmCandidates.push(matchedPair.keycrmOrder);
  }
  if (data.keycrm?.matchedOrder) {
    keycrmCandidates.push(data.keycrm.matchedOrder);
  }
  if (data.keycrm?.fallbackOrder) {
    keycrmCandidates.push(data.keycrm.fallbackOrder);
  }
  if (Array.isArray(data.keycrm?.all)) {
    keycrmCandidates.push(...data.keycrm.all);
  }
  if (Array.isArray(matches.unmatchedKeycrm)) {
    keycrmCandidates.push(...matches.unmatchedKeycrm);
  }
  if (data.association?.keycrmOrder) {
    keycrmCandidates.push(data.association.keycrmOrder);
  }
  if (data.association?.keycrmFallbackOrder) {
    keycrmCandidates.push(data.association.keycrmFallbackOrder);
  }

  let matchedKeycrmOrder =
    findKeycrmOrderByHints(keycrmCandidates, keycrmHints) ||
    matchedPair?.keycrmOrder ||
    null;

  if (!matchedKeycrmOrder && resolvedKeycrmOrderId) {
    try {
      keycrmFallbackDebug.attempts = limitDebugList(
        [...keycrmFallbackDebug.attempts, String(resolvedKeycrmOrderId)]
      );
      const directOrder = await keycrmService.fetchOrderById(
        resolvedKeycrmOrderId,
        keycrmInclude ? { include: keycrmInclude } : {}
      );
      if (directOrder) {
        matchedKeycrmOrder = directOrder;
        keycrmCandidates.push(directOrder);
        keycrmFallbackDebug.found = true;
        keycrmFallbackDebug.foundId = String(resolvedKeycrmOrderId);
      }
    } catch (error) {
      keycrmFallbackDebug.lastError = error.message;
    }
  }

  if (!matchedKeycrmOrder) {
    const directAttempt = await fetchKeycrmOrderDirect(
      keycrmService,
      keycrmHints,
      keycrmInclude,
      keycrmDirectMaxAttempts,
      keycrmFallbackDebug
    );
    if (directAttempt?.order) {
      matchedKeycrmOrder = directAttempt.order;
      keycrmCandidates.push(directAttempt.order);
      if (!resolvedKeycrmOrderId) {
        resolvedKeycrmOrderId =
          findKeycrmOrderId(directAttempt.order) ??
          directAttempt.order?.number ??
          directAttempt.order?.order_number ??
          null;
      }
    }
  }

  if (matchedKeycrmOrder && !resolvedKeycrmOrderId) {
    resolvedKeycrmOrderId =
      findKeycrmOrderId(matchedKeycrmOrder) ??
      matchedKeycrmOrder?.number ??
      matchedKeycrmOrder?.order_number ??
      null;
  }

  if (!resolvedKeycrmOrderId && data.association?.keycrmOrderId) {
    resolvedKeycrmOrderId = data.association.keycrmOrderId;
  }

  const debugSnapshot = (extra = {}) => ({
    keycrmHints: toLimitedArray(keycrmHints),
    rozetkaHints: toLimitedArray(rozetkaHints),
    keycrmCandidates: keycrmCandidates.length,
    rozetkaCandidates: rozetkaCandidates.length,
    resolvedKeycrmOrderId: resolvedKeycrmOrderId ?? keycrmOrderId ?? null,
    matchedPair: matchedPair
      ? {
          matchField: matchedPair.matchField ?? null,
          matchValue: matchedPair.matchValue ?? null,
          keycrmOrderId:
            findKeycrmOrderId(matchedPair.keycrmOrder) ??
            matchedPair.keycrmOrder?.number ??
            matchedPair.keycrmOrder?.order_number ??
            null,
          rozetkaOrderId:
            matchedPair.rozetkaOrder?.id ??
            matchedPair.rozetkaOrder?.order_id ??
            matchedPair.rozetkaOrder?.number ??
            null
        }
      : null,
    purchaseItemsSource,
    rozetkaFallback: rozetkaFallbackDebug,
    keycrmDirectFetch: keycrmFallbackDebug,
    ...extra
  });

  if (!resolvedKeycrmOrderId) {
    return {
      updated: false,
      reason: 'Unable to resolve KeyCRM order ID from webhook payload.',
      debug: debugSnapshot()
    };
  }

  if (matchedKeycrmOrder) {
    rozetkaHints = mergeSets(
      rozetkaHints,
      collectHints(matchedKeycrmOrder, ROZETKA_LINK_FIELDS)
    );
  }

  if (!rozetkaOrder) {
    rozetkaFallbackDebug.enabled = true;
    const fallbackResult = await searchRozetkaOrderFallback(
      rozetkaService,
      rozetkaHints,
      rozetkaSearchConfig,
      {
        debug: rozetkaFallbackDebug
      }
    );

    rozetkaFallbackDebug.attempts = limitDebugList(fallbackResult.attempts || []);
    if (fallbackResult?.order) {
      rozetkaOrder = fallbackResult.order;
      rozetkaFallbackDebug.foundOnPage = fallbackResult.page ?? null;
      if (!purchaseItems || purchaseItems.length === 0) {
        purchaseItems = extractPurchaseItemsFromOrder(rozetkaOrder);
        if (purchaseItems.length > 0) {
          purchaseItemsSource = 'rozetkaFallback';
        }
      }
    }
  }

  if (rozetkaOrder) {
    rozetkaCandidates.push(rozetkaOrder);
  }
  if (data.association?.rozetkaOrder) {
    rozetkaCandidates.push(data.association.rozetkaOrder);
  }
  if (Array.isArray(data.rozetka?.all)) {
    rozetkaCandidates.push(...data.rozetka.all);
  }
  if (Array.isArray(matches.unmatchedRozetka)) {
    matches.unmatchedRozetka.forEach((entry) => {
      if (entry?.order) {
        rozetkaCandidates.push(entry.order);
      }
    });
  }

  if (!rozetkaOrder) {
    rozetkaOrder =
      findRozetkaOrderByHints(rozetkaCandidates, rozetkaHints) || rozetkaOrder;
  }

  if (!rozetkaOrder && data.rozetka?.order) {
    rozetkaOrder = data.rozetka.order;
  }

  if (!rozetkaOrder) {
    return {
      updated: false,
      reason: 'Unable to match Rozetka order for the provided payload.',
      keycrmOrderId: resolvedKeycrmOrderId,
      debug: debugSnapshot()
    };
  }

  if (!purchaseItems || purchaseItems.length === 0) {
    purchaseItems = extractPurchaseItemsFromOrder(rozetkaOrder);
    if (purchaseItems.length > 0) {
      purchaseItemsSource = 'rozetkaOrder';
    }
  }

  if ((!purchaseItems || purchaseItems.length === 0) && orderCandidate) {
    purchaseItems = extractPurchaseItemsFromOrder(orderCandidate);
    if (purchaseItems.length > 0) {
      purchaseItemsSource = 'webhookPayload';
    }
  }

  const urls = uniqueUrls(purchaseItems || []);
  if (urls.length === 0) {
    return {
      updated: false,
      reason: 'No Rozetka product URLs found for the matched order.',
      keycrmOrderId: resolvedKeycrmOrderId,
      rozetkaOrderId: rozetkaOrder?.id ?? rozetkaOrder?.order_id ?? null,
      debug: debugSnapshot({ purchaseItemsSource })
    };
  }

  const value = stringifyUrls(urls);
  if (!value) {
    return {
      updated: false,
      reason: 'Resolved product URLs list is empty after formatting.',
      keycrmOrderId: resolvedKeycrmOrderId,
      rozetkaOrderId: rozetkaOrder?.id ?? rozetkaOrder?.order_id ?? null,
      debug: debugSnapshot({ urlsCount: urls.length, purchaseItemsSource })
    };
  }

  const fieldUuid = env.KEYCRM_ROZETKA_LINK_UUID?.trim() || DEFAULT_FIELD_UUID;

  await keycrmService.updateOrder(resolvedKeycrmOrderId, {
    custom_fields: [
      {
        uuid: fieldUuid,
        value
      }
    ]
  });

  return {
    updated: true,
    keycrmOrderId: resolvedKeycrmOrderId,
    rozetkaOrderId: rozetkaOrder?.id ?? rozetkaOrder?.order_id ?? null,
    fieldUuid,
    value,
    urls,
    matchField: matchedPair?.matchField ?? null,
    matchValue: matchedPair?.matchValue ?? null,
    debug: debugSnapshot({ urlsCount: urls.length, purchaseItemsSource })
  };
};

module.exports = {
  syncLatestRozetkaLink,
  syncRozetkaLinkForPayload
};
