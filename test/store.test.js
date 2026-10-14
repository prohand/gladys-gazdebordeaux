import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFileStore, createMemoryStore } from '../src/store.js';

test('the file store survives a restart', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gdb-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');

  const first = createFileStore(file);
  await first.load();
  assert.deepEqual(first.get('abc'), {});
  first.update('abc', { lastPublishedDay: '2026-10-13' });
  first.update('abc', { lastEventDay: '2026-10-13' });
  await first.save();

  const second = createFileStore(file);
  await second.load();
  assert.deepEqual(second.get('abc'), {
    lastPublishedDay: '2026-10-13',
    lastEventDay: '2026-10-13',
  });
  assert.ok(JSON.parse(await readFile(file, 'utf8')).abc);
});

test('an unreadable file starts from scratch instead of failing', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gdb-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'state.json');
  await writeFile(file, '{ not json');
  const store = createFileStore(file);
  await store.load();
  assert.deepEqual(store.get('abc'), {});
});

test('a store that cannot be written logs instead of failing the refresh', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'gdb-store-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  // A file where the directory should be: mkdir fails with ENOTDIR/EEXIST.
  const blocker = join(dir, 'blocker');
  await writeFile(blocker, '');
  const store = createFileStore(join(blocker, 'sub', 'state.json'));
  store.update('abc', { lastPublishedDay: '2026-10-13' });
  await store.save();
});

test('get returns a copy: the caller cannot change the store behind its back', async () => {
  const store = createMemoryStore({ abc: { lastEventDay: '2026-10-13' } });
  await store.load();
  store.get('abc').lastEventDay = 'changed';
  assert.equal(store.get('abc').lastEventDay, '2026-10-13');
});
