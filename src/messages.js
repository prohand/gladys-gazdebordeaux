// -----------------------------------------------------------------------------
// The user-facing messages: connection status, action answers.
// Every one is a `{ en, fr, de, es }` object (see src/i18n.js).
// -----------------------------------------------------------------------------

import { ENERGIES, ERROR_KINDS } from './gazdebordeaux/client.js';
import { localize, pick } from './i18n.js';

const ERROR_TEXTS = {
  [ERROR_KINDS.NOT_CONFIGURED]: {
    en: 'Fill in the email and password of your Gaz de Bordeaux customer account.',
    fr: 'Renseignez l’e-mail et le mot de passe de votre espace client Gaz de Bordeaux.',
    de: 'Geben Sie E-Mail und Passwort Ihres Gaz de Bordeaux Kundenkontos ein.',
    es: 'Introduzca el correo y la contraseña de su cuenta de cliente Gaz de Bordeaux.',
  },
  [ERROR_KINDS.AUTH]: {
    en: 'Sign-in refused: check the email and password (the ones of life.gazdebordeaux.fr).',
    fr: 'Connexion refusée : vérifiez l’e-mail et le mot de passe (ceux de life.gazdebordeaux.fr).',
    de: 'Anmeldung abgelehnt: prüfen Sie E-Mail und Passwort (die von life.gazdebordeaux.fr).',
    es: 'Inicio de sesión rechazado: compruebe el correo y la contraseña (los de life.gazdebordeaux.fr).',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'The Gaz de Bordeaux website blocked the request. It is retried at the next refresh.',
    fr: 'Le site Gaz de Bordeaux a bloqué la requête. Nouvel essai au prochain rafraîchissement.',
    de: 'Die Gaz de Bordeaux Website hat die Anfrage blockiert. Neuer Versuch bei der nächsten Aktualisierung.',
    es: 'El sitio de Gaz de Bordeaux bloqueó la solicitud. Se reintenta en la próxima actualización.',
  },
  [ERROR_KINDS.NETWORK]: {
    en: 'Gaz de Bordeaux unreachable: check the Internet connection of Gladys.',
    fr: 'Gaz de Bordeaux injoignable : vérifiez la connexion Internet de Gladys.',
    de: 'Gaz de Bordeaux nicht erreichbar: prüfen Sie die Internetverbindung von Gladys.',
    es: 'Gaz de Bordeaux inaccesible: compruebe la conexión a Internet de Gladys.',
  },
  [ERROR_KINDS.API]: {
    en: 'Gaz de Bordeaux gave an unexpected answer: see the integration logs.',
    fr: 'Gaz de Bordeaux a donné une réponse inattendue : consultez les logs de l’intégration.',
    de: 'Gaz de Bordeaux gab eine unerwartete Antwort: siehe die Logs der Integration.',
    es: 'Gaz de Bordeaux dio una respuesta inesperada: consulte los registros de la integración.',
  },
  [ERROR_KINDS.NO_CONTRACT]: {
    en: 'No gas or electricity contract was found on this customer account.',
    fr: 'Aucun contrat de gaz ou d’électricité trouvé sur cet espace client.',
    de: 'In diesem Kundenkonto wurde kein Gas- oder Stromvertrag gefunden.',
    es: 'No se encontró ningún contrato de gas o electricidad en esta cuenta de cliente.',
  },
};

/** The message explaining a failed read, by error kind. */
export function errorMessage(err) {
  return ERROR_TEXTS[err?.kind] ?? ERROR_TEXTS[ERROR_KINDS.API];
}

/** The scene filter value of an error (`connection_failed.reason`). */
export function errorReason(err) {
  return Object.hasOwn(ERROR_TEXTS, err?.kind) && err.kind !== ERROR_KINDS.NOT_CONFIGURED
    ? err.kind
    : ERROR_KINDS.API;
}

function energyName(language, energy) {
  return energy === ENERGIES.ELECTRICITY
    ? pick(language, { en: 'electricity', fr: 'électricité', de: 'Strom', es: 'electricidad' })
    : pick(language, { en: 'gas', fr: 'gaz', de: 'Gas', es: 'gas' });
}

/** "2 contracts: gas, electricity" — the answer of "Test the connection". */
export function contractsFoundMessage(contracts) {
  return localize((language) => {
    const list = contracts.map((contract) => energyName(language, contract.energy)).join(', ');
    return pick(language, {
      en: `Connection OK: ${contracts.length} contract(s) found (${list}).`,
      fr: `Connexion OK : ${contracts.length} contrat(s) trouvé(s) (${list}).`,
      de: `Verbindung OK: ${contracts.length} Vertrag/Verträge gefunden (${list}).`,
      es: `Conexión OK: ${contracts.length} contrato(s) encontrado(s) (${list}).`,
    });
  });
}

