const process = require('node:process');

require('dotenv').config();

const KeyCRMService = require('./services/keycrmService');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const parseLimit = (value) => {
  if (!value) {
    return DEFAULT_LIMIT;
  }
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed) || parsed <= 0) {
    return DEFAULT_LIMIT;
  }

  return Math.min(parsed, MAX_LIMIT);
};

const resolveField = (record, possibleKeys, fallback = 'n/a') => {
  for (const key of possibleKeys) {
    if (record && record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return fallback;
};

const formatOrder = (order, index) => {
  const id = resolveField(order, ['number', 'order_number', 'id', 'ID'], 'unknown');
  const status = resolveField(order, ['status', 'status_name', 'state'], 'unknown');
  const total = resolveField(order, ['total', 'total_price', 'sum', 'amount'], 'n/a');
  const createdAt = resolveField(order, ['created_at', 'createdAt', 'date', 'created'], 'n/a');
  return `${index + 1}. Order ${id} | status: ${status} | total: ${total} | created_at: ${createdAt}`;
};

const run = async () => {
  try {
    const apiKey = process.env.KEYCRM_API_KEY;
    if (!apiKey) {
      throw new Error('Missing KEYCRM_API_KEY environment variable.');
    }

    const service = new KeyCRMService({
      apiKey,
      baseUrl: process.env.KEYCRM_BASE_URL
    });
    const limit = parseLimit(process.env.KEYCRM_ORDER_LIMIT);
    const include = process.env.KEYCRM_INCLUDE;
    const orders = await service.fetchRecentOrders(limit, {
      ...(include ? { include } : {})
    });

    if (!Array.isArray(orders) || orders.length === 0) {
      console.log('Orders not found.');
      return;
    }

    console.log(`Last ${Math.min(limit, orders.length)} orders:`);
    orders.forEach((order, index) => {
      console.log(formatOrder(order, index));
      console.dir(order, { depth: null });
      console.log('');
    });
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      console.error(`KeyCRM API error ${status}:`, data);
      return;
    }

    console.error('Failed to fetch orders:', error.message);
    process.exitCode = 1;
  }
};

run();
