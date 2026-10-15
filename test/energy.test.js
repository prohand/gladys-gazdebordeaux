// -----------------------------------------------------------------------------
// The delegated "My contract" energy contract template: the kWh priced with
// the prices of espaceclient.gazdebordeaux.fr kept in the store.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  CALENDAR_TEMPLATE,
  currentPrice,
  dayPrice,
  isOffPeak,
  PRICE_CALENDAR,
  publishPriceCalendar,
  offPeakMinutes,
  priceIntervals,
  recordPriceHistory,
} from '../src/capabilities/energy.js';
import { createMemoryStore } from '../src/store.js';
import { setup } from './helpers/setup.js';

const CONTRACT = {
  id: 'c1',
  template_key: 'espaceclient-elec',
  inputs: {},
  currency: 'EUR',
  timezone: 'Europe/Paris',
  billing_period_start_day: 1,
};

const BASE = {
  id: '1001',
  energy: 'electricity',
  kwhPrice: 0.160164,
  peakPrice: null,
  offPeakPrice: null,
  offPeakSlots: null,
};
const PEAK_OFF_PEAK = {
  ...BASE,
  kwhPrice: null,
  peakPrice: 0.2,
  offPeakPrice: 0.15,
  offPeakSlots: [['22:00', '06:00']],
};

async function storeWith(...reads) {
  const store = createMemoryStore();
  for (const [today, prices] of reads) {
    await recordPriceHistory([prices], { store, today });
  }
  return store;
}

// 2026-10-14 in Paris is UTC+2: local midnight is 22:00 UTC the day before.
const LOCAL_MIDNIGHT = '2026-10-13T22:00:00.000Z';

test('the off-peak hours cross midnight, the end excluded', () => {
  const slots = [['22:00', '06:00']];
  assert.equal(isOffPeak(22 * 60, slots), true);
  assert.equal(isOffPeak(5 * 60 + 59, slots), true);
  assert.equal(isOffPeak(6 * 60, slots), false);
  assert.equal(offPeakMinutes(0, 24 * 60, slots), 8 * 60);
  assert.equal(offPeakMinutes(21 * 60 + 30, 60, slots), 30);
});

test('the prices are kept with the day they were read, once per change', async () => {
  const store = await storeWith(
    ['2026-10-01', BASE],
    ['2026-10-02', BASE],
    ['2026-10-10', { ...BASE, kwhPrice: 0.17 }],
    ['2026-10-10', { ...BASE, kwhPrice: 0.18 }],
    ['2026-10-11', { id: '1000', energy: 'gas', kwhPrice: 0.11872 }],
  );
  const history = store.snapshot()['price-history'];
  assert.deepEqual(Object.keys(history), ['1001'], 'gas is not kept');
  assert.deepEqual(
    history['1001'].entries.map((entry) => [entry.from, entry.kwhPrice]),
    [
      ['2026-10-01', 0.160164],
      ['2026-10-10', 0.18],
    ],
  );
});

test('a base contract: every kWh at the price of its day', async () => {
  const store = await storeWith(['2026-10-05', BASE], ['2026-10-10', { ...BASE, kwhPrice: 0.2 }]);
  const costs = priceIntervals(
    {
      contract: CONTRACT,
      intervals: [
        { starts_at: '2026-09-01T22:00:00.000Z', kwh: 10, max_power_kw: 10 / 24 },
        { starts_at: '2026-10-08T22:00:00.000Z', kwh: 10, max_power_kw: 10 / 24 },
        { starts_at: LOCAL_MIDNIGHT, kwh: 10, max_power_kw: 10 / 24 },
      ],
    },
    { store },
  );
  assert.deepEqual(
    costs.map((c) => c.cost),
    [1.60164, 1.60164, 2],
    'before the first read: the first prices read',
  );
  assert.equal(costs[0].label, 'Base');
  assert.equal(costs[0].starts_at, '2026-09-01T22:00:00.000Z');
});

