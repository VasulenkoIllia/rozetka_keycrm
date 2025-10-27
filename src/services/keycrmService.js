const axios = require('axios');

const DEFAULT_BASE_URL = 'https://openapi.keycrm.app/v1/';
const DEFAULT_TIMEOUT_MS = 10000;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

const ensureTrailingSlash = (url) => {
  if (!url) {
    return DEFAULT_BASE_URL;
  }
  return url.endsWith('/') ? url : `${url}/`;
};

class KeyCRMService {
  constructor({ apiKey, baseUrl, timeout = DEFAULT_TIMEOUT_MS } = {}) {
    if (!apiKey) {
      throw new Error('KeyCRM API token is required');
    }

    this.client = axios.create({
      baseURL: ensureTrailingSlash(baseUrl || DEFAULT_BASE_URL),
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: 'application/json'
      },
      timeout
    });
  }

  async fetchRecentOrders(limit = DEFAULT_LIMIT, options = {}) {
    const safeLimit = Math.max(1, Math.min(limit || DEFAULT_LIMIT, MAX_LIMIT));
    const params = {
      limit: safeLimit,
      page: 1,
      sort: '-created_at',
      ...options
    };

    const response = await this.client.get('order', {
      params: {
        ...params
      }
    });

    const { data } = response;

    if (!data) {
      return [];
    }

    if (Array.isArray(data.data)) {
      return data.data;
    }

    if (Array.isArray(data.orders)) {
      return data.orders;
    }

    if (Array.isArray(data)) {
      return data;
    }

    return [];
  }

  async updateOrder(orderId, payload = {}) {
    if (!orderId) {
      throw new Error('orderId is required to update KeyCRM order');
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new Error('payload must be an object for KeyCRM order update');
    }

    await this.client.put(`order/${orderId}`, payload);
    return true;
  }

  async fetchOrderById(orderId, params = {}) {
    if (!orderId) {
      throw new Error('orderId is required to fetch KeyCRM order');
    }

    const response = await this.client.get(`order/${orderId}`, {
      params
    });

    const { data } = response;

    if (!data) {
      return null;
    }

    if (data.data && typeof data.data === 'object') {
      return data.data;
    }

    return data;
  }
}

module.exports = KeyCRMService;
