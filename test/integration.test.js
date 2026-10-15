import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractIds, FEATURES } from '../src/devices/contract.js';
import { TRIGGERS } from '../src/capabilities/scenes.js';
import { createMemoryStore } from '../src/store.js';
import { createAllDevices, CREDENTIALS, setup } from './helpers/setup.js';
import { createFakeWebsite, ELEC_ID, GAS_ID, makeDays } from './helpers/fakeWebsite.js';

const idsOf = (gladys, id, energy) => contractIds(gladys, { id, energy });

test('on startup, one device per contract is offered and the account shows connected', async (t) => {
  const { gladys } = await setup(t);
  const names = gladys.fake.discoveredDevices.map((device) => device.name);
  assert.deepEqual(names, ['Gaz de Bordeaux – Gaz', 'Gaz de Bordeaux – Électricité']);
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.states.length, 0, 'nothing published before the user creates a device');
});

test('creating a gas device imports its history, dated by day', async (t) => {
  const { gladys } = await setup(t);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  const ids = idsOf(gladys, GAS_ID);

  const daily = gladys.fake.states.filter(
    (state) => state.device_feature_external_id === ids.feature(FEATURES.DAILY_ENERGY),
  );
  // history_days = 30 (default): 2026-09-14 .. 2026-10-13
  assert.equal(daily.length, 30);
  assert.equal(daily[0].created_at, '2026-09-14T12:00:00.000Z');
  assert.equal(daily.at(-1).created_at, '2026-10-13T12:00:00.000Z');
  assert.ok(gladys.fake.lastState(ids.feature(FEATURES.DAILY_VOLUME)) > 0, 'gas volume');
  assert.ok(gladys.fake.lastState(ids.feature(FEATURES.DAILY_COST)) > 0, 'cost');
  assert.equal(gladys.fake.lastState(ids.feature(FEATURES.YEAR_ENERGY)), 4321.5);
  assert.ok(gladys.fake.lastState(ids.feature(FEATURES.MONTH_ENERGY)) > 0, 'month total');
  assert.deepEqual(gladys.fake.transports.at(-1), {
    device_external_id: ids.device,
    transport: 'cloud',
  });
});

test('an electricity device also feeds its daily consumption to the Gladys energy path', async (t) => {
  const { gladys } = await setup(t);
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[1]);
  const ids = idsOf(gladys, ELEC_ID);
  const [batch] = gladys.fake.publishedEnergyConsumption;
  assert.equal(batch.device_feature_external_id, ids.feature(FEATURES.CONSUMPTION));
  assert.equal(batch.intervals.length, 30);
  assert.deepEqual(Object.keys(batch.intervals[0]).sort(), ['date', 'kwh']);
  assert.equal(
    gladys.fake.states.some(
      (state) => state.device_feature_external_id === ids.feature(FEATURES.DAILY_VOLUME),
    ),
    false,
    'no gas volume on electricity',
  );
});

test('a restart does not import the history again', async (t) => {
  const store = createMemoryStore();
  const first = await setup(t, { store });
  await createAllDevices(first.gladys);
  const created = first.gladys.fake.devices;

  const second = await setup(t, { store: createMemoryStore(store.snapshot()), devices: created });
  const dated = second.gladys.fake.states.filter((state) => state.created_at);
  assert.equal(dated.length, 0, 'no dated state published twice');
});

test('a new day fires "New daily reading" once, and "High consumption" above the threshold', async (t) => {
  const site = createFakeWebsite();
  const { gladys, integration } = await setup(t, {
    site,
    config: { ...CREDENTIALS, gas_alert_kwh: 60 },
  });
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first read announces nothing');

  site.days[GAS_ID].push({
    date: '2026-10-14',
    kwh: 75,
    volumeOfEnergy: 6.7,
    price: 9,
    ratio: 0,
    temperature: 5,
  });
  await integration.refresh('test');
  const events = gladys.fake.sceneEvents.map(({ key, data }) => ({ key, data }));
  const device = idsOf(gladys, GAS_ID).device;
  assert.deepEqual(events, [
    {
      key: TRIGGERS.DAILY_READING,
      data: { device, energy: 'gas', date: '2026-10-14', kwh: 75, cost: 9, volume: 6.7 },
    },
    {
      key: TRIGGERS.HIGH_CONSUMPTION,
      data: { device, energy: 'gas', date: '2026-10-14', kwh: 75, threshold: 60 },
    },
  ]);

  await integration.refresh('test');
  assert.equal(gladys.fake.sceneEvents.length, 2, 'the same day is not announced twice');
});

