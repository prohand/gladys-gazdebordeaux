import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BROWSER_HEADERS,
  contractFromHouse,
  createClient,
  ERROR_KINDS,
  houseIdOf,
  normalizeHousePath,
} from '../src/gazdebordeaux/client.js';
import { createFakeWebsite, ELEC_ID, EMAIL, GAS_ID, PASSWORD } from './helpers/fakeWebsite.js';

const clientOf = (site, overrides = {}) =>
  createClient({ email: EMAIL, password: PASSWORD, fetchImpl: site.fetch, ...overrides });

test('house paths are normalized to /api/houses/{uuid}, whatever shape the account gives', () => {
  assert.equal(normalizeHousePath('/api/houses/abc'), '/api/houses/abc');
  assert.equal(normalizeHousePath('/houses/abc'), '/api/houses/abc');
  assert.equal(normalizeHousePath('houses/abc'), '/api/houses/abc');
  assert.equal(houseIdOf('/api/houses/abc'), 'abc');
});

test('the contract energy comes from contractType.category', () => {
  assert.equal(
    contractFromHouse('/api/houses/a', { contractType: { category: 'gas' } }).energy,
    'gas',
  );
  assert.equal(
    contractFromHouse('/api/houses/a', { contractType: { category: 'ELECTRICITY' } }).energy,
    'electricity',
  );
  assert.equal(contractFromHouse('/api/houses/a', {}).energy, 'unknown');
});

test('every request looks like the website itself, or its filter answers HTML', async () => {
  const site = createFakeWebsite();
  await clientOf(site).getContracts();
  for (const { init } of site.requests) {
    for (const [name, value] of Object.entries(BROWSER_HEADERS)) {
      assert.equal(init.headers[name], value, `${name} header`);
    }
  }
});

test('getContracts lists every house of a gas + electricity account', async () => {
  const site = createFakeWebsite();
  const contracts = await clientOf(site).getContracts();
  assert.deepEqual(
    contracts.map(({ id, energy, path }) => ({ id, energy, path })),
    [
      { id: GAS_ID, energy: 'gas', path: `/api/houses/${GAS_ID}` },
      { id: ELEC_ID, energy: 'electricity', path: `/api/houses/${ELEC_ID}` },
    ],
  );
});

test('a selectedHouse without the /api prefix is the same house, listed once', async () => {
  const site = createFakeWebsite({
    contracts: [{ id: GAS_ID, category: 'gas' }],
    selectedHouse: `/houses/${GAS_ID}`,
  });
  const contracts = await clientOf(site).getContracts();
  assert.equal(contracts.length, 1);
  assert.equal(contracts[0].path, `/api/houses/${GAS_ID}`);
});

test('wrong credentials are an auth error, and the password is never in the URL', async () => {
  const site = createFakeWebsite();
  const client = createClient({ email: EMAIL, password: 'wrong', fetchImpl: site.fetch });
  await assert.rejects(client.getContracts(), { kind: ERROR_KINDS.AUTH });
  for (const { pathname, query } of site.requests) {
    assert.ok(!`${pathname}${JSON.stringify(query)}`.includes('wrong'));
  }
});

test('the HTML page of the website filter is a "blocked" error', async () => {
  const site = createFakeWebsite();
  site.blocked = true;
  await assert.rejects(clientOf(site).getContracts(), { kind: ERROR_KINDS.BLOCKED, status: 403 });
});

test('a network failure is a "network" error', async () => {
  const site = createFakeWebsite();
  site.down = true;
  await assert.rejects(clientOf(site).getContracts(), { kind: ERROR_KINDS.NETWORK });
});

test('an expired token is renewed once, transparently', async () => {
  const site = createFakeWebsite();
  const client = clientOf(site);
  await client.getContracts();
  assert.equal(site.logins, 1);
  site.expireTokens();
  await client.getContracts();
  assert.equal(site.logins, 2, 'signed in again');
});

test('an account without any house is a "no_contract" error', async () => {
  const site = createFakeWebsite({ contracts: [] });
  await assert.rejects(clientOf(site).getContracts(), { kind: ERROR_KINDS.NO_CONTRACT });
});

test('getConsumptions passes the scale and the dates', async () => {
  const site = createFakeWebsite();
  await clientOf(site).getConsumptions(`/api/houses/${GAS_ID}`, {
    scale: 'month',
    startDate: '2026-10-01',
    endDate: '2026-10-14',
  });
  const last = site.requests.at(-1);
  assert.equal(last.pathname, `/api/houses/${GAS_ID}/consumptions`);
  assert.deepEqual(last.query, { scale: 'month', startDate: '2026-10-01', endDate: '2026-10-14' });
});

test('a JSON answer that is not JSON is an "api" error', async () => {
  const fetchImpl = async () =>
    new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
  const client = createClient({ email: EMAIL, password: PASSWORD, fetchImpl });
  await assert.rejects(client.login(), { kind: ERROR_KINDS.API });
});
