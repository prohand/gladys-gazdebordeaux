// -----------------------------------------------------------------------------
// The changelog roll the Release workflow runs (.github/scripts/changelog-release.mjs).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { rollChangelog } from '../.github/scripts/changelog-release.mjs';

const REPO = 'https://github.com/prohand/gladys-gazdebordeaux';

test('the Unreleased section moves under the released version', () => {
  const before = [
    '# Changelog',
    '',
    '## [Unreleased]',
    '',
    '### Added',
    '',
    '- Something.',
    '',
    `[Unreleased]: ${REPO}/commits/main`,
    '',
  ].join('\n');
  const after = rollChangelog(before, '1.0.0', '2026-10-14');
  assert.match(
    after,
    /## \[Unreleased\]\n\n## \[1\.0\.0\] - 2026-10-14\n\n### Added\n\n- Something\./,
  );
  assert.match(after, new RegExp(`\\[Unreleased\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.HEAD`));
  assert.match(after, new RegExp(`\\[1\\.0\\.0\\]: ${REPO}/releases/tag/v1\\.0\\.0`));
});

test('a later release compares with the previous tag', () => {
  const before = [
    '## [Unreleased]',
    '',
    '- Fix.',
    '',
    '## [1.0.0] - 2026-10-14',
    '',
    `[Unreleased]: ${REPO}/compare/v1.0.0...HEAD`,
    '',
  ].join('\n');
  const after = rollChangelog(before, '1.0.1', '2026-10-20');
  assert.match(after, new RegExp(`\\[1\\.0\\.1\\]: ${REPO}/compare/v1\\.0\\.0\\.\\.\\.v1\\.0\\.1`));
});

test('the changelog of the repository has an Unreleased section the workflow can roll', async () => {
  const changelog = await readFile(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
  assert.match(changelog, /^## \[Unreleased\]$/m);
  assert.match(
    changelog,
    /^\[Unreleased\]: https:\/\/github\.com\/prohand\/gladys-gazdebordeaux\//m,
  );
});