test('peak/off-peak: a half-hour at its own price, a day split by its off-peak hours', async () => {
  const store = await storeWith(['2026-10-01', PEAK_OFF_PEAK]);
  const costs = priceIntervals(
    {
      contract: CONTRACT,
      intervals: [
        // 23:00 and 12:00 in Paris, half-hours.
        { starts_at: '2026-10-14T21:00:00.000Z', kwh: 1, max_power_kw: 2 },
        { starts_at: '2026-10-14T10:00:00.000Z', kwh: 1, max_power_kw: 2 },
        // A whole day (daily readings): 8 hours off-peak out of 24.
        { starts_at: LOCAL_MIDNIGHT, kwh: 24, max_power_kw: 1 },
      ],
    },
    { store },
  );
  assert.deepEqual(
    costs.map((c) => [c.cost, c.label]),
    [
      [0.15, 'Heures creuses'],
      [0.2, 'Heures pleines'],
      [8 * 0.15 + 16 * 0.2, 'Heures pleines / creuses'],
    ],
  );
});

test('off-peak hours not read on espaceclient: the ones typed in the contract', async () => {
  const store = await storeWith(['2026-10-01', { ...PEAK_OFF_PEAK, offPeakSlots: null }]);
  const request = {
    contract: CONTRACT,
    intervals: [{ starts_at: '2026-10-14T21:00:00.000Z', kwh: 1, max_power_kw: 2 }],
  };
  assert.throws(() => priceIntervals(request, { store }), /Off-peak hours unknown/);
  const typed = { ...CONTRACT, inputs: { off_peak_slots: [['23:00', '07:00']] } };
  const [cost] = priceIntervals({ ...request, contract: typed }, { store });
  assert.equal(cost.cost, 0.15);
});

test('prices never read: no cost rather than a wrong one', () => {
  assert.throws(
    () => priceIntervals({ contract: CONTRACT, intervals: [] }, { store: createMemoryStore() }),
    /never read/,
  );
});

test('the current price says when it changes', async () => {
  const base = await storeWith(['2026-10-01', BASE]);
  assert.deepEqual(currentPrice({ contract: CONTRACT }, { store: base, now: new Date() }), {
    price: 0.160164,
    valid_until: null,
    label: 'Base',
  });

  const store = await storeWith(['2026-10-01', PEAK_OFF_PEAK]);
  // 20:15:30 in Paris: peak until 22:00.
  const now = new Date('2026-10-14T18:15:30.000Z');
  assert.deepEqual(currentPrice({ contract: CONTRACT }, { store, now }), {
    price: 0.2,
    valid_until: '2026-10-14T20:00:00.000Z',
    next_price: 0.15,
    label: 'Heures pleines',
    next_label: 'Heures creuses',
  });
});

test('the subscription is spread over the minutes of the month, like the core does', async () => {
  const store = await storeWith(['2026-10-01', { ...BASE, subscriptionPerMonth: 30 }]);
  const [day, halfHour] = priceIntervals(
    {
      contract: CONTRACT,
      intervals: [
        { starts_at: LOCAL_MIDNIGHT, kwh: 0, max_power_kw: 0 },
        { starts_at: '2026-10-14T10:00:00.000Z', kwh: 1, max_power_kw: 2 },
      ],
    },
    { store },
  );
  const octoberMinutes = 31 * 1440 + 60;
  assert.equal(day.components.subscription, Math.round(((30 * 1440) / octoberMinutes) * 1e6) / 1e6);
  assert.equal(
    halfHour.components.subscription,
    Math.round(((30 * 30) / octoberMinutes) * 1e6) / 1e6,
  );
  assert.equal(halfHour.cost, Math.round((0.160164 + (30 * 30) / octoberMinutes) * 1e6) / 1e6);

  // A contract of the first template version: the core adds its subscription input.
  const old = { ...CONTRACT, inputs: { subscription_per_month: 30 } };
  const [oldDay] = priceIntervals(
    { contract: old, intervals: [{ starts_at: LOCAL_MIDNIGHT, kwh: 10, max_power_kw: 10 / 24 }] },
    { store },
  );
  assert.deepEqual(oldDay.components, { energy: 1.60164 });
  assert.equal(oldDay.cost, 1.60164);
});

test('prices kept before the subscription was: the first subscription known', async () => {
  const store = await storeWith(
    ['2026-10-01', BASE],
    ['2026-10-10', { ...BASE, subscriptionPerMonth: 15.87 }],
  );
  const [cost] = priceIntervals(
    {
      contract: CONTRACT,
      intervals: [{ starts_at: '2026-10-04T22:00:00.000Z', kwh: 0, max_power_kw: 0 }],
    },
    { store },
  );
  assert.ok(cost.components.subscription > 0);
});

