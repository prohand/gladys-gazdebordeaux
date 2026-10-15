import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentPrices, parseOffPeakTimes } from '../src/gazdebordeaux/prices.js';
import { ERROR_KINDS } from '../src/gazdebordeaux/client.js';
import {
  contractPricesLine,
  contractPricesMessage,
  pricesUnavailableMessage,
} from '../src/messages.js';
import { ELEC_CONTRACT, GAS_CONTRACT } from './helpers/fakeWebsite.js';

const ELEC = { id: 1001, type: 'elec' };

test('the prices of a base contract are the ones the customer website shows', () => {
  assert.deepEqual(currentPrices({ summary: ELEC, details: ELEC_CONTRACT }), {
    id: '1001',
    energy: 'electricity',
    offer: 'OFFRE ECODIGO ELEC 100% ÉLECTRICITÉ VERTE',
    option: 'BASE',
    power: 6,
    offPeakSlots: null,
    kwhPrice: 0.160164,
    peakPrice: null,
    offPeakPrice: null,
    subscriptionPerMonth: 15.87,
  });
});

test('a peak/off-peak contract gets both prices and its off-peak hours', () => {
  const prices = currentPrices({
    summary: ELEC,
    details: {
      optionTarif: 'HEURES CREUSES',
      power: '9',
      offPeakHours: '22h00-6h00',
      tarifScale: {
        prixTotalTTCAbo: '19,88',
        base: null,
        hp: { prixConsoUniteWithTaxeTTC: '0.19648' },
        hc: { prixConsoUniteWithTaxeTTC: 0.14669 },
      },
    },
  });
  assert.equal(prices.kwhPrice, null);
  assert.equal(prices.peakPrice, 0.19648);
  assert.equal(prices.offPeakPrice, 0.14669);
  assert.equal(prices.subscriptionPerMonth, 19.88);
  assert.equal(prices.power, 9);
  assert.deepEqual(prices.offPeakSlots, [['22:00', '06:00']]);
});

test('the subscription falls back on tarifScale.abo, and a gas contract on its kWh price', () => {
  const elec = currentPrices({
    summary: ELEC,
    details: { tarifScale: { abo: { prixAboTTC: 15.87 }, base: null } },
  });
  assert.equal(elec.subscriptionPerMonth, 15.87);
  const gas = currentPrices({ summary: { id: 7, type: 'gaz' }, details: GAS_CONTRACT });
  assert.equal(gas.energy, 'gas');
  assert.equal(gas.offer, 'NovaFixe Gaz');
  assert.equal(gas.kwhPrice, 0.11872);
  assert.equal(gas.subscriptionPerMonth, 21.4);
});

test('a contract without tarifScale gives no price, and says so', () => {
  const prices = currentPrices({ summary: ELEC, details: {} });
  assert.equal(prices.kwhPrice, null);
  assert.equal(prices.subscriptionPerMonth, null);
  assert.equal(
    contractPricesLine('fr', prices),
    "Électricité : aucun prix donné par l'espace client",
  );
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

test('the prices line gives every decimal of the website', () => {
  const prices = currentPrices({ summary: ELEC, details: ELEC_CONTRACT });
  assert.equal(
    contractPricesLine('fr', prices),
    'Électricité, OFFRE ECODIGO ELEC 100% ÉLECTRICITÉ VERTE (BASE, 6 kVA) : 0,160164 €/kWh, abonnement 15,87 €/mois',
  );
  assert.equal(
    contractPricesLine('en', prices),
    'Electricity, OFFRE ECODIGO ELEC 100% ÉLECTRICITÉ VERTE (BASE, 6 kVA): 0.160164 €/kWh, subscription 15.87 €/month',
  );
});

test('the prices messages exist in the four languages', () => {
  const known = contractPricesMessage([currentPrices({ summary: ELEC, details: ELEC_CONTRACT })]);
  const unavailable = pricesUnavailableMessage({ kind: ERROR_KINDS.AUTH });
  for (const message of [known, unavailable]) {
    assert.deepEqual(Object.keys(message), ['en', 'fr', 'de', 'es']);
  }
  assert.match(known.fr, /Prix actuels de votre espace client/);
  assert.match(unavailable.fr, /connexion refusée.*« Votre prix actuel »/);
  assert.match(pricesUnavailableMessage(new Error('boom')).en, /unexpected answer/);
});
