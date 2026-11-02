// -----------------------------------------------------------------------------
// The official price grids -> contract templates script
// (.github/scripts/tariffs.mjs). The parsing is checked against the real
// October 2026 grids (test/fixtures/2026-10/, never updated); the manifest and
// the docs against the current grids (test/fixtures/grid-*.txt, the
// `pdftotext -layout` text of the PDFs, replaced by the monthly workflow).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addChangelogLine,
  OFFERS,
  parseGrid,
  updateDocs,
  updateManifest,
} from '../.github/scripts/tariffs.mjs';

const readGrids = async (directory) =>
  Object.fromEntries(
    await Promise.all(
      OFFERS.map(async (offer) => [
        offer.key,
        parseGrid(
          await readFile(new URL(`${directory}grid-${offer.key}.txt`, import.meta.url), 'utf8'),
        ),
      ]),
    ),
  );
const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
// The October 2026 grids: the parsing tests know their prices.
const grids = await readGrids('./fixtures/2026-10/');
// The grids of today: the manifest and the docs must give their prices.
const current = await readGrids('./fixtures/');
const unpadded = (text) => text.replace(/ {2,}/g, ' ');

test('a grid gives its date and the prices of every power', () => {
  const grid = grids['novafixe-elec'];
  assert.equal(grid.date, '2026-10-01');
  assert.deepEqual(
    grid.rows.map((row) => row.power),
    [3, 6, 9, 12, 15, 18, 24, 30, 36],
  );
  assert.deepEqual(grid.rows[0], {
    power: 3,
    base: { subscription: 12.13, kwh: 0.18373 },
    peakOffPeak: null,
  });
  assert.deepEqual(grid.rows[1], {
    power: 6,
    base: { subscription: 15.87, kwh: 0.18373 },
    peakOffPeak: { subscription: 15.87, peak: 0.19648, offPeak: 0.14669 },
  });
  assert.deepEqual(grid.rows.at(-1), {
    power: 36,
    base: null,
    peakOffPeak: { subscription: 53.88, peak: 0.19648, offPeak: 0.14669 },
  });
});

test('the indexed offer has its own prices', () => {
  const row = grids['novaflex-elec'].rows.find((r) => r.power === 6);
  assert.deepEqual(row.base, { subscription: 15.87, kwh: 0.1919 });
  assert.deepEqual(row.peakOffPeak, { subscription: 15.87, peak: 0.20536, offPeak: 0.1528 });
});

test('a text that is not a grid is refused rather than read wrong', () => {
  assert.throws(() => parseGrid('Bonjour'), /date/);
  assert.throws(
    () => parseGrid('souscription entre le 01/10/2026\nGRILLE TARIFAIRE\n 6  15,87  18,373\n'),
    /6 kVA|implausible/,
  );
});

test('the manifest templates are the ones the current grids give', () => {
  const { changed } = updateManifest(manifest, current);
  assert.deepEqual(changed, [], 'run: node .github/scripts/tariffs.mjs update test/fixtures');
});

test('the price tables of the docs are the ones the current grids give', async () => {
  for (const language of ['en', 'fr', 'de', 'es']) {
    const doc = await readFile(new URL(`../docs/${language}.md`, import.meta.url), 'utf8');
    assert.equal(
      unpadded(updateDocs(doc, language, current)),
      unpadded(doc),
      `docs/${language}.md: run node .github/scripts/tariffs.mjs update test/fixtures`,
    );
  }
});

test('the docs tables follow a new grid, date included', async () => {
  const doc = await readFile(new URL('../docs/fr.md', import.meta.url), 'utf8');
  const updated = updateDocs(doc, 'fr', grids);
  assert.match(updated, /ici celles du 1er octobre 2026/);
  assert.match(
    unpadded(updated),
    /\| 6 kVA \| 15,87 \| 0,18373 \| 0,19648 \/ 0,14669 \| 0,19190 \| 0,20536 \/ 0,15280 \|/,
  );
  assert.match(unpadded(updated), /\| 36 kVA \| 53,88 \| – \| 0,19648 \/ 0,14669 \| – \|/);
  const en = updateDocs(
    await readFile(new URL('../docs/en.md', import.meta.url), 'utf8'),
    'en',
    grids,
  );
  assert.match(en, /here the 1 October 2026 ones/);
  assert.match(unpadded(en), /\| 3 kVA \| 12\.13 \| 0\.18373 \| – \| 0\.19190 \| – \|/);
});

test('a new price changes that offer only, versioned with the grid date', () => {
  const { manifest: today } = updateManifest(manifest, grids);
  const next = structuredClone(grids);
  for (const grid of Object.values(next)) {
    grid.date = '2099-01-01';
  }
  next['novaflex-elec'].rows.find((r) => r.power === 6).base.kwh = 0.195;
  const { manifest: updated, changed } = updateManifest(today, next);
  assert.deepEqual(changed, ['novaflex-elec-base']);
  const versions = (m) =>
    Object.fromEntries(m.energy_contracts.templates.map((t) => [t.key, t.version]));
  assert.equal(versions(updated)['novaflex-elec-base'], '2099-01-01');
  assert.equal(
    versions(updated)['novafixe-elec-base'],
    versions(today)['novafixe-elec-base'],
    'same prices, same version',
  );
  assert.ok(versions(updated)['espaceclient-elec-rules'], 'the "My contract" templates are kept');
  assert.ok(versions(updated)['espaceclient-elec-peak-off-peak-rules']);
});

test('a price change is described in the changelog', () => {
  const empty = '# Changelog\n\n## [Unreleased]\n\n## [1.0.0] - 2026-10-14\n\n- First.\n';
  assert.equal(
    addChangelogLine(empty, 'New prices.'),
    '# Changelog\n\n## [Unreleased]\n\n### Changed\n\n- New prices.\n\n## [1.0.0] - 2026-10-14\n\n- First.\n',
  );
  const withChanged =
    '## [Unreleased]\n\n### Changed\n\n- Something.\n\n### Fixed\n\n- Bug.\n\n[Unreleased]: x\n';
  assert.equal(
    addChangelogLine(withChanged, 'New prices.'),
    '## [Unreleased]\n\n### Changed\n\n- Something.\n- New prices.\n\n### Fixed\n\n- Bug.\n\n[Unreleased]: x\n',
  );
  const quoted = 'Changes go under `## [Unreleased]`.\n\n## [Unreleased]\n';
  assert.equal(
    addChangelogLine(quoted, 'New prices.'),
    'Changes go under `## [Unreleased]`.\n\n## [Unreleased]\n\n### Changed\n\n- New prices.\n',
  );
});
