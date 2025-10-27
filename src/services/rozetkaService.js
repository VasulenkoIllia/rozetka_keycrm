const axios = require('axios');

const DEFAULT_BASE_URL = 'https://api-seller.rozetka.com.ua/';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_PER_PAGE = 10;
const MAX_PER_PAGE = 100;

const ensureTrailingSlash = (url) => {
  if (!url) {
    return DEFAULT_BASE_URL;
  }
  return url.endsWith('/') ? url : `${url}/`;
};

const extractOrders = (payload, visited = new WeakSet()) => {
  if (!payload || typeof payload !== 'object') {
    return [];
  }

  if (visited.has(payload)) {
    return [];
  }
  visited.add(payload);

  if (Array.isArray(payload)) {
    if (payload.length === 0) {
      return [];
    }

    if (payload.every((item) => item && typeof item === 'object')) {
      return payload;
    }

    return [];
  }

  const candidateKeys = [
    'orders',
    'data',
    'result',
    'content',
    'items',
    'list',
    'rows'
  ];

  for (const key of candidateKeys) {
    if (Object.prototype.hasOwnProperty.call(payload, key)) {
      const nested = extractOrders(payload[key], visited);
      if (nested.length > 0) {
        return nested;
      }
    }
  }

  for (const value of Object.values(payload)) {
    const nested = extractOrders(value, visited);
    if (nested.length > 0) {
      return nested;
    }
  }

  return [];
};

class RozetkaService {
  constructor({ token, baseUrl, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    if (!token) {
      throw new Error('Rozetka API token is required');
    }

    this.client = axios.create({
      baseURL: ensureTrailingSlash(baseUrl || DEFAULT_BASE_URL),
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout
    });
  }

  async checkToken() {
    await this.client.post('token/check');
    return true;
  }

  async fetchRecentOrders({
    perPage = DEFAULT_PER_PAGE,
    page = 1,
    expand = 'user,delivery,purchases',
    params: extraParams = {},
    debug = false
  } = {}) {
    const safePerPage = Math.max(
      1,
      Math.min(perPage || DEFAULT_PER_PAGE, MAX_PER_PAGE)
    );

    const response = await this.client.get('orders/search', {
      params: {
        page,
        per_page: safePerPage,
        expand,
        ...extraParams
      }
    });

    const { data } = response;

    if (debug) {
      console.dir(
        { rozetkaRawResponse: data },
        { depth: null, maxArrayLength: 10 }
      );
    }

    return extractOrders(data);
  }
}

module.exports = RozetkaService;
