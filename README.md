# Rozetka ↔ KeyCRM Sync Toolkit

Мінімальний сервіс для перегляду, зіставлення та синхронізації замовлень між Rozetka і KeyCRM. Є CLI-скрипти, бекенд на Express і простий фронтенд для моніторингу.

## Залежності

- Node.js 18+
- Доступ до API Rozetka (`ROZETKA_API_TOKEN`)
- Доступ до KeyCRM OpenAPI (`KEYCRM_API_KEY`)

## Запуск

1. Створіть `.env` (можна зкопіювати `sample.env`, див. приклад нижче).
2. Встановіть залежності:
   ```bash
   npm install
   ```
3. Запустіть локальний сервер:
   ```bash
   npm run serve
   ```
4. Відкрийте `http://localhost:3000/` для перегляду замовлень або `http://localhost:3000/webhooks.html` для моніторингу вебхуків.

## Обов’язкові змінні середовища

| Змінна | Опис |
| --- | --- |
| `ROZETKA_API_TOKEN` | Токен продавця Rozetka |
| `KEYCRM_API_KEY` | OpenAPI токен KeyCRM |
| `KEYCRM_WEBHOOK_SECRET` | Секрет для перевірки підпису вебхуків KeyCRM (обов’язково, інакше вебхук приймає всі запити) |

## Додаткові налаштування

| Змінна | Значення за замовчуванням | Опис |
| --- | --- | --- |
| `ROZETKA_BASE_URL` | `https://api-seller.rozetka.com.ua/` | Кастомна база Rozetka |
| `KEYCRM_BASE_URL` | `https://openapi.keycrm.app/v1/` | База KeyCRM |
| `ROZETKA_ORDER_LIMIT` | `20` | Максимум замовлень на сторінку основних запитів |
| `COMBINED_KEYCRM_LIMIT` | `20` | Максимум замовлень KeyCRM у комбінованому запиті |
| `ROZETKA_SEARCH_MAX_PAGES` | `5` | Скільки сторінок глибше шукати «старі» замовлення Rozetka |
| `ROZETKA_SEARCH_PAGE_SIZE` | `100` | Скільки замовлень читати на сторінку при fallback-пошуку |
| `KEYCRM_SEARCH_MAX_ATTEMPTS` | `5` | Скільки різних ідентифікаторів напряму пробувати в KeyCRM |
| `KEYCRM_INCLUDE` | _порожньо_ | Додаткові `include` для `order` (наприклад, `buyer,status`) |

## Приклад `sample.env`

```env
# Rozetka
ROZETKA_API_TOKEN=your_rozetka_token
ROZETKA_BASE_URL=https://api-seller.rozetka.com.ua/
ROZETKA_ORDER_LIMIT=50
ROZETKA_SEARCH_MAX_PAGES=5
ROZETKA_SEARCH_PAGE_SIZE=100

# KeyCRM
KEYCRM_API_KEY=your_keycrm_api_key
KEYCRM_BASE_URL=https://openapi.keycrm.app/v1/
KEYCRM_WEBHOOK_SECRET=super-secret-token
KEYCRM_INCLUDE=buyer,status
COMBINED_KEYCRM_LIMIT=30
KEYCRM_SEARCH_MAX_ATTEMPTS=5

# Server
PORT=3000
```

Пам’ятайте вказати `KEYCRM_WEBHOOK_SECRET` і передати той самий токен у налаштуваннях вебхука KeyCRM (можна передавати в заголовку `x-keycrm-webhook-token` або параметром `?token=`).

## Docker / Docker Compose

### Швидкий старт на VPS

1. Заповніть `.env` на сервері (мінімум `ROZETKA_API_TOKEN`, `KEYCRM_API_KEY`, `KEYCRM_WEBHOOK_SECRET`).
2. Запустіть:
   ```bash
   docker compose up -d --build
   ```
3. Сервіс буде доступний на `http://<ваш сервер>:3006/` (в контейнері продовжує працювати на 3000 порту).

### Dockerfile

Стандартний `Dockerfile` будує production-образ на базі `node:18-alpine`, копіює додаток, встановлює тільки runtime-залежності та запускає `node src/server.js`.

### Оновлення

Для оновлення застосуйте нові зміни і перебілдьте контейнер:

```bash
docker compose up -d --build
```

## Моніторинг вебхуків

- На головній сторінці у картці «Моніторинг вебхуків» видно останню статичну статистику.
- Детальний журнал, автооновлення, розкладка payload’ів та debug знаходяться на `/webhooks.html`.
- Окрема картка «Лог помилок» показує останні помилки та попередження (дані зберігаються у `logs/error-log.jsonl` і переживають перезапуск сервера).

## Скріпти

| Скрипт | Опис |
| --- | --- |
| `npm run serve` | Запуск серверу (Express + статичний фронт) |
| `npm run fetch:orders` | Отримати останні замовлення із KeyCRM в CLI |
| `npm run fetch:rozetka` | Отримати замовлення Rozetka в CLI |
| `npm run fetch:combined` | Порівняти замовлення CrM та Rozetka в CLI |
| `npm run sync:rozetka-link` | Запустити синхронізацію посилань вручну |

## Безпека

- Всі вебхуки перевіряються по `KEYCRM_WEBHOOK_SECRET`. Запити без правильного токена отримують `401`.
- Черга обробки має ліміти повторних спроб та зберігає лише стислий debug (без чутливих полів).

## Ліцензія

MIT
```
