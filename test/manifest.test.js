// -----------------------------------------------------------------------------
// Consistency checks between `gladys-assistant-integration.json` and the code.
// The manifest is validated by the store indexer, but nothing there can know
// which handlers the code actually registers — these tests keep both in sync.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { DEFAULT_CONFIG } from '../src/config.js';
import { LANGUAGES } from '../src/i18n.js';
import { SCENE_ACTIONS, SCENE_TRIGGER_KEYS } from '../src/capabilities/scenes.js';
import { WIDGETS } from '../src/capabilities/widget.js';
import { MY_CONTRACT_TEMPLATES } from '../src/capabilities/energy.js';
import { createIntegration } from '../src/integration.js';
import { createMemoryStore } from '../src/store.js';

const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));

// Every list of form fields the manifest can declare (same field grammar).
const allFields = [
  ...(manifest.config_schema ?? []),
  ...[
    ...(manifest.actions ?? []),
    ...(manifest.scene_triggers ?? []),
    ...(manifest.scene_actions ?? []),
  ].flatMap((item) => item.fields ?? []),
  ...(manifest.widgets ?? []).flatMap((widget) => widget.settings ?? []),
];

const keysOf = (list) => (list ?? []).map((entry) => entry.key);

// Minimum version of the manifest `gladys_version` range, e.g. [5, 1, 0].
function minGladysVersion() {
  const match = manifest.gladys_version.match(/>=\s*(\d+)\.(\d+)\.(\d+)/);
  assert.ok(match, 'gladys_version must declare a minimum version');
  return match.slice(1).map(Number);
}

function isAtLeast(version, required) {
  for (let i = 0; i < required.length; i += 1) {
    if (version[i] !== required[i]) {
      return version[i] > required[i];
    }
  }
  return true;
}

// Every multi-language object of the manifest: label, description,
// placeholder, option labels, link labels...
function multiLanguageTexts(node, path = 'manifest', found = []) {
  if (Array.isArray(node)) {
    node.forEach((child, index) => multiLanguageTexts(child, `${path}[${index}]`, found));
  } else if (node && typeof node === 'object') {
    if (typeof node.en === 'string') {
      found.push({ path, texts: node });
      return found;
    }
    for (const [key, child] of Object.entries(node)) {
      multiLanguageTexts(child, `${path}.${key}`, found);
    }
  }
  return found;
}

test('every text of the manifest exists in English, French, German and Spanish', () => {
  const texts = multiLanguageTexts(manifest);
  assert.ok(texts.length > 50);
  for (const { path, texts: object } of texts) {
    for (const language of LANGUAGES) {
      assert.ok(object[language]?.trim(), `${path}.${language} is missing`);
    }
  }
});

test('the integration declares its cloud transport and the energy category', () => {
  assert.deepEqual(manifest.transports, ['cloud']);
  assert.deepEqual(manifest.categories, ['energy']);
  assert.ok(isAtLeast(minGladysVersion(), [4, 86, 0]), 'categories need Gladys >= 4.86.0');
});

// The store vocabulary of catalog shelves (2026-10: transport, vehicles, servers, leisure added).
const CATALOG_CATEGORIES = [
  'climate',
  'lighting',
  'energy',
  'security',
  'multimedia',
  'appliances',
  'environment',
  'protocols',
  'network',
  'notifications',
  'assistants',
  'services',
  'transport',
  'vehicles',
  'servers',
  'leisure',
];

test('the catalog categories are 1 to 3 keys of the store vocabulary', () => {
  assert.ok(manifest.categories.length >= 1 && manifest.categories.length <= 3);
  assert.equal(new Set(manifest.categories).size, manifest.categories.length);
  for (const category of manifest.categories) {
    assert.ok(CATALOG_CATEGORIES.includes(category), `unknown category "${category}"`);
  }
});

test('the search keywords are 1 to 10 unique terms of 2 to 30 characters', () => {
  const { keywords } = manifest;
  assert.ok(Array.isArray(keywords) && keywords.length >= 1 && keywords.length <= 10);
  const normalized = keywords.map((keyword) => keyword.trim().toLowerCase());
  assert.equal(new Set(normalized).size, keywords.length, 'keywords are unique');
  for (const keyword of normalized) {
    assert.ok(keyword.length >= 2 && keyword.length <= 30, `"${keyword}": 2 to 30 characters`);
  }
});

test('the integration is declared for France only', () => {
  assert.deepEqual(manifest.countries, ['FR']);
  for (const country of manifest.countries) {
    assert.match(country, /^[A-Z]{2}$/);
  }
});

