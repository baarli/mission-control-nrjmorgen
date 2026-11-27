import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext, runInNewContext } from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const social = page.match(/<div id="social" class="section">[\s\S]*?<!-- TESTING SECTION -->/u)?.[0];
const socialManager = page.match(/^ {8}class SocialMediaManager \{[\s\S]*?^ {8}\}/m)?.[0];
const exportManager = page.match(/^ {8}class ExportManager \{[\s\S]*?^ {8}\}/m)?.[0];

function draftElement() {
  return {
    children: [],
    style: {},
    textContent: '',
    append(...children) { this.children.push(...children); },
    replaceChildren(...children) { this.children = children; },
  };
}

function setupDrafts(answers) {
  const alerts = [];
  const container = draftElement();
  const context = createContext({
    alert: message => alerts.push(message),
    prompt: () => answers.shift(),
    document: {
      createElement: draftElement,
      getElementById: id => id === 'social-drafts' ? container : null,
    },
  });
  assert.ok(socialManager);
  runInContext(`${socialManager}\nconst socialManager = new SocialMediaManager();`, context);
  return {
    alerts,
    container,
    context,
    click(callback) {
      assert.ok(social?.includes(`onclick="${callback}"`), 'expected a page control for the callback');
      runInContext(callback, context);
    },
  };
}

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

test('the social panel starts empty and explains that drafts last for the current page session', () => {
  assert.ok(social);
  assert.match(social, /Utkastene finnes i denne fanen frem til siden lastes på nytt\./u);
  assert.match(social, /Ingen lokale utkast/u);
  assert.doesNotMatch(social, /Planlagt:|>Venter<|Ny episode ute nå!/u);
});

test('manual and template controls keep the full copy and desired time as session drafts', () => {
  const copy = 'Dette er en lang kladd med <åpne vinkeltegn> og full tekst.\nAndre linje skal være med.';
  const time = '2026-11-28 15:00';
  const link = 'https://example.invalid/episode?q=$&draft=1';
  const fixture = setupDrafts([copy, 'instagram', time, 'Syntetisk podkast', link, 'youtube', time]);
  fixture.click('socialManager.createPost()');
  fixture.click("socialManager.useTemplate('episode')");

  assert.deepEqual(fixture.alerts, ['Lokalt utkast lagt til i denne fanen.', 'Lokalt utkast lagt til i denne fanen.']);
  const [manual, fromTemplate] = fixture.container.children;
  assert.equal(manual.children[1].children[0].textContent, copy);
  assert.equal(manual.children[1].children[1].textContent, `Instagram · Ønsket tidspunkt ${time}`);
  assert.equal(manual.children[2].textContent, 'Lokalt utkast');
  assert.equal(fromTemplate.children[1].children[0].textContent,
    `Ny episode av Syntetisk podkast ute nå! 🎉 Lytt her: ${link}`);
  assert.equal(fromTemplate.children[1].children[1].textContent, `YouTube · Ønsket tidspunkt ${time}`);
  assert.equal(fromTemplate.children[2].textContent, 'Lokalt utkast');
  assert.equal(runInContext('new SocialMediaManager().drafts.length', fixture.context), 0);
});

test('cancelling a template leaves the draft list empty', () => {
  const fixture = setupDrafts([null]);
  fixture.click("socialManager.useTemplate('episode')");
  assert.deepEqual(fixture.alerts, []);
  assert.deepEqual(fixture.container.children, []);
  assert.equal(runInContext('socialManager.drafts.length', fixture.context), 0);
});

test('both JSON exports describe social entries as drafts with their original desired time', async () => {
  const fixture = setupDrafts(['Eksportkladd', 'tiktok', '2026-11-28 15:00']);
  fixture.click('socialManager.createPost()');
  const downloads = [];
  assert.ok(exportManager);
  Object.assign(fixture.context, {
    Blob, calendar: { calendarItems: [] }, testRunner: { results: [] }, downloads,
  });
  runInContext(`${exportManager}
    const exporter = Object.create(ExportManager.prototype);
    exporter.downloadFile = (blob) => downloads.push(blob);
    exporter.logExport = () => {};
    exporter.exportJSON();
    exporter.exportViewData();
  `, fixture.context);

  assert.equal(downloads.length, 2);
  for (const download of downloads) {
    const { social: entries } = JSON.parse(await download.text());
    assert.equal(entries.length, 1);
    assert.equal(entries[0].content, 'Eksportkladd');
    assert.equal(entries[0].desiredTime, '2026-11-28 15:00');
    assert.equal(entries[0].status, 'draft');
    assert.equal('scheduledTime' in entries[0], false);
  }
});
