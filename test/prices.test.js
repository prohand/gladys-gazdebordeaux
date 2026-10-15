import { test } from 'node:test';
import assert from 'node:assert/strict';
import { contractPrices, parseOffPeakTimes } from '../src/gazdebordeaux/prices.js';
import { addDays } from '../src/gazdebordeaux/dates.js';
import { parseDaily } from '../src/gazdebordeaux/readings.js';
import { contractPricesLine, contractPricesMessage } from '../src/messages.js';
import {
  KWH_PRICE,
  makeDays,
  makePeakOffPeakDays,
  OFF_PEAK_PRICE,
  PEAK_PRICE,
  SUBSCRIPTION_PER_MONTH,
} from './helpers/fakeWebsite.js';

const payloadOf = (days) => Object.fromEntries(days.map(({ date, ...values }) => [date, values]));
const snapshotOf = (contract, days) => ({ contract, days: parseDaily(payloadOf(days)) });

const BASE = { energy: 'electricity', power: 6, priceCategory: 'BASE', offPeakTimes: null };
const HPHC = {
  energy: 'electricity',
  power: 9,
  priceCategory: 'HPHC',
  offPeakTimes: ['22h00-6h00'],
};

test('the kWh price and the subscription of a base contract come back from its days', () => {
  const prices = contractPrices(snapshotOf(BASE, makeDays(40, { gas: false })));
  assert.equal(prices.kwhPrice, KWH_PRICE);
  assert.equal(prices.subscriptionPerMonth, SUBSCRIPTION_PER_MONTH);
  assert.equal(prices.peakOffPeak, false);
  assert.equal(prices.power, 6);
  assert.equal(prices.days, 30, 'the latest 30 days only');
  assert.equal(prices.changedOn, null);
});

test('a peak/off-peak contract gets both prices and its off-peak hours', () => {
  const prices = contractPrices(snapshotOf(HPHC, makePeakOffPeakDays(20)));
  assert.equal(prices.peakOffPeak, true);
  assert.equal(prices.peakPrice, PEAK_PRICE);
  assert.equal(prices.offPeakPrice, OFF_PEAK_PRICE);
  assert.equal(prices.subscriptionPerMonth, SUBSCRIPTION_PER_MONTH);
  assert.deepEqual(prices.offPeakSlots, [['22:00', '06:00']]);
});

test('a day with a pro-rata does not move the price', () => {
  const days = makeDays(10, { gas: false });
  days[3].consumptionPrice *= 3;
  const prices = contractPrices(snapshotOf(BASE, days));
  assert.equal(prices.kwhPrice, KWH_PRICE);
  assert.equal(prices.changedOn, null, 'one day off is not a change');
});

// A real account (October 2026): 0.160164 €/kWh and 15.87 €/month, every
// daily amount rounded to the cent, the subscription split over the days of
// each month (0.53 € in September, 0.51 € in October). The median of the
// daily ratios and "share × 365 / 12" gave 0.1606 and 16.12.
test('amounts rounded to the cent still give the prices of the contract', () => {
  const cents = (value) => Math.round(value * 100) / 100;
  const days = Array.from({ length: 28 }, (_, i) => {
    const date = addDays('2026-09-16', i);
    const kwh = 4 + ((i * 7) % 9) + 0.3;
    const share = cents(15.87 / (date.startsWith('2026-09') ? 30 : 31));
    const consumptionPrice = cents(kwh * 0.160164);
    return { date, kwh, consumptionPrice, contractPrice: share, price: consumptionPrice + share };
  });
  const prices = contractPrices(snapshotOf(BASE, days));
  assert.ok(Math.abs(prices.kwhPrice - 0.160164) <= 0.00001, `kWh price ${prices.kwhPrice}`);
  assert.ok(
    Math.abs(prices.subscriptionPerMonth - 15.87) <= 0.02,
    `subscription ${prices.subscriptionPerMonth}`,
  );
  assert.equal(prices.changedOn, null, 'a share that follows the days of the month is no change');
});

test('a subscription spread evenly over the year comes back as its monthly amount', () => {
  const days = makeDays(40, { gas: false }).map((day) => ({ ...day, contractPrice: 0.52 }));
  const prices = contractPrices(snapshotOf(BASE, days));
  assert.equal(prices.subscriptionPerMonth, 15.82);
  assert.equal(prices.changedOn, null);
});

// The days of a base contract from 2026-12-20 to 2027-02-14, rounded to the
// cent like the website, the prices changing on `changeOn`.
function changingDays({ changeOn, before, after }) {
  const cents = (value) => Math.round(value * 100) / 100;
  return Array.from({ length: 57 }, (_, i) => {
    const date = addDays('2026-12-20', i);
    const { kwhPrice, monthly } = date < changeOn ? before : after;
    const kwh = 3 + ((i * 53) % 97) / 7;
    const share = cents(
      monthly / Number(new Date(Date.UTC(2027, Number(date.slice(5, 7)), 0)).getUTCDate()),
    );
    const consumptionPrice = cents(kwh * kwhPrice);
    return { date, kwh, consumptionPrice, contractPrice: share, price: consumptionPrice + share };
  });
}

