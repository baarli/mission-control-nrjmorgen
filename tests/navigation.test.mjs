import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { createContext, runInContext } from 'node:vm';

const page = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const showSection = page.match(/^ {8}function showSection\(sectionId\) \{[\s\S]*?^ {8}\}/m)[0];
const keyboardShortcuts = page.match(/^ {8}class KeyboardShortcuts \{[\s\S]*?^ {8}\}/m)[0];

function element(...initialClasses) {
  const classes = new Set(initialClasses);
  return {
    classList: {
      add: name => classes.add(name),
      contains: name => classes.has(name),
      remove: name => classes.delete(name),
      toggle: (name, force) => force ? classes.add(name) : classes.delete(name),
    },
  };
}

function setupNavigation() {
  const sections = new Map(Array.from(page.matchAll(/<div id="([^"]+)" class="section( active)?">/g),
    ([, id, active]) => [id, active ? element('section', 'active') : element('section')]));
  const links = Array.from(page.matchAll(/<a class="nav-link( active)?"([^>]*)>/g), ([, active, attrs]) => ({
    ...(active ? element('active') : element()),
    dataset: { section: attrs.match(/data-section="([^"]+)"/)?.[1] },
    onclick: attrs.match(/onclick="([^"]+)"/)[1],
  }));
  const sidebar = element('open');
  const title = { textContent: 'Dashboard' };
  const keydownListeners = [];
  const document = {
    getElementById: id => ({ sidebar, 'page-title': title })[id] ?? sections.get(id),
    querySelectorAll: selector => selector === '.section' ? [...sections.values()] : links,
    addEventListener: (type, listener) => {
      assert.equal(type, 'keydown');
      keydownListeners.push(listener);
    },
  };
  const context = createContext({ document });
  runInContext(`${showSection}\n${keyboardShortcuts}\nnew KeyboardShortcuts();`, context);

  return {
    pressFromBody(key) {
      context.event = { key, preventDefault() {}, target: { tagName: 'BODY', closest: () => null } };
      keydownListeners[0](context.event);
    },
    clickPodkastIcon() {
      const link = links[2];
      context.link = link;
      context.event = { target: { closest: () => link } };
      runInContext(`(function () { ${link.onclick} }).call(link);`, context);
    },
    navigateDirectly(id) {
      runInContext(`showSection(${JSON.stringify(id)});`, context);
    },
    assertSection(id, linkIndex, expectedTitle) {
      assert.deepEqual([...sections].filter(([, section]) => section.classList.contains('active')).map(([sectionId]) => sectionId), [id]);
      assert.deepEqual(links.filter(link => link.classList.contains('active')), [links[linkIndex]]);
      assert.equal(title.textContent, expectedTitle);
      assert.equal(sidebar.classList.contains('open'), false);
    },
  };
}

test('numeric shortcut from the body selects the panel, highlights its menu and closes the sidebar', () => {
  const navigation = setupNavigation();

  navigation.pressFromBody('4');

  navigation.assertSection('calendar', 3, 'Innholdskalender');
});

test('clicking a nested menu icon still updates the complete navigation state', () => {
  const navigation = setupNavigation();

  navigation.clickPodkastIcon();

  navigation.assertSection('podkast', 2, 'Podkast Control');
});

test('a direct navigation action does not require a browser event', () => {
  const navigation = setupNavigation();

  navigation.navigateDirectly('sakslista');

  navigation.assertSection('sakslista', 1, 'Sakslista Pro');
});
