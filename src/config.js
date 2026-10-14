// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user in Gladys from the `config_schema` of
// `gladys-assistant-integration.json`. This module only provides the defaults
// and normalizes the received object (form values may arrive as strings), so
// the rest of the code never deals with `undefined` or out-of-range values.
// -----------------------------------------------------------------------------

// Defaults: they MUST stay consistent with the `default` values declared in the
// `config_schema` of the manifest (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  email: '',
  password: '',
  // Hours between two reads of the customer account. Gaz de Bordeaux publishes
  // one reading a day, one or two days late: reading it more often only adds
  // logins (and a chance to be throttled by the website).
  refresh_hours: 6,
  // Days of daily readings imported when a device is created.
  history_days: 30,
  // Daily kWh above which `high_consumption` fires; 0 turns it off.
  gas_alert_kwh: 0,
  electricity_alert_kwh: 0,
};

// Bounds of the numeric fields, same as the manifest `min` / `max`.
const BOUNDS = {
  refresh_hours: [1, 24],
  history_days: [1, 90],
  gas_alert_kwh: [0, 1000],
  electricity_alert_kwh: [0, 1000],
};

function boundedNumber(raw, key) {
  const [min, max] = BOUNDS[key];
  const value = Number(raw ?? DEFAULT_CONFIG[key]);
  if (!Number.isFinite(value)) {
    return DEFAULT_CONFIG[key];
  }
  return Math.min(max, Math.max(min, value));
}

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    email: String(raw.email ?? '').trim(),
    // Never trimmed: a password may legitimately start or end with a space.
    password: String(raw.password ?? ''),
    refresh_hours: boundedNumber(raw.refresh_hours, 'refresh_hours'),
    history_days: Math.round(boundedNumber(raw.history_days, 'history_days')),
    gas_alert_kwh: boundedNumber(raw.gas_alert_kwh, 'gas_alert_kwh'),
    electricity_alert_kwh: boundedNumber(raw.electricity_alert_kwh, 'electricity_alert_kwh'),
  };
}

/** True when the account credentials are filled in. */
export function isConfigured(config) {
  return Boolean(config.email) && Boolean(config.password);
}

/** The alert threshold of one energy (`gas` | `electricity`), 0 when off. */
export function alertThreshold(config, energy) {
  return energy === 'electricity' ? config.electricity_alert_kwh : config.gas_alert_kwh;
}
