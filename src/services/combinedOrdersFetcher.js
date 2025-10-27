const KeyCRMService = require('./keycrmService');
const RozetkaService = require('./rozetkaService');

const DEFAULT_KEYCRM_LIMIT = 20;
const KEYCRM_MAX_LIMIT = 50;
const DEFAULT_ROZETKA_LIMIT = 20;
const ROZETKA_MAX_LIMIT = 100;

const KEYCRM_MATCH_FIELDS = [
  'source_uuid',
  'global_source_uuid',
  'number',
  'order_number',
  'id'
];

const ROZETKA_MATCH_FIELDS = [
  'source_uuid',
  'global_source_uuid',
  'id',
  'order_id',
  'number',
  'order_number'
];

const parsePositiveInt = (value, fallback, max) => {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return fallback;
  }

  return max ? Math.min(parsed, max) : parsed;
};

const collectValues = (record, fields) => {
  const values = new Set();
  if (!record || typeof record !== 'object') {
    return values;
  }

  fields.forEach((field) => {
    if (record[field] !== undefined && record[field] !== null) {
      values.add(String(record[field]));
    }
  });

  return values;
};

const matchOrders = (rozetkaOrders = [], keycrmOrders = []) => {
  const pairs = [];
  const unmatchedRozetka = [];
  const usedKeyIndices = new Set();

  const safeRozetka = Array.isArray(rozetkaOrders) ? rozetkaOrders : [];
  const safeKeycrm = Array.isArray(keycrmOrders) ? keycrmOrders : [];

  safeRozetka.forEach((rozetkaOrder) => {
    const rozetkaValues = collectValues(rozetkaOrder, ROZETKA_MATCH_FIELDS);
    let matchedOrder = null;
    let matchedField = null;
    let matchedValue = null;
    let matchedIndex = -1;

    for (let index = 0; index < safeKeycrm.length; index += 1) {
      if (usedKeyIndices.has(index)) {
        continue;
      }

      const keyOrder = safeKeycrm[index];

      for (const field of KEYCRM_MATCH_FIELDS) {
        const value = keyOrder?.[field];
        if (value === undefined || value === null) {
          continue;
        }

        const stringValue = String(value);
        if (rozetkaValues.has(stringValue)) {
          matchedOrder = keyOrder;
          matchedField = field;
          matchedValue = stringValue;
          matchedIndex = index;
          break;
        }
      }

      if (matchedOrder) {
        break;
      }
    }

    if (matchedOrder) {
      usedKeyIndices.add(matchedIndex);
      pairs.push({
        rozetkaOrder,
        keycrmOrder: matchedOrder,
        matchField: matchedField,
        matchValue: matchedValue,
        purchaseItems: extractPurchaseItems(rozetkaOrder)
      });
    } else {
      unmatchedRozetka.push(rozetkaOrder);
    }
  });

  const unmatchedKeycrm = safeKeycrm.filter(
    (_, index) => !usedKeyIndices.has(index)
  );

  return {
    pairs,
    unmatchedRozetka,
    unmatchedKeycrm
  };
};

function extractPurchaseItems(rozetkaOrder) {
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
}

