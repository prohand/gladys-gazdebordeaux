// -----------------------------------------------------------------------------
// The user-facing messages: connection status, action answers.
// Every one is a `{ en, fr, de, es }` object (see src/i18n.js).
// -----------------------------------------------------------------------------

import { ENERGIES, ERROR_KINDS } from './gazdebordeaux/client.js';
import { localize, pick } from './i18n.js';
import { tariffOf } from './capabilities/energy.js';

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

/** "0,160164 €/kWh" in the reader's language, every decimal the website gives. */
export function kwhPriceText(language, value) {
  return `${formatNumber(language, value, 6)} €/kWh`;
}

/**
 * The current prices of one contract on one line, as the customer website
 * gives them: what to copy into the Gladys contract wizard.
 * @param {string} language
 * @param {ReturnType<import('./gazdebordeaux/prices.js').currentPrices>} prices
 */
export function contractPricesLine(language, prices) {
  const details = [prices.option, prices.power ? `${prices.power} kVA` : null].filter(Boolean);
  if (prices.offPeakSlots) {
    details.push(
      `${pick(language, { en: 'off-peak', fr: 'heures creuses', de: 'Niedertarif', es: 'horas valle' })} ${prices.offPeakSlots.map(([start, end]) => `${start}–${end}`).join(', ')}`,
    );
  }
  const values = [];
  if (prices.peakPrice !== null || prices.offPeakPrice !== null) {
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
  }
  if (prices.kwhPrice !== null) {
    values.push(kwhPriceText(language, prices.kwhPrice));
  }
  if (prices.subscriptionPerMonth !== null) {
    values.push(
      `${pick(language, { en: 'subscription', fr: 'abonnement', de: 'Grundgebühr', es: 'suscripción' })} ${formatNumber(language, prices.subscriptionPerMonth, 2)} €/${pick(language, { en: 'month', fr: 'mois', de: 'Monat', es: 'mes' })}`,
    );
  }
  if (values.length === 0) {
    values.push(
      pick(language, {
        en: 'no price given by the customer account',
        fr: "aucun prix donné par l'espace client",
        de: 'kein Preis im Kundenkonto',
        es: 'ningún precio en la cuenta de cliente',
      }),
    );
  }
  const name = energyName(language, prices.energy);
  const label = prices.offer ? `${name}, ${prices.offer}` : name;
  const head = details.length ? `${label} (${details.join(', ')})` : label;
  // French puts a space before the colon.
  const colon = language === 'fr' ? ' : ' : ': ';
  return `${head[0].toUpperCase()}${head.slice(1)}${colon}${values.join(', ')}`;
}

/**
 * The answer of "My contract prices": the current prices of every contract,
 * read on espaceclient.gazdebordeaux.fr, and what to do with them.
 * @param {Array<ReturnType<import('./gazdebordeaux/prices.js').currentPrices>>} pricesList
 */
export function contractPricesMessage(pricesList) {
  return localize((language) => {
    const lines = pricesList.map((prices) => contractPricesLine(language, prices));
    const footer = pick(language, {
      en: 'Current prices of your customer account, incl. VAT. In the Gladys energy contract, choose the template "Gaz de Bordeaux – My contract (customer account prices)" and type the subscription: the integration publishes the kWh price every day, Gladys computes the cost. Or copy them into another template.',
      fr: "Prix actuels de votre espace client, TTC. Dans le contrat d'énergie Gladys, choisissez le modèle « Gaz de Bordeaux – Mon contrat (prix de l'espace client) » et saisissez l'abonnement : l'intégration publie chaque jour le prix du kWh, Gladys calcule le coût. Ou recopiez-les dans un autre modèle.",
      de: 'Aktuelle Preise Ihres Kundenkontos, inkl. MwSt. Wählen Sie im Gladys-Energievertrag die Vorlage „Gaz de Bordeaux – Mein Vertrag (Preise des Kundenkontos)“ und geben Sie die Grundgebühr ein: die Integration veröffentlicht täglich den kWh-Preis, Gladys berechnet die Kosten. Oder übernehmen Sie sie in eine andere Vorlage.',
      es: 'Precios actuales de su cuenta de cliente, IVA incluido. En el contrato de energía de Gladys, elija la plantilla «Gaz de Bordeaux – Mi contrato (precios de la cuenta)» e introduzca la suscripción: la integración publica cada día el precio del kWh, Gladys calcula el coste. O cópielos en otra plantilla.',
    });
    const tariffs = pricesList
      .map(tariffOf)
      .filter(Boolean)
      .map((tariff) =>
        pick(language, {
          en: `Gladys tariff (JSON): ${JSON.stringify(tariff)}`,
          fr: `Tarif Gladys (JSON) : ${JSON.stringify(tariff)}`,
          de: `Gladys-Tarif (JSON): ${JSON.stringify(tariff)}`,
          es: `Tarifa Gladys (JSON): ${JSON.stringify(tariff)}`,
        }),
      );
    return [`${lines.join(' — ')}. ${footer}`, ...tariffs].join(' ');
  });
}

const PRICES_FAILURE = {
  [ERROR_KINDS.AUTH]: {
    en: 'sign-in refused',
    fr: 'connexion refusée',
    de: 'Anmeldung abgelehnt',
    es: 'inicio de sesión rechazado',
  },
  [ERROR_KINDS.BLOCKED]: {
    en: 'request blocked by the website',
    fr: 'requête bloquée par le site',
    de: 'Anfrage von der Website blockiert',
    es: 'solicitud bloqueada por el sitio',
  },
  [ERROR_KINDS.NETWORK]: {
    en: 'website unreachable',
    fr: 'site injoignable',
    de: 'Website nicht erreichbar',
    es: 'sitio inaccesible',
  },
  [ERROR_KINDS.NO_CONTRACT]: {
    en: 'no contract found',
    fr: 'aucun contrat trouvé',
    de: 'kein Vertrag gefunden',
    es: 'ningún contrato encontrado',
  },
};

/** The answer of "My contract prices" when espaceclient.gazdebordeaux.fr could not be read. */
export function pricesUnavailableMessage(error) {
  const reason = PRICES_FAILURE[error?.kind] ?? {
    en: 'unexpected answer',
    fr: 'réponse inattendue',
    de: 'unerwartete Antwort',
    es: 'respuesta inesperada',
  };
  return localize((language) =>
    pick(language, {
      en: `Your prices could not be read on espaceclient.gazdebordeaux.fr (${pick(language, reason)}). They are shown there, on the page of your contract ("Votre prix actuel"): copy them into the Gladys energy contract.`,
      fr: `Impossible de lire vos prix sur espaceclient.gazdebordeaux.fr (${pick(language, reason)}). Ils y sont affichés, sur la page de votre contrat (« Votre prix actuel ») : recopiez-les dans le contrat d'énergie Gladys.`,
      de: `Ihre Preise konnten auf espaceclient.gazdebordeaux.fr nicht gelesen werden (${pick(language, reason)}). Sie stehen dort auf der Seite Ihres Vertrags („Votre prix actuel“): übernehmen Sie sie in den Gladys-Energievertrag.`,
      es: `No se pudieron leer sus precios en espaceclient.gazdebordeaux.fr (${pick(language, reason)}). Se muestran allí, en la página de su contrato («Votre prix actuel»): cópielos en el contrato de energía de Gladys.`,
    }),
  );
}
