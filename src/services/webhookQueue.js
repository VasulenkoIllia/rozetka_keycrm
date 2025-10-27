const crypto = require('node:crypto');

const { syncRozetkaLinkForPayload } = require('./rozetkaLinkSync');
const errorLog = require('./errorLog');

const DEFAULT_CONCURRENCY = Number.parseInt(
  process.env.WEBHOOK_QUEUE_CONCURRENCY,
  10
) || 3;
const DEFAULT_MAX_RETRIES = Number.parseInt(
  process.env.WEBHOOK_QUEUE_MAX_RETRIES,
  10
) || 3;
const DEFAULT_RETRY_DELAY_MS = Number.parseInt(
  process.env.WEBHOOK_QUEUE_RETRY_DELAY_MS,
  10
) || 1500;
const HISTORY_LIMIT = Number.parseInt(
  process.env.WEBHOOK_QUEUE_HISTORY_LIMIT,
  10
) || 25;
const MAX_PAYLOAD_PREVIEW_LENGTH = Number.parseInt(
  process.env.WEBHOOK_QUEUE_PAYLOAD_PREVIEW,
  10
) || 1000;

const delay = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

const makeJobId = () => crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;

const pickFirstNotEmpty = (record, fields = []) => {
  if (!record || typeof record !== 'object') {
    return null;
  }

  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(record, field)) {
      continue;
    }

    const value = record[field];
    if (value === undefined || value === null) {
      continue;
    }

    const str = String(value).trim();
    if (str.length > 0) {
      return str;
    }
  }

  return null;
};

