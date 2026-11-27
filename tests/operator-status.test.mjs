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

test('the daily agenda presents unknown status without verified agenda data', () => {
  const start = page.indexOf('<div id="sakslista" class="section">');
  assert.notEqual(start, -1);
  const section = page.slice(start).split('<!-- PODKAST SECTION -->', 1)[0];
  assert.ok(section.includes('Sakslisten er ubekreftet i denne visningen.'));
  assert.doesNotMatch(section, /\b\d+ saker for \d{4}-\d{2}-\d{2}\b|class="list-item"/u);
});

test('the podcast panel indicates unknown metrics and episodes without verified data', () => {
  const start = page.indexOf('<div id="podkast" class="section">');
  assert.notEqual(start, -1);
  const section = page.slice(start).split('<!-- SOCIAL MEDIA SECTION -->', 1)[0];
  assert.ok(section.includes('Podkasttall og episoder er ubekreftet i denne visningen.'));
  assert.doesNotMatch(section, /class="stat-value">\s*\d|class="list-item"/u);
});

test('the export panel labels local data and the actual downloadable formats', () => {
  const start = page.indexOf('<div id="export" class="section">');
  assert.notEqual(start, -1);
  const section = page.slice(start).split('<!-- AI ASSISTANT SECTION -->', 1)[0];
  assert.match(section, /class="stat-value">3<\/div>\s*<div class="stat-label">Filformater/u);
  assert.match(section, /Kalenderdataene i eksporten er eksempeldata\./u);
  assert.match(section, /HTML-rapport/u);
  assert.match(section, /Visningsdata \(JSON\)/u);
  assert.doesNotMatch(section, /Backup klar|Komplett Backup|Alle data i ZIP|PDF Rapport/u);
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
