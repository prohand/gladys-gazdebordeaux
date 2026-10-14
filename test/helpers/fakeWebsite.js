// -----------------------------------------------------------------------------
// A fake life.gazdebordeaux.fr: the `fetch` the client is given in the tests.
// It answers like the real website (JSON endpoints, 401 on bad credentials or
// an expired token, the HTML page of its filter when "blocked") and records
// every request. No network, ever.
// -----------------------------------------------------------------------------

import { addDays } from '../../src/gazdebordeaux/dates.js';

export const EMAIL = 'jane@example.com';
export const PASSWORD = 'correct horse';
export const GAS_ID = '0b7d4c3e-1111-4a5b-9c8d-00000000a001';
export const ELEC_ID = '0b7d4c3e-2222-4a5b-9c8d-00000000b002';
export const TODAY = '2026-10-14';

// The October 2026 NovaFixe Élec prices: what the electricity days are
// charged at, so the prices computed back from them can be checked.
export const KWH_PRICE = 0.18373;
export const PEAK_PRICE = 0.19648;
export const OFF_PEAK_PRICE = 0.14669;
export const SUBSCRIPTION_PER_MONTH = 15.87;
const DAILY_SUBSCRIPTION = (SUBSCRIPTION_PER_MONTH * 12) / 365;

/** `count` days ending the day before `today`, oldest first. */
export function makeDays(count, { today = TODAY, kwh = (i) => 40 + i, gas = true } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(today, i - count);
    if (gas) {
      // Gas days: the total price only, no split (like the oldest days).
      return {
        date,
        kwh: kwh(i),
        volumeOfEnergy: Math.round((kwh(i) / 11.2) * 100) / 100,
        price: Math.round(kwh(i) * 0.12 * 100) / 100,
        ratio: 0,
        temperature: 12,
      };
    }
    const consumptionPrice = kwh(i) * KWH_PRICE;
    return {
      date,
      kwh: kwh(i),
      volumeOfEnergy: 0,
      price: Math.round((consumptionPrice + DAILY_SUBSCRIPTION) * 100) / 100,
      consumptionPrice,
      contractPrice: DAILY_SUBSCRIPTION,
      ratio: 0,
      temperature: 12,
    };
  });
}

/** Electricity days of a peak/off-peak contract: the kWh and their cost split. */
export function makePeakOffPeakDays(count, { today = TODAY } = {}) {
  return Array.from({ length: count }, (_, i) => {
    const peak = 20 + (i % 5);
    const offPeak = 12 + (i % 3);
    return {
      date: addDays(today, i - count),
      isHphc: true,
      consumptionHp: peak,
      consumptionHc: offPeak,
      priceHp: peak * PEAK_PRICE,
      priceHc: offPeak * OFF_PEAK_PRICE,
      contractPrice: DAILY_SUBSCRIPTION,
      price: peak * PEAK_PRICE + offPeak * OFF_PEAK_PRICE + DAILY_SUBSCRIPTION,
      temperature: 12,
    };
  });
}

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function createFakeWebsite({
  contracts = [
    { id: GAS_ID, category: 'gas' },
    { id: ELEC_ID, category: 'electricity' },
  ],
  selectedHouse = null,
} = {}) {
  const site = {
    email: EMAIL,
    password: PASSWORD,
    me: { selectedHouse, houses: contracts.map(({ id }) => `/api/houses/${id}`) },
    houses: Object.fromEntries(
      contracts.map(({ id, category, house = {} }) => [
        id,
        {
          id,
          contractType: { category },
          ...(category === 'electricity'
            ? { electricityPower: 6, priceCategory: 'BASE', offPeakTimes: null }
            : {}),
          ...house,
        },
      ]),
    ),
    days: Object.fromEntries(
      contracts.map(({ id, category }) => [id, makeDays(40, { gas: category === 'gas' })]),
    ),
    years: Object.fromEntries(
      contracts.map(({ id }) => [id, { kwh: 4321.5, volumeOfEnergy: 385.8, price: 612.4 }]),
    ),
    blocked: false,
    down: false,
    tokens: new Set(),
    logins: 0,
    requests: [],
  };

  /** Expire every token, as the website does after a few hours. */
  site.expireTokens = () => site.tokens.clear();

  site.fetch = async (url, init = {}) => {
    const { pathname, searchParams } = new URL(url);
    const method = init.method ?? 'GET';
    site.requests.push({ method, pathname, query: Object.fromEntries(searchParams), init });

    if (site.down) {
      throw new TypeError('fetch failed');
    }
    if (site.blocked) {
      return new Response('<html><body>403 Forbidden</body></html>', {
        status: 403,
        headers: { 'content-type': 'text/html' },
      });
    }

    if (method === 'POST' && pathname === '/api/login_check') {
      const body = JSON.parse(init.body);
      if (body.email !== site.email || body.password !== site.password) {
        return json(401, { code: 401, message: 'Invalid credentials.' });
      }
      site.logins += 1;
      const token = `token-${site.logins}`;
      site.tokens.add(token);
      return json(200, { token });
    }

    const token = (init.headers?.Authorization ?? '').replace('Bearer ', '');
    if (!site.tokens.has(token)) {
      return json(401, { code: 401, message: 'Expired JWT Token' });
    }
    if (pathname === '/api/users/me') {
      return json(200, site.me);
    }
    const house = pathname.match(/^\/api\/houses\/([^/]+)(\/consumptions)?$/);
    if (!house || !site.houses[house[1]]) {
      // The website answers its single-page app for any unknown path.
      return new Response('<!doctype html><html></html>', {
        status: 200,
        headers: { 'content-type': 'text/html' },
      });
    }
    const id = house[1];
    if (!house[2]) {
      return json(200, site.houses[id]);
    }
    if (searchParams.get('scale') === 'year') {
      return json(200, { total: site.years[id] });
    }
    const start = searchParams.get('startDate') ?? '0000-00-00';
    const end = searchParams.get('endDate') ?? '9999-99-99';
    const days = site.days[id].filter((day) => day.date >= start && day.date <= end);
    const payload = Object.fromEntries(days.map(({ date, ...values }) => [date, values]));
    payload.total = {
      kwh: days.reduce((sum, day) => sum + day.kwh, 0),
      volumeOfEnergy: days.reduce((sum, day) => sum + day.volumeOfEnergy, 0),
      price: days.reduce((sum, day) => sum + day.price, 0),
    };
    return json(200, payload);
  };

  return site;
}