test('Gladys prices the template with the prices read at the refresh', async (t) => {
  const { gladys } = await setup(t);
  const ack = await gladys.fake.energyPrice({
    contract: CONTRACT,
    billing_period: { starts_at: '2026-10-01', ends_at: '2026-10-31' },
    cumulative_before: { day: 0, month: 0, billing_period: 0 },
    intervals: [{ starts_at: LOCAL_MIDNIGHT, kwh: 10, max_power_kw: 10 / 24 }],
  });
  assert.equal(ack.success, true);
  // October 2026 in Paris: 31 days + the hour of the autumn DST change.
  const subscription = Math.round(((15.87 * 1440) / (31 * 1440 + 60)) * 1e6) / 1e6;
  assert.deepEqual(ack.data.costs, [
    {
      starts_at: LOCAL_MIDNIGHT,
      cost: Math.round((1.60164 + subscription) * 1e6) / 1e6,
      components: { energy: 1.60164, subscription },
      label: 'Base',
    },
  ]);

  const current = await gladys.fake.energyCurrent({
    contract: CONTRACT,
    billing_period: { starts_at: '2026-10-01', ends_at: '2026-10-31' },
    cumulative: { day: 0, month: 0, billing_period: 0 },
    max_power_kw: 1,
  });
  assert.equal(current.data.price, 0.160164);
});

// --- The price calendar of the "computed by Gladys" template ----------------

const fakeGladys = (energyContracts = []) =>
  createFakeGladys({ energyCalendars: { [PRICE_CALENDAR]: [] }, energyContracts });

const published = (gladys) =>
  gladys.fake.publishedEnergyCalendars.flatMap(({ calendar_key, entries }) => {
    assert.equal(calendar_key, PRICE_CALENDAR);
    return entries;
  });

test('the price of a day: the base price, or peak/off-peak by the off-peak share of the day', () => {
  assert.equal(dayPrice(BASE, '2026-10-14'), 0.160164);
  // 8 hours off-peak out of 24: 1/3 at 0.15, 2/3 at 0.2.
  assert.equal(dayPrice(PEAK_OFF_PEAK, '2026-10-14'), 0.183333);
  const noHours = { ...PEAK_OFF_PEAK, offPeakSlots: null };
  assert.equal(dayPrice(noHours, '2026-10-14'), null);
  assert.equal(
    dayPrice(noHours, '2026-10-14', { inputs: { off_peak_slots: [['22:00', '06:00']] } }),
    0.183333,
  );
});

test('the calendar gets one price a day, from the first read to 7 days ahead', async () => {
  const store = await storeWith(['2026-10-05', BASE], ['2026-10-10', { ...BASE, kwhPrice: 0.2 }]);
  const gladys = fakeGladys();
  await gladys.connect();
  const count = await publishPriceCalendar(gladys, { store, today: '2026-10-14' });
  const entries = published(gladys);
  assert.equal(count, entries.length);
  assert.deepEqual(entries.at(0), { date: '2026-10-05', price: 0.160164 });
  assert.deepEqual(
    entries.find((e) => e.date === '2026-10-09'),
    {
      date: '2026-10-09',
      price: 0.160164,
    },
  );
  assert.deepEqual(
    entries.find((e) => e.date === '2026-10-10'),
    { date: '2026-10-10', price: 0.2 },
  );
  assert.deepEqual(entries.at(-1), { date: '2026-10-21', price: 0.2 });
  await gladys.disconnect();
});

test('the calendar goes back to the start of a contract, with the first prices read', async () => {
  const store = await storeWith(['2026-10-05', PEAK_OFF_PEAK]);
  const gladys = fakeGladys([
    { ...CONTRACT, id: 'c2', template_key: CALENDAR_TEMPLATE, valid_from: '2026-09-01' },
    { ...CONTRACT, id: 'c3', valid_from: '2020-01-01' },
  ]);
  await gladys.connect();
  await publishPriceCalendar(gladys, { store, today: '2026-10-14' });
  const entries = published(gladys);
  assert.deepEqual(entries.at(0), { date: '2026-09-01', price: 0.183333 });
  assert.equal(entries.length, 30 + 21, 'September, then October to the 21st');
  await gladys.disconnect();
});

test('no price read yet: nothing published, the contract applies its fallback price', async () => {
  const gladys = fakeGladys();
  await gladys.connect();
  const count = await publishPriceCalendar(gladys, {
    store: createMemoryStore(),
    today: '2026-10-14',
  });
  assert.equal(count, 0);
  assert.deepEqual(gladys.fake.publishedEnergyCalendars, []);
  await gladys.disconnect();
});
