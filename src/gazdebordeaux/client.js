// -----------------------------------------------------------------------------
// HTTP client of the Gaz de Bordeaux customer account (life.gazdebordeaux.fr).
//
// There is no public API: these are the JSON endpoints the customer website
// itself calls, the same ones the community Home Assistant integration uses.
//
//   POST /api/login_check                 {email, password} -> {token} (JWT)
//   GET  /api/users/me                    selectedHouse + houses[] (paths)
//   GET  /api/houses/{uuid}               one contract: contractType.category
//   GET  /api/houses/{uuid}/consumptions  ?scale=month|year[&startDate&endDate]
//
// What makes it fragile, learned the hard way by the HA integration:
//   - the website sits behind a filter that answers an HTML page (403, or 200
//     with the single-page app) to any request that does not look like the
//     site's own: every call sends the browser-like headers below;
//   - `selectedHouse` comes as `/api/houses/{uuid}` or `/houses/{uuid}`
//     depending on the account, and is null on gas + electricity accounts;
//   - the token lives a few hours: an expired one is a 401, logged in again
//     once.
//
// Node 22+ provides `fetch`: no dependency.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'gazdebordeaux' });

export const BASE_URL = 'https://life.gazdebordeaux.fr';

export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36' +
    ' (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  Accept: 'application/json',
  'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
  Origin: BASE_URL,
  Referer: `${BASE_URL}/`,
  'Sec-Fetch-Dest': 'empty',
  'Sec-Fetch-Mode': 'cors',
  'Sec-Fetch-Site': 'same-origin',
  'Sec-Ch-Ua': '"Google Chrome";v="131", "Chromium";v="131", "Not_A Brand";v="24"',
  'Sec-Ch-Ua-Mobile': '?0',
  'Sec-Ch-Ua-Platform': '"macOS"',
};

/** Why a call failed: the value of `GdbError.kind` (also a scene filter). */
export const ERROR_KINDS = {
  NOT_CONFIGURED: 'not_configured',
  AUTH: 'auth',
  BLOCKED: 'blocked',
  NETWORK: 'network',
  API: 'api',
  NO_CONTRACT: 'no_contract',
};

export class GdbError extends Error {
  /**
   * @param {string} kind one of ERROR_KINDS
   * @param {string} message
   * @param {{ status?: number, cause?: unknown }} [details]
   */
  constructor(kind, message, { status, cause } = {}) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'GdbError';
    this.kind = kind;
    this.status = status;
  }
}

/** The energies the integration knows how to present. */
export const ENERGIES = { GAS: 'gas', ELECTRICITY: 'electricity' };

/** `/houses/x`, `houses/x` or `/api/houses/x` -> `/api/houses/x`. */
export function normalizeHousePath(house) {
  let path = String(house ?? '').trim();
  if (!path.startsWith('/')) {
    path = `/${path}`;
  }
  return path.startsWith('/api/') ? path : `/api${path}`;
}

/** The uuid at the end of a house path: the stable id of the contract. */
export function houseIdOf(path) {
  return path.split('/').filter(Boolean).at(-1);
}

// A `houses` entry is usually a path, sometimes an embedded JSON-LD object.
function pathOf(entry) {
  if (typeof entry === 'string' && entry.trim()) {
    return entry;
  }
  if (entry && typeof entry === 'object') {
    return entry['@id'] ?? (entry.id ? `/api/houses/${entry.id}` : null);
  }
  return null;
}

function energyOf(house) {
  const category = String(house?.contractType?.category ?? '').toLowerCase();
  if (category === 'gas' || category === 'gaz') {
    return ENERGIES.GAS;
  }
  if (category.startsWith('elec')) {
    return ENERGIES.ELECTRICITY;
  }
  return category || 'unknown';
}

/**
 * @param {string} path normalized house path
 * @param {object} house the `/api/houses/{uuid}` resource
 */
export function contractFromHouse(path, house) {
  return {
    id: houseIdOf(path),
    path,
    energy: energyOf(house),
    // Shown in the device name when the account holds several contracts of
    // the same energy; any of these may be missing.
    reference: house?.contractNumber ?? house?.reference ?? house?.pdl ?? house?.pce ?? null,
  };
}