const extractOrderCandidate = (payload) => {
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

const buildPayloadSummary = (payload) => {
  const order = extractOrderCandidate(payload) || {};

  const summary = {
    event: payload?.event ?? null,
    keycrmOrderId: pickFirstNotEmpty(order, ['id', 'order_id', 'orderId']) ?? null,
    rozetkaSourceUuid:
      pickFirstNotEmpty(order, ['source_uuid', 'global_source_uuid']) ?? null,
    number: pickFirstNotEmpty(order, ['number', 'order_number']) ?? null,
    rozetkaOrderId: pickFirstNotEmpty(order, ['order_id', 'id']) ?? null
  };

  return Object.fromEntries(
    Object.entries(summary).filter(([, value]) => value !== null && value !== undefined)
  );
};

const buildPayloadPreview = (payload) => {
  try {
    const json = JSON.stringify(payload);
    if (!json) {
      return null;
    }
    if (json.length <= MAX_PAYLOAD_PREVIEW_LENGTH) {
      return json;
    }
    return `${json.slice(0, MAX_PAYLOAD_PREVIEW_LENGTH)}…`;
  } catch (error) {
    return null;
  }
};

class WebhookQueue {
  constructor({
    handler,
    concurrency = DEFAULT_CONCURRENCY,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    historyLimit = HISTORY_LIMIT
  } = {}) {
    if (typeof handler !== 'function') {
      throw new Error('WebhookQueue requires a handler function');
    }

    this.handler = handler;
    this.concurrency = Math.max(1, concurrency);
    this.maxRetries = Math.max(0, maxRetries);
    this.retryDelayMs = Math.max(0, retryDelayMs);
    this.historyLimit = Math.max(1, historyLimit);

    this.pending = [];
    this.active = new Map();
    this.history = [];
    this.stats = {
      enqueued: 0,
      processed: 0,
      succeeded: 0,
      failed: 0,
      retried: 0
    };
  }

  enqueue(payload, context = {}) {
    const id = makeJobId();
    const enqueuedAt = new Date().toISOString();
    const payloadSummary = buildPayloadSummary(payload);
    const payloadPreview = buildPayloadPreview(payload);
    const job = {
      id,
      payload,
      context: {
        ...context,
        payloadSummary,
        payloadPreview
      },
      enqueuedAt,
      attempts: 0,
      status: 'queued'
    };

    this.pending.push(job);
    this.stats.enqueued += 1;
    this._schedule();

    return id;
  }

  getState() {
    const summarizeJob = (job) => ({
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      enqueuedAt: job.enqueuedAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      receivedAt: job.context?.receivedAt ?? job.enqueuedAt,
      keycrmOrderId: job.result?.keycrmOrderId ?? job.context?.keycrmOrderId ?? null,
      rozetkaOrderId: job.result?.rozetkaOrderId ?? null,
      updated: job.result?.updated ?? null,
      message: job.result?.reason ?? job.lastError ?? null,
      matchField: job.result?.matchField ?? null,
      matchValue: job.result?.matchValue ?? null,
      eventType: job.context?.eventType ?? null,
      summary: job.context?.payloadSummary ?? null,
      payloadPreview: job.context?.payloadPreview ?? null,
      debug: job.result?.debug ?? null,
      value: job.result?.value ?? null,
      urls: job.result?.urls ?? null
    });

    const active = Array.from(this.active.values()).map(summarizeJob);
    const pending = this.pending.map(summarizeJob);

    return {
      settings: {
        concurrency: this.concurrency,
        maxRetries: this.maxRetries,
        retryDelayMs: this.retryDelayMs,
        historyLimit: this.historyLimit
      },
      stats: { ...this.stats },
      active,
      pending,
      recent: this.history.slice()
    };
  }

  _schedule() {
    setImmediate(() => {
      this._drain();
    });
  }

  _drain() {
    while (this.active.size < this.concurrency && this.pending.length > 0) {
      const job = this.pending.shift();
      if (!job) {
        break;
      }
      this._start(job);
    }
  }

  async _start(job) {
    job.status = 'processing';
    job.startedAt = new Date().toISOString();
    job.attempts += 1;
    this.active.set(job.id, job);

    try {
      const result = await this.handler(job.payload, job.context, {
        attempts: job.attempts,
        id: job.id
      });
      job.result = result || null;
      if (result?.keycrmOrderId && !job.context.keycrmOrderId) {
        job.context.keycrmOrderId = result.keycrmOrderId;
      }
      if (result?.eventType && !job.context.eventType) {
        job.context.eventType = result.eventType;
      }
      job.status = 'completed';
      job.completedAt = new Date().toISOString();
      this.stats.processed += 1;
      this.stats.succeeded += 1;
      this._pushHistory(job);
    } catch (error) {
      job.lastError = error instanceof Error ? error.message : String(error);

      if (job.attempts <= this.maxRetries) {
        const delayMs = this.retryDelayMs * job.attempts;
        job.status = 'queued';
        job.retriedAt = new Date(Date.now() + delayMs).toISOString();
        this.stats.retried += 1;

        // Remove from active before scheduling retry
        this.active.delete(job.id);

        await delay(delayMs);
        this.pending.push(job);
        this._schedule();
        return;
      }

      job.status = 'failed';
      job.completedAt = new Date().toISOString();
      this.stats.processed += 1;
      this.stats.failed += 1;
      this._pushHistory(job);
    } finally {
      if (this.active.has(job.id)) {
        this.active.delete(job.id);
      }
      this._schedule();
    }
  }

  _pushHistory(job) {
    const entry = {
      id: job.id,
      status: job.status,
      attempts: job.attempts,
      enqueuedAt: job.enqueuedAt,
      startedAt: job.startedAt ?? null,
      completedAt: job.completedAt ?? null,
      keycrmOrderId: job.result?.keycrmOrderId ?? job.context?.keycrmOrderId ?? null,
      rozetkaOrderId: job.result?.rozetkaOrderId ?? null,
      updated: job.result?.updated ?? false,
      reason: job.result?.reason ?? null,
      matchField: job.result?.matchField ?? null,
      matchValue: job.result?.matchValue ?? null,
      error: job.lastError ?? null,
      eventType: job.context?.eventType ?? null,
      receivedAt: job.context?.receivedAt ?? job.enqueuedAt,
      urls: Array.isArray(job.result?.urls)
        ? job.result.urls.slice(0, 5)
        : null,
      value: job.result?.value ?? null,
      debug: job.result?.debug ?? null,
      summary: job.context?.payloadSummary ?? null,
      payloadPreview: job.context?.payloadPreview ?? null
    };

    this.history.unshift(entry);
    if (this.history.length > this.historyLimit) {
      this.history.length = this.historyLimit;
    }

    if (job.status === 'failed') {
      errorLog.logError('Webhook processing failed', {
        source: 'webhookQueue',
        context: {
          jobId: job.id,
          attempts: job.attempts,
          reason: job.lastError || job.result?.reason || null,
          eventType: job.context?.eventType || null,
          keycrmOrderId: entry.keycrmOrderId || null,
          rozetkaOrderId: entry.rozetkaOrderId || null
        }
      });
    } else if (
      job.status === 'completed' &&
      job.result &&
      job.result.updated === false &&
      job.result.reason
    ) {
      errorLog.logWarning('Webhook completed without update', {
        source: 'webhookQueue',
        context: {
          jobId: job.id,
          reason: job.result.reason,
          eventType: job.context?.eventType || null,
          keycrmOrderId: entry.keycrmOrderId || null,
          rozetkaOrderId: entry.rozetkaOrderId || null
        }
      });
    }
  }
}

const queue = new WebhookQueue({
  handler: async (payload, context = {}) => {
    const eventType = context.eventType ?? null;
    const augmentedContext = {
      ...context,
      eventType,
      keycrmOrderId: context.keycrmOrderId || null
    };

    const result = await syncRozetkaLinkForPayload(payload, process.env);

    if (!augmentedContext.keycrmOrderId && result?.keycrmOrderId) {
      augmentedContext.keycrmOrderId = result.keycrmOrderId;
    }

    return {
      ...result,
      eventType: augmentedContext.eventType,
      keycrmOrderId: augmentedContext.keycrmOrderId ?? result?.keycrmOrderId ?? null
    };
  }
});

module.exports = queue;
module.exports.WebhookQueue = WebhookQueue;