test('declaring keywords, countries or music requires Gladys >= 5.3.0', () => {
  assert.ok(['keywords', 'countries', 'music'].some((field) => field in manifest));
  assert.ok(isAtLeast(minGladysVersion(), [5, 3, 0]), `got "${manifest.gladys_version}"`);
});

test('declaring scene triggers, scene actions and widgets requires Gladys >= 5.1.0', () => {
  for (const field of ['scene_triggers', 'scene_actions', 'widgets']) {
    assert.ok(manifest[field]?.length > 0, `${field} is declared`);
  }
  assert.ok(isAtLeast(minGladysVersion(), [5, 1, 0]), `got "${manifest.gladys_version}"`);
});

// --- Energy contracts (Gladys 5.2+) -----------------------------------------
// The store validator (CI, pull requests) runs the full tariff schema; these
// tests catch the mistakes that are easy to make when editing the prices.

const templates = manifest.energy_contracts?.templates ?? [];
// The templates of the official grids, priced by the core rule engine.
const ruleTemplates = templates.filter(
  (template) => template.pricing_mode === 'rules' && !MY_CONTRACT_TEMPLATES.includes(template.key),
);
// The hand-written "My contract" ones: the user's own prices, typed.
const myTemplates = MY_CONTRACT_TEMPLATES.map((key) => templates.find((t) => t.key === key));

// Every `{{input:<key>}}` placeholder of a tariff.
function placeholdersOf(node, found = new Set()) {
  if (typeof node === 'string') {
    for (const [, key] of node.matchAll(/\{\{input:([a-z0-9_]+)\}\}/g)) {
      found.add(key);
    }
  } else if (node && typeof node === 'object') {
    Object.values(node).forEach((child) => placeholdersOf(child, found));
  }
  return found;
}

test('declaring energy contracts requires Gladys >= 5.2.0', () => {
  assert.ok(templates.length > 0, 'energy contract templates are declared');
  assert.ok(isAtLeast(minGladysVersion(), [5, 2, 0]), `got "${manifest.gladys_version}"`);
});

test('the contract templates are French electricity offers, the grid ones priced by the rules engine', () => {
  const keys = templates.map((template) => template.key);
  assert.equal(new Set(keys).size, keys.length, 'template keys are unique');
  assert.equal(ruleTemplates.length, 6);
  assert.equal(
    templates.find((template) => template.key === 'espaceclient-elec'),
    undefined,
    'the delegated template is gone',
  );
  for (const template of templates) {
    assert.match(template.key, /^[a-z0-9][a-z0-9-]{0,63}$/);
    assert.equal(template.country, 'FR');
    assert.equal(template.currency, 'EUR');
    assert.equal(template.timezone, 'Europe/Paris');
    for (const [lang, name] of Object.entries(template.name)) {
      assert.ok(name.length <= 64, `${template.key} name.${lang}: ${name.length} characters`);
    }
  }
});

test('every tariff placeholder names a declared input, and every input is used', () => {
  for (const template of [...ruleTemplates, ...myTemplates]) {
    const inputs = template.inputs.map((input) => input.key);
    const used = placeholdersOf(template.tariff);
    for (const key of used) {
      assert.ok(inputs.includes(key), `${template.key}: {{input:${key}}} is not declared`);
    }
    for (const key of inputs) {
      assert.ok(used.has(key), `${template.key}: input "${key}" is never used`);
    }
  }
});

test('the default prices are plausible euros, the subscription is monthly', () => {
  for (const template of ruleTemplates) {
    for (const input of template.inputs.filter((i) => i.type === 'number')) {
      const max = input.unit === 'EUR/kWh' ? 1 : 100;
      assert.ok(input.default > 0 && input.default < max, `${template.key}.${input.key}`);
    }
    const fixed = template.tariff.components.filter((c) => c.kind === 'fixed');
    assert.deepEqual(
      fixed.map((c) => c.per),
      ['month'],
    );
  }
});

test('every consumption component has a price for any hour (a fallback)', () => {
  for (const template of ruleTemplates) {
    for (const component of template.tariff.components.filter((c) => c.kind === 'consumption')) {
      assert.ok(component.fallback?.price, `${template.key}.${component.key}`);
    }
  }
});

