// -----------------------------------------------------------------------------
// The "My contract" energy contract template: the prices of
// espaceclient.gazdebordeaux.fr kept in the store feed its daily price calendar.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import {
  CALENDAR_TEMPLATE,
  dayPrice,
  isOffPeak,
  PRICE_CALENDAR,
  publishPriceCalendar,
  offPeakMinutes,
  recordPriceHistory,
} from '../src/capabilities/energy.js';
import { createMemoryStore } from '../src/store.js';

const CONTRACT = {
  id: 'c1',
  template_key: 'novafixe-elec-base',
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

// --- The price calendar -----------------------------------------------------

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

test('no price read yet: nothing published', async () => {
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
