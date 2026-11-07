const HELP = 'Команды:\n/update — новое расширение для Kiwi\n/extension — расширение для Kiwi\n/apk — установщик Android\n/version — версии и описание обновлений';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
}

function validRelease(release) {
  if (!release || typeof release !== 'object') return false;
  try {
    const url = new URL(release.url);
    return /^[0-9A-Za-z._-]{1,40}$/.test(release.version || '')
      && /^[a-f0-9]{64}$/i.test(release.sha256 || '')
      && url.protocol === 'https:' && url.hostname === 'raw.githubusercontent.com';
  } catch (_) {
    return false;
  }
}

async function readChannel(env, fetchImpl) {
  const response = await fetchImpl(env.UPDATES_URL, {
    headers: { Accept: 'application/json' },
    cache: 'no-store'
  });
  if (!response.ok) throw new Error('CHANNEL_HTTP');
  const channel = await response.json();
  if (channel?.schemaVersion !== 1 || !validRelease(channel.extension) || !validRelease(channel.installer)) {
    throw new Error('CHANNEL_SCHEMA');
  }
  return channel;
}

async function telegram(env, method, payload, fetchImpl) {
  if (!env.TELEGRAM_BOT_TOKEN) throw new Error('BOT_CONFIG');
  const response = await fetchImpl(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error('TELEGRAM_API');
  return result.result;
}

async function replyWithRelease(env, chatId, release, kind, fetchImpl) {
  const label = kind === 'extension' ? 'Расширение DW Helper для Kiwi' : 'Установщик DW Helper для Android';
  return telegram(env, 'sendDocument', {
    chat_id: chatId,
    document: release.url,
    caption: `${label}\nВерсия ${release.version}\nSHA-256: ${release.sha256}`
  }, fetchImpl);
}

async function handleCommand(env, message, fetchImpl) {
  const chatId = message?.chat?.id;
  const text = typeof message?.text === 'string' ? message.text.trim() : '';
  if (chatId === undefined || !text.startsWith('/')) return;
  const command = text.split(/\s+/, 1)[0].toLocaleLowerCase('en').split('@')[0];
  if (!['/start', '/help', '/update', '/extension', '/apk', '/version'].includes(command)) return;
  if (command === '/start' || command === '/help') {
    await telegram(env, 'sendMessage', { chat_id: chatId, text: `DW Helper — официальные обновления.\n\n${HELP}` }, fetchImpl);
    return;
  }
  const channel = await readChannel(env, fetchImpl);
  if (command === '/version') {
    await telegram(env, 'sendMessage', {
      chat_id: chatId,
      text: `Расширение: ${channel.extension.version}\n${channel.extension.notes || ''}\n\nAPK: ${channel.installer.version}\n${channel.installer.notes || ''}`
    }, fetchImpl);
    return;
  }
  const kind = command === '/apk' ? 'installer' : 'extension';
  await replyWithRelease(env, chatId, channel[kind], kind, fetchImpl);
}

export default {
  async fetch(request, env, _ctx, fetchImpl = fetch) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/') return new Response('DWHelperUpdates_bot: OK', { status: 200 });
    if (url.pathname !== '/webhook' || request.method !== 'POST') return json({ ok: false }, 404);
    if (!env.TELEGRAM_WEBHOOK_SECRET || request.headers.get('X-Telegram-Bot-Api-Secret-Token') !== env.TELEGRAM_WEBHOOK_SECRET) {
      return json({ ok: false }, 403);
    }
    if (Number(request.headers.get('Content-Length') || 0) > 100000) return json({ ok: false }, 413);
    let update;
    try {
      update = await request.json();
    } catch (_) {
      return json({ ok: false }, 400);
    }
    try {
      await handleCommand(env, update?.message, fetchImpl);
    } catch (_) {
      const chatId = update?.message?.chat?.id;
      if (chatId !== undefined) {
        await telegram(env, 'sendMessage', {
          chat_id: chatId,
          text: 'Обновление временно недоступно. Попробуйте команду /update через минуту.'
        }, fetchImpl);
      }
    }
    return json({ ok: true });
  }
};