test('the "My contract" templates take the tariff of a grid template, without its prices', () => {
  const grids = ['novafixe-elec-base', 'novafixe-elec-peak-off-peak'].map((key) =>
    templates.find((t) => t.key === key),
  );
  myTemplates.forEach((template, i) => {
    assert.equal(template?.pricing_mode, 'rules', MY_CONTRACT_TEMPLATES[i]);
    assert.deepEqual(template.tariff, grids[i].tariff, 'the same tariff, numbers in the JSON');
    assert.deepEqual(
      template.inputs.map((input) => [input.key, input.required]),
      grids[i].inputs.map((input) => [input.key, input.required]),
    );
    // The prices of the user's own contract: no grid default to suggest.
    assert.ok(template.inputs.every((input) => input.default === undefined));
  });
  assert.equal(manifest.energy_contracts.calendars, undefined, 'no price calendar any more');
});

test('the off-peak hours default to 8 hours a day, as Enedis sets them', () => {
  const template = templates.find((t) => t.key === 'novafixe-elec-peak-off-peak');
  const slots = template.inputs.find((i) => i.key === 'off_peak_slots').default;
  const minutes = (time) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const total = slots.reduce(
    (sum, [start, end]) => sum + ((minutes(end) - minutes(start) + 1440) % 1440),
    0,
  );
  assert.equal(total, 8 * 60);
});

test('every manifest action has a registered handler', async () => {
  const gladys = createFakeGladys();
  createIntegration(gladys, { store: createMemoryStore() });
  for (const key of keysOf(manifest.actions)) {
    const ack = await gladys.fake.action(key, {});
    assert.notEqual(ack.error, 'not implemented', `manifest action "${key}" has no handler`);
  }
});

test('every scene_actions key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.scene_actions);
  assert.deepEqual([...declared].sort(), Object.keys(SCENE_ACTIONS).sort());
});

test('every widgets key has a handler, and vice versa', () => {
  const declared = keysOf(manifest.widgets);
  assert.deepEqual([...declared].sort(), Object.keys(WIDGETS).sort());
});

test('every scene trigger the code fires is declared, and vice versa', () => {
  assert.deepEqual(keysOf(manifest.scene_triggers).sort(), [...SCENE_TRIGGER_KEYS].sort());
});

test('config_schema defaults stay consistent with DEFAULT_CONFIG', () => {
  for (const field of manifest.config_schema) {
    if (field.default !== undefined) {
      assert.equal(DEFAULT_CONFIG[field.key], field.default, `DEFAULT_CONFIG.${field.key}`);
    }
  }
  for (const key of Object.keys(DEFAULT_CONFIG)) {
    assert.ok(
      manifest.config_schema.some((field) => field.key === key),
      `${key} is not a field of the config_schema`,
    );
  }
});

test('the password is a secret field', () => {
  const password = manifest.config_schema.find((field) => field.key === 'password');
  assert.equal(password.type, 'secret');
});

test('section fields are purely presentational', () => {
  for (const section of manifest.config_schema.filter((f) => f.type === 'section')) {
    assert.equal(section.required, undefined);
    assert.equal(section.default, undefined);
    assert.equal(section.placeholder, undefined);
    assert.ok(!(section.key in DEFAULT_CONFIG));
    for (const link of section.links ?? []) {
      assert.match(link.url, /^https:\/\//, 'section links must be https');
    }
  }
});

test('dynamic selects declare a source and no static options', () => {
  const dynamicSelects = allFields.filter((f) => f.source !== undefined);
  assert.ok(dynamicSelects.length > 0);
  for (const field of dynamicSelects) {
    assert.equal(field.source, 'devices');
    assert.equal(field.options, undefined, `field "${field.key}"`);
  }
});

test('the manifest version is the package version, and the image is tagged with it', () => {
  assert.equal(manifest.version, pkg.version, 'manifest version must match package.json');
  assert.equal(manifest.docker_image, `ghcr.io/prohand/gladys-gazdebordeaux:${manifest.version}`);
});

test('the catalog description holds 10 to 100 characters per language', () => {
  for (const [lang, text] of Object.entries(manifest.description)) {
    assert.ok(text.length >= 10 && text.length <= 100, `description.${lang}: ${text.length}`);
  }
});

test('widget descriptions hold at most 100 characters per language', () => {
  // A store rule: a longer text rejects the manifest.
  for (const widget of manifest.widgets) {
    for (const [lang, text] of Object.entries(widget.description ?? {})) {
      assert.ok(text.length <= 100, `widget ${widget.key} description.${lang}: ${text.length}`);
    }
  }
});

test('field placeholders are multi-language objects', () => {
  for (const field of allFields.filter((f) => f.placeholder !== undefined)) {
    assert.equal(typeof field.placeholder, 'object', `field "${field.key}": placeholder`);
    assert.ok(field.placeholder.en);
  }
});
