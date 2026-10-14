import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { contractIds } from '../src/devices/contract.js';
import { CONSUMPTION_WIDGET } from '../src/capabilities/widget.js';
import { CREDENTIALS, setup } from './helpers/setup.js';
import { ELEC_ID, GAS_ID } from './helpers/fakeWebsite.js';

const get = (gladys, settings = {}, language = 'en') =>
  gladys.fake.widgetGet(CONSUMPTION_WIDGET, { settings, language, units: 'metric' });

test('the widget content of each contract is rendered exactly as sent', async (t) => {
  const { gladys } = await setup(t);
  for (const id of [GAS_ID, ELEC_ID]) {
    for (const language of ['en', 'fr', 'de', 'es']) {
      const ack = await get(gladys, { device: contractIds(gladys, { id }).device }, language);
      assert.equal(ack.success, true);
      assert.deepEqual(validateWidgetContent(ack.data.content), [], `${id} in ${language}`);
    }
  }
});

test('the widget shows the chosen contract, the first one by default', async (t) => {
  const { gladys } = await setup(t);
  const statusOf = async (settings) =>
    (await get(gladys, settings)).data.content.components.find((c) => c.type === 'status');
  const energyRow = (status) => status.items[0].value.en;
  assert.equal(energyRow(await statusOf({})), 'Gas');
  assert.equal(
    energyRow(await statusOf({ device: contractIds(gladys, { id: ELEC_ID }).device })),
    'Electricity',
  );
});

test('the widget charts the last 30 days read', async (t) => {
  const { gladys } = await setup(t);
  const chart = (await get(gladys)).data.content.components.find((c) => c.type === 'chart');
  assert.equal(chart.series[0].points.length, 30);
  assert.equal(chart.series[0].points.at(-1).t, '2026-10-13T12:00:00.000Z');
});

test('without any reading yet, the widget explains what to do', async (t) => {
  const { gladys } = await setup(t, { config: {} });
  const { content } = (await get(gladys)).data;
  assert.deepEqual(validateWidgetContent(content), []);
  assert.equal(content.components[0].type, 'text');
});

test('the Refresh button reads the account and answers a short toast', async (t) => {
  const { gladys, site } = await setup(t);
  const before = site.requests.length;
  const ack = await gladys.fake.widgetAction(CONSUMPTION_WIDGET, 'refresh', {}, { settings: {} });
  assert.equal(ack.success, true);
  assert.ok(site.requests.length > before);
  for (const text of Object.values(ack.data.message)) {
    assert.ok(text.length <= 200);
  }
});

test('a failed refresh from the widget says why', async (t) => {
  const { gladys, site } = await setup(t, { config: CREDENTIALS });
  site.down = true;
  const ack = await gladys.fake.widgetAction(CONSUMPTION_WIDGET, 'refresh', {}, { settings: {} });
  assert.match(ack.data.message.en, /unreachable/);
});

test('an unknown widget action fails, so the user sees the error', async (t) => {
  const { gladys } = await setup(t);
  const ack = await gladys.fake.widgetAction(CONSUMPTION_WIDGET, 'unknown', {}, { settings: {} });
  assert.equal(ack.success, false);
});

test('every refresh nudges the widget', async (t) => {
  const { gladys, integration } = await setup(t);
  const before = gladys.fake.widgetRefreshes.length;
  await integration.refresh('test');
  assert.deepEqual(gladys.fake.widgetRefreshes.slice(before), [CONSUMPTION_WIDGET]);
});
