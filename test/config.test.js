import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alertThreshold, DEFAULT_CONFIG, isConfigured, normalizeConfig } from '../src/config.js';

test('an empty config gets the defaults', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
});

test('form values arriving as strings are turned into numbers', () => {
  const config = normalizeConfig({
    refresh_hours: '12',
    history_days: '45',
    gas_alert_kwh: '80.5',
  });
  assert.equal(config.refresh_hours, 12);
  assert.equal(config.history_days, 45);
  assert.equal(config.gas_alert_kwh, 80.5);
});

test('out-of-range and invalid numbers are brought back within the manifest bounds', () => {
  const config = normalizeConfig({ refresh_hours: 0, history_days: 1000, gas_alert_kwh: 'abc' });
  assert.equal(config.refresh_hours, 1);
  assert.equal(config.history_days, 90);
  assert.equal(config.gas_alert_kwh, DEFAULT_CONFIG.gas_alert_kwh);
});

test('the email is trimmed, the password is kept as typed', () => {
  const config = normalizeConfig({ email: ' jane@example.com ', password: ' secret ' });
  assert.equal(config.email, 'jane@example.com');
  assert.equal(config.password, ' secret ');
});

test('isConfigured needs both the email and the password', () => {
  assert.equal(isConfigured(normalizeConfig({ email: 'a@b.c' })), false);
  assert.equal(isConfigured(normalizeConfig({ email: 'a@b.c', password: 'x' })), true);
});

test('alertThreshold reads the threshold of the energy', () => {
  const config = normalizeConfig({ gas_alert_kwh: 80, electricity_alert_kwh: 20 });
  assert.equal(alertThreshold(config, 'gas'), 80);
  assert.equal(alertThreshold(config, 'electricity'), 20);
});
