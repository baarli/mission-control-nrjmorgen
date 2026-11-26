import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');

test('operation panels present unknown status until telemetry is available', () => {
  for (const id of ['dashboard', 'cron', 'system']) {
    const start = page.indexOf(`<div id="${id}" class="section`);
    assert.notEqual(start, -1, id);
    const section = page.slice(start).split(/<!--|<\/main>/, 1)[0];
    assert.ok(section.includes('Ubekreftet'), `${id} must show unverified status`);
    assert.ok(!/\bonline\b|operational|completed|99\.9%|42ms|04:50|18 active/iu.test(section),
      `${id} must not show sample telemetry`);
  }
});

test('the unavailable morning routine cannot report a successful start', () => {
  assert.ok(/<button\b[^>]*\bdisabled\b[^>]*>\s*<i[^>]*><\/i> Morgenrutine utilgjengelig/u.test(page),
    'the morning routine control must be disabled');
  const routine = page.match(/^ {8}function runMorningRoutine\(\) \{[\s\S]*?^ {8}\}/m)?.[0];
  assert.ok(routine);
  const notices = [];
  runInNewContext(`${routine}\nrunMorningRoutine();`, {
    alert: message => notices.push(message),
  });
  assert.deepEqual(notices, ['Morgenrutinen er utilgjengelig i denne visningen.']);
});
