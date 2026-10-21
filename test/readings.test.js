import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  latestDayFields,
  parseDaily,
  parseTotal,
  sumDays,
  toNumber,
} from '../src/gazdebordeaux/readings.js';
import {
  addDays,
  daysBetween,
  firstOfMonth,
  isDay,
  noonOf,
  parisDay,
} from '../src/gazdebordeaux/dates.js';

test('toNumber reads numbers, numeric strings and French decimals', () => {
  assert.equal(toNumber(12.5), 12.5);
  assert.equal(toNumber('12.5'), 12.5);
  assert.equal(toNumber('12,5'), 12.5);
  assert.equal(toNumber(null), null);
  assert.equal(toNumber(''), null);
  assert.equal(toNumber('n/a'), null);
});

test('parseDaily keeps the days, sorted, and drops the total and the days not read', () => {
  const days = parseDaily({
    '2026-10-13': { kwh: '41,5', volumeOfEnergy: 3.7, price: 4.98, temperature: 11 },
    '2026-10-12': { kwh: 40, volumeOfEnergy: 3.6, price: 4.8, temperature: 12 },
    '2026-10-14': { kwh: null, volumeOfEnergy: null, price: null },
    total: { kwh: 81.5 },
  });
  assert.deepEqual(
    days.map((day) => [day.date, day.kwh, day.cost]),
    [
      ['2026-10-12', 40, 4.8],
      ['2026-10-13', 41.5, 4.98],
    ],
  );
});

test('a peak/off-peak day is read from its split, as the website does', () => {
  const days = parseDaily({
    // Flagged: the split wins over the 0 the day carries in `kwh` and `price`.
    '2026-10-07': {
      kwh: 0,
      price: 0,
      isHphc: true,
      consumptionHp: 4.2,
      consumptionHc: '2,1',
      priceHp: 0.71,
      priceHc: 0.27,
    },
    // Not flagged, no plain value: the split still counts.
    '2026-10-08': { kwh: null, consumptionHp: 3, consumptionHc: 1, price: 0.6 },
    // A Base day that happens to carry an empty split keeps its own value.
    '2026-10-09': { kwh: 5, price: 0.9, consumptionHp: 0, consumptionHc: 0 },
    // Nothing read yet.
    '2026-10-10': { kwh: null, isHphc: true, consumptionHp: null, consumptionHc: null },
  });
  assert.deepEqual(
    days.map((day) => [day.date, day.kwh, day.cost]),
    [
      ['2026-10-07', 6.3, 0.98],
      ['2026-10-08', 4, 0.6],
      ['2026-10-09', 5, 0.9],
    ],
  );
});

test('latestDayFields names the fields of the latest day, never their values', () => {
  assert.deepEqual(
    latestDayFields({
      '2026-10-07': { kwh: 1 },
      '2026-10-08': { kwh: 0, isHphc: true, consumptionHp: 3 },
      total: { kwh: 1 },
    }),
    ['kwh', 'isHphc', 'consumptionHp'],
  );
  assert.deepEqual(latestDayFields({ total: {} }), []);
  assert.deepEqual(latestDayFields(null), []);
});

test('an unexpected payload is an "api" error', () => {
  assert.throws(() => parseDaily(null), { kind: 'api' });
  assert.throws(() => parseDaily([1, 2]), { kind: 'api' });
  assert.throws(() => parseTotal({ '2026-10-12': {} }), { kind: 'api' });
});

test('parseTotal reads the total entry', () => {
  assert.deepEqual(parseTotal({ total: { kwh: 100, volumeOfEnergy: 9, price: 12.3 } }), {
    kwh: 100,
    volume: 9,
    cost: 12.3,
  });
});

test('sumDays adds the days from a given day, a missing quantity stays null', () => {
  const days = [
    { date: '2026-09-30', kwh: 10, volume: null, cost: 1 },
    { date: '2026-10-01', kwh: 1.1, volume: null, cost: 0.1 },
    { date: '2026-10-02', kwh: 2.2, volume: null, cost: 0.2 },
  ];
  assert.deepEqual(sumDays(days, '2026-10-01'), { kwh: 3.3, volume: null, cost: 0.3 });
  assert.deepEqual(sumDays([], '2026-10-01'), { kwh: 0, volume: null, cost: null });
});

test('days are counted on the Paris calendar', () => {
  // 23:30 UTC on 14 October is already the 15th in Paris (UTC+2).
  assert.equal(parisDay(new Date('2026-10-14T23:30:00Z')), '2026-10-15');
  // 22:30 UTC on 14 December is still the 14th in Paris (UTC+1).
  assert.equal(parisDay(new Date('2026-12-14T22:30:00Z')), '2026-12-14');
});

test('day arithmetic ignores daylight saving time', () => {
  assert.equal(addDays('2026-10-24', 2), '2026-10-26');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(firstOfMonth('2026-10-14'), '2026-10-01');
  assert.equal(daysBetween('2026-10-10', '2026-10-14'), 4);
  assert.equal(noonOf('2026-10-14'), '2026-10-14T12:00:00.000Z');
  assert.equal(isDay('2026-02-30'), false);
  assert.equal(isDay('2026-02-28'), true);
  assert.equal(isDay('total'), false);
});
