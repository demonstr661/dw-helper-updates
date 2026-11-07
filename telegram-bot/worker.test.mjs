import assert from 'node:assert/strict';
import worker from './worker.js';

const channel = {
  schemaVersion: 1,
  extension: {
    version: '1.58.0',
    url: 'https://raw.githubusercontent.com/demonstr661/dw-helper-updates/main/DW-Helper-1.58.0-Kiwi.zip',
    sha256: '7db4c24a296dfd01199f85a9be5ece94f5a947c73352c4380af744bff2de00ed',
    notes: 'Постоянный автобой и капча'
  },
  installer: {
    version: '3.3.5',
    url: 'https://raw.githubusercontent.com/demonstr661/dw-helper-updates/main/DW-Helper-3.3.5.apk',
    sha256: '56f51de37cf53d33beb925a264adb075434a4d16568aa9f763a683539c1a461f',
    notes: 'APK не изменён'
  }
};
const env = {
  TELEGRAM_BOT_TOKEN: 'TEST_SERVER_TOKEN',
  TELEGRAM_WEBHOOK_SECRET: 'TEST_WEBHOOK_SECRET',
  UPDATES_URL: 'https://raw.githubusercontent.com/demonstr661/dw-helper-updates/main/updates.json'
};
const results = [];

function test(name, condition) {
  assert.ok(condition, name);
  results.push(name);
  console.log(`OK ${name}`);
}

function request(text = '/version', secret = 'TEST_WEBHOOK_SECRET') {
  return new Request('https://worker.example/webhook', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: JSON.stringify({ message: { chat: { id: 123 }, text } })
  });
}

function fetchMock(calls, channelValue = channel) {
  return async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url) === env.UPDATES_URL) {
      return new Response(JSON.stringify(channelValue), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    return new Response(JSON.stringify({ ok: true, result: { message_id: calls.length } }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    });
  };
}

async function command(text, channelValue = channel) {
  const calls = [];
  const response = await worker.fetch(request(text), env, null, fetchMock(calls, channelValue));
  return { calls, response };
}

{
  const response = await worker.fetch(new Request('https://worker.example/'), env, null, fetchMock([]));
  test('health endpoint responds without Telegram token', response.status === 200 && (await response.text()).includes('DWHelperUpdates_bot'));
}
{
  const calls = [];
  const response = await worker.fetch(request('/update', 'wrong'), env, null, fetchMock(calls));
  test('wrong webhook secret is rejected before any request', response.status === 403 && calls.length === 0);
}
{
  const { calls, response } = await command('/version');
  const body = JSON.parse(calls.at(-1).options.body);
  test('version command reads both current releases', response.status === 200 && body.text.includes('1.58.0') && body.text.includes('3.3.5'));
  test('version response never exposes server token', !calls.at(-1).options.body.includes(env.TELEGRAM_BOT_TOKEN));
}
{
  const { calls } = await command('/update');
  const body = JSON.parse(calls.at(-1).options.body);
  test('update sends current extension document from GitHub', calls.at(-1).url.endsWith('/sendDocument') && body.document === channel.extension.url && body.caption.includes('1.58.0'));
}
{
  const { calls } = await command('/extension@DWHelperUpdates_bot');
  test('extension alias works with bot username', JSON.parse(calls.at(-1).options.body).document === channel.extension.url);
}
{
  const { calls } = await command('/apk');
  const body = JSON.parse(calls.at(-1).options.body);
  test('apk command keeps the unchanged 3.3.5 installer', body.document === channel.installer.url && body.caption.includes('3.3.5'));
}
{
  const { calls } = await command('/start');
  test('start requires no channel fetch and lists commands', calls.length === 1 && JSON.parse(calls[0].options.body).text.includes('/update'));
}
{
  const { calls } = await command('/unknown');
  test('unknown command is ignored without API calls', calls.length === 0);
}
{
  const invalid = structuredClone(channel);
  invalid.extension.url = 'http://example.invalid/extension.zip';
  const { calls } = await command('/update', invalid);
  test('non-HTTPS release is rejected and never sent as document', calls.length === 2 && calls.at(-1).url.endsWith('/sendMessage') && !calls.some(call => call.url.endsWith('/sendDocument')));
}
{
  const invalid = structuredClone(channel);
  invalid.installer.sha256 = 'bad';
  const { calls } = await command('/apk', invalid);
  test('invalid release checksum fails closed', calls.length === 2 && !calls.some(call => call.url.endsWith('/sendDocument')));
}
{
  const response = await worker.fetch(new Request('https://worker.example/webhook', {
    method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': env.TELEGRAM_WEBHOOK_SECRET }, body: '{bad'
  }), env, null, fetchMock([]));
  test('malformed Telegram JSON returns HTTP 400', response.status === 400);
}

console.log(`\nTelegram bot: ${results.length}/${results.length} checks passed`);
