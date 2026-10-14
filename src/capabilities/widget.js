// -----------------------------------------------------------------------------
// Dashboard widget `consumption` (SDK v0.14+, Gladys 5.1+).
//
// Built from the snapshot of the last refresh, never from a live call to the
// website: the core pulls the content whenever a dashboard opens, and the
// readings only change once a day. index.js nudges the widget after every
// refresh instead (requestWidgetRefresh).
//
// Content, within the core budget (8 components at most: ≤ 6 tiles, 1 focal,
// 1 status, 4 buttons):
//   - 4 tiles (a 2 × 2 grid): last day and month, consumption and cost;
//   - a bar chart of the last 30 days read;
//   - a status list: energy, latest day read, gas volume, year total, last
//     refresh, connection;
//   - a "Refresh" button.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { ENERGIES } from '../gazdebordeaux/client.js';
import { noonOf, TIME_ZONE } from '../gazdebordeaux/dates.js';
import { findContract } from '../devices/index.js';
import { refreshedMessage, errorMessage } from '../messages.js';
import { localize, pick } from '../i18n.js';

const logger = createLogger({ name: 'widget' });

// Widget key, as declared in the manifest `widgets` field.
export const CONSUMPTION_WIDGET = 'consumption';

const ACTIONS = { REFRESH: 'refresh' };

const CHART_DAYS = 30;

const LABELS = {
  lastDay: { en: 'Last day', fr: 'Dernier jour', de: 'Letzter Tag', es: 'Último día' },
  lastDayCost: {
    en: 'Last day cost',
    fr: 'Coût dernier jour',
    de: 'Kosten letzter Tag',
    es: 'Coste último día',
  },
  month: { en: 'This month', fr: 'Ce mois-ci', de: 'Dieser Monat', es: 'Este mes' },
  monthCost: { en: 'Month cost', fr: 'Coût du mois', de: 'Kosten Monat', es: 'Coste del mes' },
  year: { en: 'This year', fr: 'Cette année', de: 'Dieses Jahr', es: 'Este año' },
  chart: {
    en: 'Last 30 days (kWh)',
    fr: '30 derniers jours (kWh)',
    de: 'Letzte 30 Tage (kWh)',
    es: 'Últimos 30 días (kWh)',
  },
  consumption: { en: 'Consumption', fr: 'Consommation', de: 'Verbrauch', es: 'Consumo' },
  energy: { en: 'Energy', fr: 'Énergie', de: 'Energie', es: 'Energía' },
  latest: {
    en: 'Latest day read',
    fr: 'Dernier jour relevé',
    de: 'Letzter gelesener Tag',
    es: 'Último día leído',
  },
  volume: {
    en: 'Gas, last day',
    fr: 'Gaz, dernier jour',
    de: 'Gas, letzter Tag',
    es: 'Gas, último día',
  },
  refreshedAt: {
    en: 'Last refresh',
    fr: 'Dernier rafraîchissement',
    de: 'Letzte Aktualisierung',
    es: 'Última actualización',
  },
  connection: { en: 'Customer account', fr: 'Espace client', de: 'Kundenkonto', es: 'Cuenta' },
  refresh: { en: 'Refresh', fr: 'Rafraîchir', de: 'Aktualisieren', es: 'Actualizar' },
  gas: { en: 'Gas', fr: 'Gaz', de: 'Gas', es: 'Gas' },
  electricity: { en: 'Electricity', fr: 'Électricité', de: 'Strom', es: 'Electricidad' },
  connected: { en: 'Connected', fr: 'Connecté', de: 'Verbunden', es: 'Conectado' },
  failing: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  noData: {
    en: 'No reading yet. Fill in the customer account in the integration configuration, then refresh.',
    fr: "Aucun relevé pour l'instant. Renseignez l'espace client dans la configuration de l'intégration, puis rafraîchissez.",
    de: 'Noch keine Werte. Tragen Sie das Kundenkonto in der Konfiguration der Integration ein und aktualisieren Sie.',
    es: 'Todavía no hay lecturas. Indique la cuenta de cliente en la configuración de la integración y actualice.',
  },
};

const LANGUAGE_LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

