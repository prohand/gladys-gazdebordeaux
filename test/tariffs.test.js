// -----------------------------------------------------------------------------
// The official price grids -> contract templates script
// (.github/scripts/tariffs.mjs), against the real October 2026 grids
// (test/fixtures/grid-*.txt, the `pdftotext -layout` text of the PDFs).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  addChangelogLine,
  OFFERS,
  parseGrid,
  updateManifest,
} from '../.github/scripts/tariffs.mjs';

const gridText = (key) => readFile(new URL(`./fixtures/grid-${key}.txt`, import.meta.url), 'utf8');
const manifest = JSON.parse(
  await readFile(new URL('../gladys-assistant-integration.json', import.meta.url), 'utf8'),
);
const grids = Object.fromEntries(
  await Promise.all(OFFERS.map(async (offer) => [offer.key, parseGrid(await gridText(offer.key))])),
);

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
  const { changed } = updateManifest(manifest, grids);
  assert.deepEqual(changed, [], 'run: node .github/scripts/tariffs.mjs update test/fixtures');
});

test('a new price changes that offer only, versioned with the grid date', () => {
  const next = structuredClone(grids);
  for (const grid of Object.values(next)) {
    grid.date = '2026-11-01';
  }
  next['novaflex-elec'].rows.find((r) => r.power === 6).base.kwh = 0.195;
  const { manifest: updated, changed } = updateManifest(manifest, next);
  assert.deepEqual(changed, ['novaflex-elec-base']);
  const versions = Object.fromEntries(
    updated.energy_contracts.templates.map((t) => [t.key, t.version]),
  );
  assert.equal(versions['novaflex-elec-base'], '2026-11-01');
  assert.equal(versions['novafixe-elec-base'], '2026-10-01', 'same prices, same version');
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
