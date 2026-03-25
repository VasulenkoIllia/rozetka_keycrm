const process = require('node:process');

require('dotenv').config();

const express = require('express');
const webhookQueue = require('./services/webhookQueue');
const errorLog = require('./services/errorLog');

const app = express();
const port = Number.parseInt(process.env.PORT, 10) || 3000;

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString()
  });
});

app.post('/webhooks/keycrm', (req, res) => {
  if (!req.body || typeof req.body !== 'object') {
    return res.status(400).json({
      success: false,
      message: 'Webhook payload must be a JSON object.'
    });
  }

  const secret = process.env.KEYCRM_WEBHOOK_SECRET;
  const eventType = req.headers['x-keycrm-event'] || req.body?.event || null;
  if (secret) {
    const tokenHeader =
      req.headers['x-keycrm-webhook-token'] ||
      req.headers['x-webhook-token'] ||
      req.headers['x-keycrm-token'];
    const tokenQuery = typeof req.query?.token === 'string' ? req.query.token : null;
    const provided =
      (typeof tokenHeader === 'string' ? tokenHeader.trim() : null) ||
      (tokenHeader && Array.isArray(tokenHeader) ? tokenHeader[0] : null) ||
      (tokenQuery ? tokenQuery.trim() : null);

    if (!provided || provided !== secret) {
      errorLog.logWarning('Rejected webhook: invalid token', {
        source: 'webhookEndpoint',
        context: {
          ip: req.ip,
          eventType,
          hasHeaderToken: Boolean(tokenHeader),
          hasQueryToken: Boolean(tokenQuery)
        }
      });
      return res.status(401).json({
        success: false,
        message: 'Unauthorized webhook request.'
      });
    }
  }

  const candidateOrder = req.body?.order || req.body;
  const keycrmOrderId =
    candidateOrder?.id ||
    candidateOrder?.order_id ||
    candidateOrder?.orderId ||
    null;

  let payload = req.body;
  try {
    payload = JSON.parse(JSON.stringify(req.body));
  } catch (error) {
    payload = { ...req.body };
  }

  if (payload && typeof payload === 'object') {
    delete payload.token;
  }

  const jobId = webhookQueue.enqueue(payload, {
    eventType,
    keycrmOrderId,
    receivedAt: new Date().toISOString()
  });

  res.json({
    success: true,
    jobId
  });
});

app.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Not found.'
  });
});

app.listen(port, () => {
  const hasWebhookSecret = Boolean(process.env.KEYCRM_WEBHOOK_SECRET);

  console.log(`Combined orders viewer listening on http://localhost:${port}`);
  if (!hasWebhookSecret) {
    const warningMessage =
      'KEYCRM_WEBHOOK_SECRET is not set. Webhook endpoint accepts requests without authentication.';
    console.warn(`Warning: ${warningMessage}`);
    errorLog.logWarning(warningMessage, {
      source: 'server'
    });
  }
});