function formatDay(day, language) {
  return new Intl.DateTimeFormat(LANGUAGE_LOCALES[language] ?? 'en-GB', {
    timeZone: 'UTC',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(new Date(noonOf(day)));
}

function formatTime(date, language) {
  return new Intl.DateTimeFormat(LANGUAGE_LOCALES[language] ?? 'en-GB', {
    timeZone: TIME_ZONE,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

// A tile: the value rounded for reading, a dash when the account has none.
function tile(label, value, unit, icon, digits) {
  return {
    type: 'value',
    label,
    icon,
    value: value === null || value === undefined ? '–' : Number(value.toFixed(digits)),
    unit,
  };
}

// "4 322 kWh · 612 €": the year total on one status row (≤ 40 characters).
function yearSummary({ kwh, cost }) {
  const parts = [];
  if (kwh !== null) {
    parts.push(`${Math.round(kwh)} kWh`);
  }
  if (cost !== null) {
    parts.push(`${Math.round(cost)} €`);
  }
  return parts.join(' · ') || '–';
}

/** The snapshot the widget shows: the chosen contract, or the first one. */
function snapshotFor(gladys, account, settings) {
  const contracts = account.state.contracts;
  const contract =
    (settings?.device && findContract(gladys, contracts, settings.device)) ?? contracts[0];
  return contract ? account.state.snapshots.get(contract.id) : undefined;
}

function refreshButton() {
  return {
    type: 'button',
    label: LABELS.refresh,
    icon: 'refresh-cw',
    style: 'secondary',
    action: { key: ACTIONS.REFRESH },
  };
}

/**
 * The widget content.
 * @param {{ gladys: object, account: object }} context
 * @param {{ settings?: object, language?: string }} request
 */
export function buildContent({ gladys, account }, { settings, language = 'en' }) {
  const snapshot = snapshotFor(gladys, account, settings);
  if (!snapshot) {
    return {
      ttl_seconds: 600,
      components: [{ type: 'text', variant: 'body', text: LABELS.noData }, refreshButton()],
    };
  }

  const { contract, lastDay, month, year, days } = snapshot;
  const healthy = account.isHealthy();
  const status = [
    {
      label: LABELS.energy,
      icon: contract.energy === ENERGIES.GAS ? 'thermometer' : 'zap',
      value: contract.energy === ENERGIES.GAS ? LABELS.gas : LABELS.electricity,
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: LABELS.latest,
      icon: 'calendar',
      value: lastDay ? formatDay(lastDay.date, language) : '–',
      color: WIDGET_COLORS.NEUTRAL,
    },
  ];
  if (
    contract.energy === ENERGIES.GAS &&
    lastDay?.volume !== null &&
    lastDay?.volume !== undefined
  ) {
    status.push({
      label: LABELS.volume,
      icon: 'droplet',
      value: `${Number(lastDay.volume.toFixed(2))} m³`,
      color: WIDGET_COLORS.NEUTRAL,
    });
  }
  status.push(
    {
      label: LABELS.year,
      icon: 'trending-up',
      value: yearSummary(year),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: LABELS.refreshedAt,
      icon: 'clock',
      value: formatTime(snapshot.readAt, language),
      color: WIDGET_COLORS.NEUTRAL,
    },
    {
      label: LABELS.connection,
      icon: healthy ? 'check-circle' : 'alert-triangle',
      value: healthy ? LABELS.connected : LABELS.failing,
      color: healthy ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.DANGER,
    },
  );

  const components = [
    tile(LABELS.lastDay, lastDay?.kwh, 'kWh', 'activity', 1),
    tile(LABELS.lastDayCost, lastDay?.cost, '€', 'credit-card', 2),
    tile(LABELS.month, month.kwh, 'kWh', 'calendar', 0),
    tile(LABELS.monthCost, month.cost, '€', 'credit-card', 2),
  ];
  const chartDays = days.slice(-CHART_DAYS);
  if (chartDays.length > 0) {
    components.push({
      type: 'chart',
      chart_type: 'bar',
      title: LABELS.chart,
      unit: 'kWh',
      series: [
        {
          name: LABELS.consumption,
          points: chartDays.map((day) => ({ t: noonOf(day.date), v: day.kwh })),
        },
      ],
    });
  }
  components.push({ type: 'status', items: status }, refreshButton());

  return {
    // The readings change once a day and every refresh nudges the widget:
    // the TTL is only a safety net.
    ttl_seconds: 3600,
    components,
  };
}

export const WIDGETS = {
  [CONSUMPTION_WIDGET]: {
    async get(context, request) {
      logger.debug(`onWidgetGet <- ${CONSUMPTION_WIDGET}`);
      return buildContent(context, request);
    },

    // Resolve a toast (≤ 200 characters); after a successful action the core
    // drops the cached content and every open dashboard re-pulls it.
    async action(context, { actionKey }) {
      logger.info(`onWidgetAction <- ${CONSUMPTION_WIDGET}.${actionKey}`);
      if (actionKey !== ACTIONS.REFRESH) {
        throw new Error(`Unknown widget action: ${actionKey}`);
      }
      const { ok, error } = await context.refresh('widget');
      if (!ok) {
        return localize((language) => pick(language, errorMessage(error)));
      }
      return refreshedMessage(context.account);
    },
  },
};

/**
 * Freshness nudge: ask the core to re-pull every widget now (rate-limited
 * core-side, dropped silently while disconnected).
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