test('a read failing after working fires "Customer account unreachable" once', async (t) => {
  const site = createFakeWebsite();
  const { gladys, integration } = await setup(t, { site });
  await createAllDevices(gladys);
  site.blocked = true;

  const result = await integration.refresh('test');
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, 'blocked');
  await integration.refresh('test');
  const failed = gladys.fake.sceneEvents.filter(({ key }) => key === TRIGGERS.CONNECTION_FAILED);
  assert.equal(failed.length, 1, 'one event per transition');
  assert.equal(failed[0].data.reason, 'blocked');
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.ok(gladys.fake.connectionStatus.message.fr, 'the status says why, in French too');
  const badges = gladys.fake.transports.slice(-2);
  assert.deepEqual(
    badges.map((entry) => entry.transport),
    ['unreachable', 'unreachable'],
  );
});

test('without credentials, the account is reported not configured and nothing is called', async (t) => {
  const site = createFakeWebsite();
  const { gladys } = await setup(t, { site, config: {} });
  assert.equal(gladys.fake.connectionStatus.connected, false);
  assert.equal(site.requests.length, 0);
});

test('"Test the connection" lists the contracts, or says why it fails', async (t) => {
  const { gladys } = await setup(t);
  const ok = await gladys.fake.action('test_connection', {});
  assert.equal(ok.success, true);
  assert.match(ok.data.message.fr, /2 contrat/);

  await gladys.fake.configUpdated({ ...CREDENTIALS, password: 'wrong' });
  const refused = await gladys.fake.action('test_connection', {});
  assert.match(refused.data.message.en, /Sign-in refused/);
});

test('"Refresh now" reads the account and says up to which day', async (t) => {
  const { gladys, site } = await setup(t);
  const before = site.requests.length;
  const answer = await gladys.fake.action('refresh_now', {});
  assert.ok(site.requests.length > before);
  assert.match(answer.data.message.en, /2026-10-13/);
});

test('saving the configuration reads the account again', async (t) => {
  const { gladys, site } = await setup(t);
  const logins = site.logins;
  await gladys.fake.configUpdated({ ...CREDENTIALS, history_days: 10 });
  assert.ok(site.requests.length > 0);
  assert.equal(site.logins, logins, 'same credentials, same session');
});

test('the history import is paced under the host API limit', async (t) => {
  const site = createFakeWebsite();
  site.days[GAS_ID] = makeDays(120);
  const { gladys, sleeps } = await setup(t, {
    site,
    config: { ...CREDENTIALS, history_days: 90 },
  });
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  // 90 days × 3 gas features = 270 dated states: one pause.
  assert.equal(sleeps.length, 1);
  assert.equal(sleeps[0], 60_000);
});

test('"My contract prices" gives the prices of espaceclient.gazdebordeaux.fr as they are', async (t) => {
  const { gladys, site } = await setup(t);
  const answer = await gladys.fake.action('show_prices', {});
  assert.equal(answer.success, true);
  assert.match(
    answer.data.message.fr,
    /\(BASE, 6 kVA\) : 0,160164 €\/kWh, abonnement 15,87 €\/mois/,
  );
  assert.match(
    answer.data.message.fr,
    /saisissez-les dans le contrat d.énergie Gladys, modèle « Gaz de Bordeaux – Mon contrat »/,
  );
  const login = site.requests.find((r) => r.pathname === '/api/authentication-token');
  assert.equal(login.host, 'espaceclient.gazdebordeaux.fr');
});

test('"My contract prices" sends to the website when espaceclient cannot be read', async (t) => {
  const { gladys, site } = await setup(t);
  site.espace.me = { contracts: [] };
  const answer = await gladys.fake.action('show_prices', {});
  assert.match(answer.data.message.fr, /Impossible de lire vos prix.*aucun contrat trouvé/);
  assert.match(answer.data.message.fr, /« Votre prix actuel »/);
});
