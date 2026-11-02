# Kuponi LV — push-сервер (Cloudflare Worker, бесплатный тариф)

Отправляет утреннее уведомление в **08:00 по Риге**. Push приходит без содержимого,
service worker приложения сам загружает свежий `coupons.json` и показывает топ-5 и
напоминание об истекающих купонах (с учётом «моих магазинов» и избранного).

## Установка (один раз, ~10 минут)

```bash
cd kuponi
npm run vapid                       # 1. ключи: публичный + приватный JWK
cd worker
npx wrangler login                  # 2. вход в бесплатный аккаунт Cloudflare
npx wrangler kv namespace create SUBS   # 3. вставьте id в wrangler.toml
npx wrangler secret put VAPID_PRIVATE_JWK   # 4. вставьте приватный JWK (одной строкой)
#    в wrangler.toml: VAPID_PUBLIC_KEY = "<публичный ключ>", VAPID_SUBJECT = "mailto:ваш@email"
npx wrangler deploy                 # 5. получите адрес https://kuponi-push.<you>.workers.dev
```

6. В `kuponi/web/config.js` впишите `pushServer: 'https://kuponi-push.<you>.workers.dev'`
   и `vapidPublicKey: '<публичный ключ>'`, закоммитьте.
7. В приложении: «Ещё» → «Включить уведомления».

Проверка: `curl https://kuponi-push.<you>.workers.dev/health`.

Лимиты бесплатного тарифа (100 000 запросов/день, KV 1 000 записей/день) с огромным запасом
покрывают личное использование. Приватный ключ хранится только в секретах Worker.