/**
 * @param {{ email: string, password: string, fetchImpl?: typeof fetch, timeoutMs?: number }} options
 */
export function createClient({
  email,
  password,
  fetchImpl = (...args) => globalThis.fetch(...args),
  timeoutMs = 20_000,
}) {
  let token = null;

  async function call(method, path, { body, query, auth = true } = {}) {
    const url = new URL(path, BASE_URL);
    for (const [key, value] of Object.entries(query ?? {})) {
      if (value !== undefined && value !== null) {
        url.searchParams.set(key, value);
      }
    }
    const headers = { ...BROWSER_HEADERS };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (auth) {
      headers.Authorization = `Bearer ${token}`;
    }

    // Never log the body of a login: it carries the password.
    logger.debug(`${method} ${url.pathname}${url.search}`);
    let response;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new GdbError(ERROR_KINDS.NETWORK, `Gaz de Bordeaux unreachable: ${err.message}`, {
        cause: err,
      });
    }

    const status = response.status;
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    logger.debug(`${method} ${url.pathname} -> HTTP ${status} (${contentType || 'no type'})`);

    if (status === 401) {
      throw new GdbError(ERROR_KINDS.AUTH, 'Gaz de Bordeaux refused the credentials (HTTP 401)', {
        status,
      });
    }
    // The filter in front of the website answers its HTML pages, not JSON.
    if (status === 403 || /html/i.test(contentType)) {
      throw new GdbError(
        ERROR_KINDS.BLOCKED,
        `The Gaz de Bordeaux website refused the request (HTTP ${status}, ${contentType || 'no type'})`,
        { status },
      );
    }
    if (status < 200 || status >= 300) {
      throw new GdbError(ERROR_KINDS.API, `Gaz de Bordeaux answered HTTP ${status}`, { status });
    }
    try {
      return JSON.parse(text);
    } catch (err) {
      throw new GdbError(ERROR_KINDS.API, `Gaz de Bordeaux answered something else than JSON`, {
        status,
        cause: err,
      });
    }
  }

  async function login() {
    token = null;
    const answer = await call('POST', '/api/login_check', {
      body: { email, password },
      auth: false,
    });
    if (typeof answer?.token !== 'string' || !answer.token) {
      throw new GdbError(ERROR_KINDS.AUTH, 'Gaz de Bordeaux gave no session token');
    }
    token = answer.token;
    logger.debug('Signed in to the customer account');
  }

  // An authenticated GET: signs in when needed, and once more when the token
  // expired in between.
  async function get(path, query) {
    if (!token) {
      await login();
    }
    try {
      return await call('GET', path, { query });
    } catch (err) {
      if (err.kind !== ERROR_KINDS.AUTH) {
        throw err;
      }
      logger.debug('Session expired, signing in again');
      await login();
      return call('GET', path, { query });
    }
  }

  /**
   * Every contract of the account, `{ id, path, energy, reference }`.
   * @returns {Promise<Array<{ id: string, path: string, energy: string, reference: string | null }>>}
   */
  async function getContracts() {
    const me = await get('/api/users/me');
    const paths = [
      ...new Set(
        [me?.selectedHouse, ...(Array.isArray(me?.houses) ? me.houses : [])]
          .map(pathOf)
          .filter(Boolean)
          .map(normalizeHousePath),
      ),
    ];
    if (paths.length === 0) {
      throw new GdbError(ERROR_KINDS.NO_CONTRACT, 'No contract on this Gaz de Bordeaux account');
    }
    const contracts = [];
    for (const path of paths) {
      contracts.push(contractFromHouse(path, await get(path)));
    }
    return contracts;
  }

  /**
   * The raw consumption payload of one contract.
   * @param {string} path house path
   * @param {{ scale: 'month' | 'year', startDate?: string, endDate?: string }} query
   */
  function getConsumptions(path, { scale, startDate, endDate }) {
    return get(`${path}/consumptions`, { scale, startDate, endDate });
  }

  return { login, getContracts, getConsumptions };
}
