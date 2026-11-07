const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const workerUrl = process.env.WORKER_URL;
if (!token || !secret || !workerUrl) throw new Error('Задайте TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET и WORKER_URL.');
const base = new URL(workerUrl);
if (base.protocol !== 'https:') throw new Error('WORKER_URL должен использовать HTTPS.');

async function api(method, payload) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(`Telegram ${method}: ошибка ${result?.error_code || response.status}`);
  return result.result;
}

const me = await api('getMe', {});
if (me.username !== 'DWHelperUpdates_bot') throw new Error('Токен принадлежит другому боту.');
await api('setMyCommands', { commands: [
  { command: 'update', description: 'Скачать новое расширение' },
  { command: 'extension', description: 'Расширение для Kiwi' },
  { command: 'apk', description: 'Установщик Android' },
  { command: 'version', description: 'Текущие версии' }
] });
await api('setWebhook', {
  url: new URL('/webhook', base).href,
  secret_token: secret,
  allowed_updates: ['message'],
  drop_pending_updates: false
});
console.log(`Webhook настроен для @${me.username}.`);