// Two weeks of days bound the prices less tightly than 30: within 0.00015 €/kWh
// and 0.10 €/month here.
test('a kWh price change gives its day and the prices since then only', () => {
  const days = changingDays({
    changeOn: '2027-02-01',
    before: { kwhPrice: 0.160164, monthly: 15.87 },
    after: { kwhPrice: 0.17112, monthly: 15.87 },
  });
  const prices = contractPrices(snapshotOf(BASE, days));
  assert.equal(prices.changedOn, '2027-02-01');
  assert.equal(prices.days, 14);
  assert.ok(Math.abs(prices.kwhPrice - 0.17112) <= 0.00015, `kWh price ${prices.kwhPrice}`);
});

test('a subscription change is a price change too', () => {
  const days = changingDays({
    changeOn: '2027-01-15',
    before: { kwhPrice: 0.160164, monthly: 15.87 },
    after: { kwhPrice: 0.160164, monthly: 17.42 },
  });
  const prices = contractPrices(snapshotOf(BASE, days));
  assert.equal(prices.changedOn, '2027-01-15');
  assert.ok(Math.abs(prices.subscriptionPerMonth - 17.42) <= 0.1, `${prices.subscriptionPerMonth}`);
});

test('a peak/off-peak price change is found on either price', () => {
  const days = makePeakOffPeakDays(20).map((day, i) =>
    i < 12 ? day : { ...day, priceHc: day.consumptionHc * 0.15532 },
  );
  const prices = contractPrices(snapshotOf(HPHC, days));
  assert.equal(prices.changedOn, days[12].date);
  assert.equal(prices.offPeakPrice, 0.15532);
  assert.equal(prices.peakPrice, PEAK_PRICE);
});

test('without the cost detail (gas, old days), there is no price to give', () => {
  assert.equal(contractPrices(snapshotOf({ energy: 'gas' }, makeDays(10))), null);
});

test('the off-peak hours are read whatever their shape', () => {
  assert.deepEqual(parseOffPeakTimes('22h00-6h00'), [['22:00', '06:00']]);
  assert.deepEqual(parseOffPeakTimes('01:30 - 07:30, 12:30 - 14:30'), [
    ['01:30', '07:30'],
    ['12:30', '14:30'],
  ]);
  assert.deepEqual(parseOffPeakTimes(['22:00', '06:00']), [['22:00', '06:00']]);
  assert.deepEqual(parseOffPeakTimes([{ start: '23:00', end: '07:00' }]), [['23:00', '07:00']]);
  assert.equal(parseOffPeakTimes('not a time'), null);
  assert.equal(parseOffPeakTimes(null), null);
});

test('the prices line reads like the contract wizard asks for them', () => {
  const prices = contractPrices(snapshotOf(HPHC, makePeakOffPeakDays(20)));
  assert.equal(
    contractPricesLine('fr', prices),
    'Électricité (9 kVA, heures creuses 22:00–06:00) : HP 0,19648 €/kWh, HC 0,14669 €/kWh, abonnement 15,87 €/mois',
  );
  assert.equal(
    contractPricesLine('en', prices),
    'Electricity (9 kVA, off-peak 22:00–06:00): peak 0.19648 €/kWh, off-peak 0.14669 €/kWh, subscription 15.87 €/month',
  );
});

test('the prices message exists in the four languages, and says when nothing is known', () => {
  const known = contractPricesMessage([
    contractPrices(snapshotOf(BASE, makeDays(5, { gas: false }))),
  ]);
  const unknown = contractPricesMessage([null]);
  for (const message of [known, unknown]) {
    assert.deepEqual(Object.keys(message), ['en', 'fr', 'de', 'es']);
  }
  assert.match(known.fr, /0,18373 €\/kWh/);
  assert.match(unknown.en, /no price/);
});

test('the prices message says when the prices changed and what to do in Gladys', () => {
  const days = changingDays({
    changeOn: '2027-02-01',
    before: { kwhPrice: 0.160164, monthly: 15.87 },
    after: { kwhPrice: 0.17112, monthly: 15.87 },
  });
  const message = contractPricesMessage([contractPrices(snapshotOf(BASE, days))]);
  assert.match(
    message.fr,
    /Nouveaux prix depuis le 01\/02\/2027 : terminez votre contrat Gladys le 31\/01\/2027/,
  );
  assert.match(message.de, /Neue Preise seit 01\.02\.2027/);
  assert.match(message.fr, /Calculé sur les 14 derniers jours/);
});
