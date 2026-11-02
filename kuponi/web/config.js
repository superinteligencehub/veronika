// Публичная конфигурация клиента (здесь НЕТ секретов — только публичные значения).
// Подходит и для страницы, и для service worker (importScripts).
self.KUPONI_CONFIG = {
  // Данные, которые собирает GitHub Actions
  dataUrl: '../data/coupons.json',
  // Адрес Cloudflare Worker для push-уведомлений (см. worker/README.md). Пусто — push не настроен.
  pushServer: '',
  // Публичный VAPID-ключ (base64url) из `npm run vapid`. Приватный ключ — только в секретах Worker.
  vapidPublicKey: '',
  // Альтернатива без сервера: тема ntfy.sh, в которую GitHub Actions отправляет утренний топ (см. README).
  ntfyTopic: 'kuponi-lv-d4208b90d063',
};
