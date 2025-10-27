const fs = require('node:fs');
const path = require('node:path');

const LOG_DIR = path.join(__dirname, '..', '..', 'logs');
const LOG_FILE = path.join(LOG_DIR, 'error-log.jsonl');
const CACHE_LIMIT = 200;

let cache = [];

const ensureLogFile = () => {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }

  if (!fs.existsSync(LOG_FILE)) {
    fs.writeFileSync(LOG_FILE, '', 'utf8');
  }
};

const loadInitial = () => {
  try {
    if (!fs.existsSync(LOG_FILE)) {
      ensureLogFile();
      return;
    }

    const content = fs.readFileSync(LOG_FILE, 'utf8');
    const lines = content
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);

    const entries = lines
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch (error) {
          return null;
        }
      })
      .filter(Boolean);

    cache = entries.slice(-CACHE_LIMIT);
  } catch (error) {
    cache = [];
  }
};

const appendToFile = (entry) => {
  ensureLogFile();
  try {
    fs.appendFile(LOG_FILE, `${JSON.stringify(entry)}\n`, (error) => {
      if (error) {
        // eslint-disable-next-line no-console
        console.error('Failed to append to error log:', error.message);
      }
    });
  } catch (error) {
    // eslint-disable-next-line no-console
    console.error('Failed to write to error log:', error.message);
  }
};

const addEntry = ({
  level = 'error',
  message,
  context = {},
  source = 'unknown'
} = {}) => {
  if (!message) {
    return;
  }

  const entry = {
    level,
    message,
    context,
    source,
    timestamp: new Date().toISOString()
  };

  cache.push(entry);
  if (cache.length > CACHE_LIMIT) {
    cache = cache.slice(-CACHE_LIMIT);
  }

  appendToFile(entry);
};

const getEntries = (limit = 100) => {
  const safeLimit = Math.max(1, Math.min(limit, CACHE_LIMIT));
  return cache.slice(-safeLimit).reverse();
};

const logError = (message, options = {}) => {
  addEntry({ level: 'error', message, ...options });
};

const logWarning = (message, options = {}) => {
  addEntry({ level: 'warning', message, ...options });
};

const logInfo = (message, options = {}) => {
  addEntry({ level: 'info', message, ...options });
};

ensureLogFile();
loadInitial();

module.exports = {
  logError,
  logWarning,
  logInfo,
  getEntries
};
