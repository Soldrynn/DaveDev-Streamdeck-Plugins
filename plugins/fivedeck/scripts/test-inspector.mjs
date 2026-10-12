import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const source = readFileSync(`${root}/com.davedev.fivedeck.sdPlugin/ui/fivedeck.js`, 'utf8');
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
function harness(withPanel = true) {
  const timers = new Map();
  const intervals = [];
  let timerId = 0;
  const listeners = [];
  const calls = [];
  const global = { clientInstance: 'primary' };
  const settings = { mode: 'press' };
  const node = (dataset = {}) => ({ dataset, textContent: '', hidden: false, disabled: false, events: {}, addEventListener(event, fn) { this.events[event] = fn; }, getAttribute(name) { return this[name]; } });
  const panel = node();
  const title = node();
  const message = node();
  const instance = node();
  const transmission = node();
  const button = node();
  const client = node(); client.setting = 'clientInstance'; client.value = 'primary';
  const field = node(); field.setting = 'commands';
  const conditional = node({ when: 'mode', is: 'toggle', default: 'press' });
  const nodes = { '[data-connection-status]': withPanel ? panel : null, '[data-connection-title]': title, '[data-connection-message]': message, '[data-connection-instance]': instance, '[data-connection-transmission]': transmission, '[data-connection-test]': button };
  let rejectNext = false;
  runInNewContext(source, {
    window: { SDPIComponents: {
      streamDeckClient: { message: { subscribe(fn) { listeners.push(fn); } }, async send(event, payload) { calls.push({ event, payload }); if (rejectNext) { rejectNext = false; throw new Error('offline'); } } },
      useSettings: name => [async () => settings[name]], useGlobalSettings: name => [async () => global[name]]
    } },
    document: { querySelector: selector => nodes[selector], querySelectorAll: selector => selector === '[data-when]' ? [conditional] : selector === '[setting]' ? [client, field] : [] },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, delay }); return id; }, clearTimeout(id) { timers.delete(id); }, setInterval(fn) { intervals.push(fn); }, Date, Map, Number, Object, String
  });
  return { panel, title, message, instance, transmission, button, client, field, conditional, calls, global, settings, timers, intervals, emit: message => listeners.forEach(fn => fn(message)), reject: () => rejectNext = true, async tick(delay) { for (const [id, timer] of [...timers]) if (timer.delay === delay) { timers.delete(id); timer.fn(); } await flush(); } };
}
const h = harness(); await flush();
assert.equal(h.calls.length, 1);
assert.equal(h.calls[0].payload.event, 'connection-status');
assert.equal(h.conditional.hidden, true);
h.settings.mode = 'toggle'; h.intervals[0](); await flush(); assert.equal(h.conditional.hidden, false);
let now = Date.now();
const status = (phase, at = ++now, clientInstance = 'primary', message = phase) => h.emit({ event: 'sendToPropertyInspector', payload: { event: 'connection-status', phase, at, clientInstance, message } });
status('idle'); assert.equal(h.title.textContent, 'No connection result yet');
status('connecting'); assert.equal(h.panel.dataset.tone, 'warn');
status('ready'); assert.equal(h.title.textContent, 'FiveM responded'); assert(!h.title.textContent.includes('Connected'));
status('transmitted', ++now, 'primary', '<img src=x onerror=alert(1)>');
assert.equal(h.message.textContent, '<img src=x onerror=alert(1)>');
assert.match(h.transmission.textContent, /Execution is not confirmed/);
const sentText = h.transmission.textContent;
status('disconnected'); assert.equal(h.panel.dataset.tone, 'bad'); assert.equal(h.transmission.textContent, sentText);
status('ready', now - 10); assert.equal(h.title.textContent, 'Connection unavailable');
status('ready', now + 1, 'secondary'); assert.equal(h.title.textContent, 'Connection unavailable');
status('nonsense'); assert.equal(h.title.textContent, 'Connection unavailable');
status('ready', NaN); assert.equal(h.title.textContent, 'Connection unavailable');
status('ready', ++now, 'primary', {}); assert.equal(h.title.textContent, 'Connection unavailable');
h.button.events.click(); h.button.events.click(); await flush();
assert.equal(h.calls.filter(c => c.payload.event === 'connection-test').length, 1); assert.equal(h.button.disabled, true);
status('idle', 1); assert.equal(h.button.disabled, true);
status('ready', now + 100); assert.equal(h.button.disabled, false);
h.global.clientInstance = h.client.value = 'secondary'; h.client.events.valuechange();
assert.match(h.instance.textContent, /29300/); assert.match(h.transmission.textContent, /No command/);
status('ready', now + 200, 'primary'); assert.equal(h.title.textContent, 'Checking connection status…');
await h.tick(350); assert.equal(h.calls.at(-1).payload.event, 'connection-status');
status('ready', now + 201, 'secondary'); assert.equal(h.title.textContent, 'FiveM responded');
h.button.events.click(); await flush(); const count = h.calls.length; await h.tick(10000);
assert.equal(h.button.disabled, false); assert.equal(h.title.textContent, 'Status unavailable'); assert.equal(h.calls.length, count);
h.reject(); h.button.events.click(); await flush(); assert.equal(h.button.disabled, false); assert.equal(h.title.textContent, 'Status unavailable');
h.global.clientInstance = 'primary'; h.emit({ event: 'didReceiveGlobalSettings', payload: { settings: h.global } }); await h.tick(350);
assert.match(h.instance.textContent, /29200/); assert.equal(h.transmission.textContent, sentText);
h.field.events.valuechange(); await h.tick(350); assert.equal(h.calls.at(-1).payload.event, 'connection-status');
assert(h.calls.every(c => c.event === 'sendToPlugin' && ['connection-status', 'connection-test'].includes(c.payload.event)));
// Changing the visible client then immediately testing must never silently test the old
// saved target. Do not tick the debounce timer or commit global settings before this click.
const race = harness(); await flush();
race.client.value = 'secondary'; race.client.events.valuechange();
assert.equal(race.global.clientInstance, 'primary', 'global settings have not committed yet');
race.button.events.click(); await flush();
assert.equal(race.calls.at(-1).payload.event, 'connection-test');
assert.equal(race.calls.at(-1).payload.clientInstance, 'secondary', 'test pins the visible selection');
assert.match(race.instance.textContent, /29300/);
// The backend refuses the stale target without connecting, and addresses its result to
// the requested instance. The inspector should show it immediately, not time out.
race.emit({ event: 'sendToPropertyInspector', payload: {
  event: 'connection-status', phase: 'idle', clientInstance: 'secondary',
  at: Date.now() + 100, message: 'Saving client selection; wait and test again.'
} });
assert.equal(race.button.disabled, false);
assert.equal(race.message.textContent, 'Saving client selection; wait and test again.');
const raceCount = race.calls.length;
await race.tick(10000);
assert.equal(race.calls.length, raceCount, 'mismatch does not automatically retry');
assert.equal(race.message.textContent, 'Saving client selection; wait and test again.');
// After the settings commit, another deliberate test still carries the chosen target.
race.global.clientInstance = 'secondary';
race.emit({ event: 'didReceiveGlobalSettings', payload: { settings: race.global } });
await race.tick(350);
race.button.events.click(); await flush();
assert.equal(race.calls.at(-1).payload.clientInstance, 'secondary');
assert(h.calls.filter(c => c.payload.event === 'connection-test').every(c => ['primary', 'secondary'].includes(c.payload.clientInstance)));
const chat = harness(false); await flush(); assert.equal(chat.calls.length, 0);
for (const page of ['command', 'emote', 'toggle', 'dial', 'join', 'launch']) {
  const html = readFileSync(`${root}/com.davedev.fivedeck.sdPlugin/ui/${page}.html`, 'utf8');
  assert(html.includes('data-connection-status'), page);
  assert(html.indexOf('data-connection-status') < html.indexOf('<details'), `${page} status visible above advanced`);
  assert(html.includes('data-connection-test'), `${page} test button`);
  assert(html.includes('setting="clientInstance" default="primary" global'), `${page} global client`);
  assert(!/setting="(?:transport|bridgeKey|autoBridge|consoleKey|chatKey|inputDelayMs|focusGame)"/.test(html), `${page} no typing/bridge controls`);
  assert(html.includes('in-game validation'), `${page} preview caveat`);
}
for (const page of ['chat', 'key']) {
  const html = readFileSync(`${root}/com.davedev.fivedeck.sdPlugin/ui/${page}.html`, 'utf8');
  assert(!html.includes('data-connection-test'));
  assert(html.includes('setting="focusGame"'));
  assert(!html.includes('bridge-install'));
}
console.log('Passed inspector tests: status phases, text safety, stale events, instance switches, immediate-test target pinning, repeated test clicks, timeout/error recovery, settings refresh, no command execution, conditional fields, and generated action separation.');