/** The answer of "Refresh now". */
export function refreshedMessage(account) {
  const count = account.state.contracts.length;
  const days = [...account.state.snapshots.values()]
    .map((snapshot) => snapshot.lastDay?.date)
    .filter(Boolean)
    .sort();
  const latest = days.at(-1);
  return localize((language) => {
    const head = pick(language, {
      en: `Readings refreshed for ${count} contract(s).`,
      fr: `Relevés rafraîchis pour ${count} contrat(s).`,
      de: `Werte für ${count} Vertrag/Verträge aktualisiert.`,
      es: `Lecturas actualizadas para ${count} contrato(s).`,
    });
    if (!latest) {
      return head;
    }
    return `${head} ${pick(language, {
      en: `Latest day read: ${latest}.`,
      fr: `Dernier jour relevé : ${latest}.`,
      de: `Letzter gelesener Tag: ${latest}.`,
      es: `Último día leído: ${latest}.`,
    })}`;
  });
}

const LOCALES = { en: 'en-GB', fr: 'fr-FR', de: 'de-DE', es: 'es-ES' };

function formatNumber(language, value, digits) {
  return new Intl.NumberFormat(LOCALES[language] ?? 'en-GB', {
    minimumFractionDigits: Math.min(2, digits),
    maximumFractionDigits: digits,
  }).format(value);
}

/** "0,18373 €/kWh" in the reader's language. */
export function kwhPriceText(language, value) {
  return `${formatNumber(language, value, 5)} €/kWh`;
}

/**
 * The prices of one contract on one line: what to copy into the Gladys
 * contract wizard.
 * @param {string} language
 * @param {ReturnType<import('./gazdebordeaux/prices.js').contractPrices>} prices
 */
export function contractPricesLine(language, prices) {
  const details = [];
  if (prices.power) {
    details.push(`${prices.power} kVA`);
  }
  if (prices.peakOffPeak && prices.offPeakSlots) {
    details.push(
      `${pick(language, { en: 'off-peak', fr: 'heures creuses', de: 'Niedertarif', es: 'horas valle' })} ${prices.offPeakSlots.map(([start, end]) => `${start}–${end}`).join(', ')}`,
    );
  }
  const values = [];
  if (prices.peakOffPeak && (prices.peakPrice !== null || prices.offPeakPrice !== null)) {
    const [peak, offPeak] = {
      en: ['peak', 'off-peak'],
      fr: ['HP', 'HC'],
      de: ['HT', 'NT'],
      es: ['punta', 'valle'],
    }[language] ?? ['peak', 'off-peak'];
    if (prices.peakPrice !== null) {
      values.push(`${peak} ${kwhPriceText(language, prices.peakPrice)}`);
    }
    if (prices.offPeakPrice !== null) {
      values.push(`${offPeak} ${kwhPriceText(language, prices.offPeakPrice)}`);
    }
  } else if (prices.kwhPrice !== null) {
    values.push(kwhPriceText(language, prices.kwhPrice));
  }
  if (prices.subscriptionPerMonth !== null) {
    values.push(
      `${pick(language, { en: 'subscription', fr: 'abonnement', de: 'Grundgebühr', es: 'suscripción' })} ${formatNumber(language, prices.subscriptionPerMonth, 2)} €/${pick(language, { en: 'month', fr: 'mois', de: 'Monat', es: 'mes' })}`,
    );
  }
  const name = energyName(language, prices.energy);
  const head = details.length ? `${name} (${details.join(', ')})` : name;
  // French puts a space before the colon.
  const colon = language === 'fr' ? ' : ' : ': ';
  return `${head[0].toUpperCase()}${head.slice(1)}${colon}${values.join(', ')}`;
}

/**
 * The answer of "My contract prices": one line per contract whose prices the
 * customer account gives, and what to do with them.
 * @param {Array<object>} pricesList the contractPrices() of each contract, nulls included
 */
export function contractPricesMessage(pricesList) {
  const known = pricesList.filter(Boolean);
  return localize((language) => {
    if (known.length === 0) {
      return pick(language, {
        en: 'The customer account does not detail the cost of each day yet: no price to compute. Refresh later.',
        fr: "L'espace client ne détaille pas encore le coût de chaque jour : aucun prix à calculer. Rafraîchissez plus tard.",
        de: 'Das Kundenkonto schlüsselt die Kosten pro Tag noch nicht auf: kein Preis berechenbar. Später aktualisieren.',
        es: 'La cuenta de cliente aún no detalla el coste de cada día: ningún precio que calcular. Actualice más tarde.',
      });
    }
    const lines = known.map((prices) => contractPricesLine(language, prices));
    const footer = pick(language, {
      en: `Computed from the last ${known[0].days} days of your account. Copy them into the Gladys energy contract.`,
      fr: `Calculé sur les ${known[0].days} derniers jours de votre compte. Recopiez-les dans le contrat d'énergie Gladys.`,
      de: `Berechnet aus den letzten ${known[0].days} Tagen Ihres Kontos. Übernehmen Sie sie in den Gladys-Energievertrag.`,
      es: `Calculado sobre los últimos ${known[0].days} días de su cuenta. Cópielos en el contrato de energía de Gladys.`,
    });
    return `${lines.join(' — ')}. ${footer}`;
  });
}
