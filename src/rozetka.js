const process = require('node:process');

require('dotenv').config();

const RozetkaService = require('./services/rozetkaService');

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

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

const resolveField = (record, possibleKeys, fallback = 'n/a') => {
  for (const key of possibleKeys) {
    if (record && record[key] !== undefined && record[key] !== null) {
      return record[key];
    }
  }
  return fallback;
};

const formatOrder = (order, index) => {
  const id = resolveField(
    order,
    ['id', 'order_id', 'source_uuid', 'global_source_uuid'],
    'unknown'
  );
  const status = resolveField(
    order,
    ['status', 'status_name', 'state', 'state_name'],
    'unknown'
  );
  const total = resolveField(
    order,
    [
      'total',
      'sum',
      'price',
      'amount',
      'grand_total',
      'total_with_delivery',
      'total_price'
    ],
    'n/a'
  );
  const createdAt = resolveField(
    order,
    ['created_at', 'createdAt', 'created_date', 'created', 'date_created'],
    'n/a'
  );

  return `${index + 1}. Order ${id} | status: ${status} | total: ${total} | created_at: ${createdAt}`;
};

const run = async () => {
  try {
    const token = process.env.ROZETKA_API_TOKEN;
    if (!token) {
      throw new Error('Missing ROZETKA_API_TOKEN environment variable.');
    }

    const service = new RozetkaService({
      token,
      baseUrl: process.env.ROZETKA_BASE_URL
    });

    const skipTokenCheck = process.env.ROZETKA_SKIP_TOKEN_CHECK === 'true';
    if (!skipTokenCheck) {
      await service.checkToken();
    }

    const perPage = parsePositiveInt(
      process.env.ROZETKA_ORDER_LIMIT,
      DEFAULT_LIMIT,
      MAX_LIMIT
    );
    const page = parsePositiveInt(process.env.ROZETKA_ORDER_PAGE, 1);
    const expand = process.env.ROZETKA_EXPAND || 'user,delivery,purchases';

    const orders = await service.fetchRecentOrders({
      perPage,
      page,
      expand,
      debug: process.env.ROZETKA_DEBUG === 'true'
    });

    if (!Array.isArray(orders) || orders.length === 0) {
      console.log('Orders not found.');
      return;
    }

    console.log(`Rozetka orders (page ${page}, limit ${Math.min(perPage, orders.length)}):`);
    orders.forEach((order, index) => {
      console.log(formatOrder(order, index));
      console.dir(order, { depth: null });
      console.log('');
    });
  } catch (error) {
    if (error.response) {
      const { status, data } = error.response;
      console.error(`Rozetka API error ${status}:`, data);
      return;
    }

    console.error('Failed to fetch Rozetka orders:', error.message);
    process.exitCode = 1;
  }
};

run();