const fetchCombinedOrders = async (env = process.env) => {
  const rozetkaToken = env.ROZETKA_API_TOKEN;
  if (!rozetkaToken) {
    throw new Error('Missing ROZETKA_API_TOKEN environment variable.');
  }

  const keycrmToken = env.KEYCRM_API_KEY;
  if (!keycrmToken) {
    throw new Error('Missing KEYCRM_API_KEY environment variable.');
  }

  const rozetkaService = new RozetkaService({
    token: rozetkaToken,
    baseUrl: env.ROZETKA_BASE_URL
  });

  const keycrmService = new KeyCRMService({
    apiKey: keycrmToken,
    baseUrl: env.KEYCRM_BASE_URL
  });

  if (env.ROZETKA_SKIP_TOKEN_CHECK !== 'true') {
    await rozetkaService.checkToken();
  }

  const rozetkaLimit = parsePositiveInt(
    env.ROZETKA_ORDER_LIMIT,
    DEFAULT_ROZETKA_LIMIT,
    ROZETKA_MAX_LIMIT
  );
  const rozetkaPage = parsePositiveInt(env.ROZETKA_ORDER_PAGE, 1);
  const rozetkaExpand =
    env.ROZETKA_EXPAND || 'user,delivery,purchases';

  const keycrmLimit = parsePositiveInt(
    env.COMBINED_KEYCRM_LIMIT,
    DEFAULT_KEYCRM_LIMIT,
    KEYCRM_MAX_LIMIT
  );
  const keycrmInclude = env.KEYCRM_INCLUDE;

  const debug = env.ROZETKA_DEBUG === 'true';

  const [rozetkaOrders, keycrmOrders] = await Promise.all([
    rozetkaService.fetchRecentOrders({
      perPage: rozetkaLimit,
      page: rozetkaPage,
      expand: rozetkaExpand,
      debug
    }),
    keycrmService.fetchRecentOrders(keycrmLimit, {
      ...(keycrmInclude ? { include: keycrmInclude } : {})
    })
  ]);

  const matchResult = matchOrders(rozetkaOrders, keycrmOrders);
  const primaryPair = matchResult.pairs[0] || null;
  const rozetkaPrimary =
    primaryPair?.rozetkaOrder ||
    (Array.isArray(rozetkaOrders) && rozetkaOrders.length > 0
      ? rozetkaOrders[0]
      : null);
  const keycrmPrimary =
    Array.isArray(keycrmOrders) && keycrmOrders.length > 0
      ? keycrmOrders[0]
      : null;

  const matchedKeycrmOrder = primaryPair?.keycrmOrder || null;
  const matchField = primaryPair?.matchField || null;
  const matchValue = primaryPair?.matchValue || null;
  const rozetkaItems =
    primaryPair?.purchaseItems || extractPurchaseItems(rozetkaPrimary);

  const matches = {
    pairs: matchResult.pairs.map((pair) => ({
      rozetkaOrder: pair.rozetkaOrder,
      keycrmOrder: pair.keycrmOrder,
      matchField: pair.matchField,
      matchValue: pair.matchValue,
      purchaseItems: pair.purchaseItems
    })),
    unmatchedRozetka: matchResult.unmatchedRozetka.map((order) => ({
      order,
      purchaseItems: extractPurchaseItems(order)
    })),
    unmatchedKeycrm: matchResult.unmatchedKeycrm,
    stats: {
      rozetkaCount: Array.isArray(rozetkaOrders) ? rozetkaOrders.length : 0,
      keycrmCount: Array.isArray(keycrmOrders) ? keycrmOrders.length : 0,
      pairedCount: matchResult.pairs.length,
      unmatchedRozetkaCount: matchResult.unmatchedRozetka.length,
      unmatchedKeycrmCount: matchResult.unmatchedKeycrm.length
    }
  };

  return {
    rozetka: {
      order: rozetkaPrimary || null,
      count: Array.isArray(rozetkaOrders) ? rozetkaOrders.length : 0,
      all: Array.isArray(rozetkaOrders) ? rozetkaOrders : [],
      purchaseItems: rozetkaItems
    },
    keycrm: {
      matchedOrder: matchedKeycrmOrder || null,
      fallbackOrder: matchedKeycrmOrder ? null : keycrmPrimary || null,
      count: Array.isArray(keycrmOrders) ? keycrmOrders.length : 0,
      all: Array.isArray(keycrmOrders) ? keycrmOrders : [],
      matchInfo: matchedKeycrmOrder && matchField
        ? { field: matchField, value: matchValue }
        : null
    },
    association: {
      rozetkaOrderId: rozetkaPrimary?.id ?? null,
      rozetkaSourceUuid: rozetkaPrimary?.source_uuid ?? null,
      keycrmOrderId:
        matchedKeycrmOrder?.id ??
        matchedKeycrmOrder?.order_id ??
        keycrmPrimary?.id ??
        null,
      matchField: matchField ?? null,
      matchValue: matchValue ?? null,
      purchaseItems: rozetkaItems,
      rozetkaOrder: rozetkaPrimary || null,
      keycrmOrder: matchedKeycrmOrder || keycrmPrimary || null,
      keycrmFallbackOrder:
        matchedKeycrmOrder && keycrmPrimary && matchedKeycrmOrder !== keycrmPrimary
          ? keycrmPrimary
          : null
    },
    matches,
    meta: {
      fetchedAt: new Date().toISOString(),
      rozetkaLimit,
      keycrmLimit
    }
  };
};

module.exports = fetchCombinedOrders;
