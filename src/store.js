// -----------------------------------------------------------------------------
// What must survive a restart: per contract, the last day already published
// as a dated state and the last day a scene event was fired for.
//
// Without it, every restart (an update, a Gladys reboot) would publish the
// imported history again — duplicated points in the charts — and fire
// "New daily reading" for a day already announced.
//
// Stored as JSON in /data, the only writable path of the container. A store
// that cannot be read or written only costs those duplicates: it is logged,
// never fatal.
// -----------------------------------------------------------------------------

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'store' });

export const DEFAULT_STORE_FILE = join(process.env.GDB_DATA_DIR ?? '/data', 'state.json');

function createStore(load, save) {
  let data = {};
  return {
    async load() {
      data = (await load()) ?? {};
    },
    /** @returns {{ lastPublishedDay?: string, lastEventDay?: string }} */
    get(contractId) {
      return { ...data[contractId] };
    },
    update(contractId, patch) {
      data[contractId] = { ...data[contractId], ...patch };
    },
    async save() {
      await save(data);
    },
  };
}

/** A store kept in memory only (tests). */
export function createMemoryStore(initial = {}) {
  let saved = structuredClone(initial);
  const store = createStore(
    async () => structuredClone(saved),
    async (data) => {
      saved = structuredClone(data);
    },
  );
  store.snapshot = () => structuredClone(saved);
  return store;
}

/** The store of the container, in a JSON file. */
export function createFileStore(file = DEFAULT_STORE_FILE) {
  return createStore(
    async () => {
      try {
        return JSON.parse(await readFile(file, 'utf8'));
      } catch (err) {
        if (err.code !== 'ENOENT') {
          logger.warn(`Cannot read ${file}, starting from scratch: ${err.message}`);
        }
        return {};
      }
    },
    async (data) => {
      // Written next to the file then renamed: a crash never leaves half a JSON.
      const temporary = `${file}.tmp`;
      try {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(temporary, JSON.stringify(data, null, 2));
        await rename(temporary, file);
      } catch (err) {
        logger.warn(`Cannot write ${file}: ${err.message}`);
      }
    },
  );
}
