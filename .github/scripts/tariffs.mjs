// -----------------------------------------------------------------------------
// The electricity contract templates of the manifest, built from the OFFICIAL
// Gaz de Bordeaux price grids.
//
// Gaz de Bordeaux publishes one grid per offer and per month ("fiche
// descriptive", a PDF whose annex holds the prices incl. VAT by subscribed
// power), downloaded from www.gazdebordeaux.fr through a small form (offer,
// postcode, city). This script:
//
//   node .github/scripts/tariffs.mjs fetch          download the grids (Playwright +
//                                                   pdftotext), then update
//   node .github/scripts/tariffs.mjs update <dir>   update from grid-<offer>.txt files
//                                                   (pdftotext -layout output)
//
// "update" rebuilds `energy_contracts.templates` of the manifest: the default
// prices are the 6 kVA ones, the other powers are listed in the input
// descriptions. A template whose prices changed takes the grid date as its
// `version` (shown by the contract wizard; a contract already created keeps
// its own prices, Gladys never changes it); an unchanged one is kept as
// is, so a new monthly grid with the same prices changes nothing. A change
// also adds a line to CHANGELOG.md.
//
// Run monthly by .github/workflows/tariffs.yml, which opens a pull request.
// The parsing is tested in test/tariffs.test.js against real grids.
// -----------------------------------------------------------------------------

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const LANGUAGES = ['en', 'fr', 'de', 'es'];
const DEFAULT_POWER = 6;
const FORM_URL = 'https://www.gazdebordeaux.fr/nos-offres-d-energie/electricite';
// Electricity prices do not depend on the town; the form needs one anyway.
const POSTCODE = '33000';

/** The offers, in manifest order. `label` is the option of the website form. */
export const OFFERS = [
  {
    key: 'novafixe-elec',
    label: 'Novafixe Élec',
    name: 'NovaFixe Élec',
    description: {
      en: 'Fixed-price offer: the kWh and subscription prices excl. taxes are locked for 3 years from subscription, 10% below the regulated tariff.',
      fr: "Offre à prix fixe : les prix HT du kWh et de l'abonnement sont bloqués 3 ans à la souscription, 10 % sous le tarif réglementé.",
      de: 'Festpreisangebot: kWh- und Grundpreis ohne Steuern sind 3 Jahre ab Vertragsabschluss fest, 10 % unter dem regulierten Tarif.',
      es: 'Oferta a precio fijo: los precios sin impuestos del kWh y de la suscripción quedan fijos 3 años desde la contratación, un 10 % bajo la tarifa regulada.',
    },
  },
  {
    key: 'novafixe-bonus-elec',
    label: 'Novafixe Bonus Élec',
    name: 'NovaFixe Bonus Élec',
    description: {
      en: 'Fixed-price offer with €100 off the first year: prices excl. taxes locked for 3 years from subscription, 10% below the regulated tariff.',
      fr: 'Offre à prix fixe avec 100 € offerts la première année : prix HT bloqués 3 ans à la souscription, 10 % sous le tarif réglementé.',
      de: 'Festpreisangebot mit 100 € Bonus im ersten Jahr: Preise ohne Steuern 3 Jahre ab Vertragsabschluss fest, 10 % unter dem regulierten Tarif.',
      es: 'Oferta a precio fijo con 100 € de regalo el primer año: precios sin impuestos fijos 3 años desde la contratación, un 10 % bajo la tarifa regulada.',
    },
  },
  {
    key: 'novaflex-elec',
    label: 'Novaflex Élec',
    name: 'NovaFlex Élec',
    description: {
      en: 'Indexed offer: the prices follow the regulated tariff (TRV), the kWh excl. taxes 5% below it. Update your prices when the TRV changes.',
      fr: 'Offre indexée : les prix suivent le tarif réglementé (TRV), le kWh HT 5 % en dessous. Mettez vos prix à jour quand le TRV change.',
      de: 'Indexiertes Angebot: die Preise folgen dem regulierten Tarif (TRV), die kWh ohne Steuern 5 % darunter. Preise anpassen, wenn sich der TRV ändert.',
      es: 'Oferta indexada: los precios siguen la tarifa regulada (TRV), el kWh sin impuestos un 5 % por debajo. Actualice sus precios cuando cambie la TRV.',
    },
  },
];

// --- Reading a grid ----------------------------------------------------------

const number = (text) => Number(text.replace(',', '.'));

/**
 * The prices of a grid, from its `pdftotext -layout` text.
 * @param {string} text
 * @returns {{ date: string, rows: Array<{ power: number, base: { subscription: number, kwh: number } | null, peakOffPeak: { subscription: number, peak: number, offPeak: number } | null }> }}
 */
export function parseGrid(text) {
  const dateMatch = text.match(/souscription entre le (\d{2})\/(\d{2})\/(\d{4})/);
  if (!dateMatch) {
    throw new Error('Grid: no "souscription entre le" date');
  }
  const date = `${dateMatch[3]}-${dateMatch[2]}-${dateMatch[1]}`;
  const annex = text.slice(text.indexOf('GRILLE TARIFAIRE'));
  const rows = [];
  for (const line of annex.split('\n')) {
    const match = line.match(/^\s*(\d{1,2})\s+(\d+,\d+(?:\s+\d+,\d+)*)\s*$/);
    if (!match) {
      continue;
    }
    const values = match[2].trim().split(/\s+/).map(number);
    const power = Number(match[1]);
    // Base only (2 values), peak/off-peak only (3), or both (5).
    if (values.length === 2) {
      rows.push({ power, base: { subscription: values[0], kwh: values[1] }, peakOffPeak: null });
    } else if (values.length === 3) {
      const [subscription, peak, offPeak] = values;
      rows.push({ power, base: null, peakOffPeak: { subscription, peak, offPeak } });
    } else if (values.length === 5) {
      const [baseSubscription, kwh, subscription, peak, offPeak] = values;
      rows.push({
        power,
        base: { subscription: baseSubscription, kwh },
        peakOffPeak: { subscription, peak, offPeak },
      });
    } else {
      throw new Error(`Grid: unexpected row "${line.trim()}"`);
    }
  }
  const reference = rows.find((row) => row.power === DEFAULT_POWER);
  if (!reference?.base || !reference?.peakOffPeak) {
    throw new Error(`Grid: no ${DEFAULT_POWER} kVA row with both options`);
  }
  for (const row of rows) {
    for (const value of [row.base?.kwh, row.peakOffPeak?.peak, row.peakOffPeak?.offPeak].filter(
      (v) => v !== undefined,
    )) {
      if (!(value > 0.01 && value < 1)) {
        throw new Error(`Grid: implausible kWh price ${value} (${row.power} kVA)`);
      }
    }
  }
  return { date, rows };
}

// --- Building the templates --------------------------------------------------

const DECIMAL = { en: '.', fr: ',', de: ',', es: ',' };
// Subscriptions with 2 decimals, kWh prices with 5, like the grids.
const amount = (language, value) =>
  value.toFixed(value < 1 ? 5 : 2).replace('.', DECIMAL[language]);

const ml = (texts) => Object.fromEntries(LANGUAGES.map((language) => [language, texts[language]]));

// "3 kVA 12.13, 9 kVA 19.88, ..." — the powers other than the default one.
function otherPowers(language, rows, valueOf) {
  return rows
    .filter((row) => row.power !== DEFAULT_POWER && valueOf(row) !== undefined)
    .map((row) => `${row.power} kVA ${amount(language, valueOf(row))}`)
    .join(', ');
}

function subscriptionInput(rows, option) {
  const valueOf = (row) => row[option]?.subscription;
  const others = (language) => otherPowers(language, rows, valueOf);
  return {
    key: 'subscription_per_month',
    type: 'number',
    unit: 'EUR/month',
    default: valueOf(rows.find((row) => row.power === DEFAULT_POWER)),
    required: true,
    label: ml({
      en: 'Subscription per month (incl. VAT)',
      fr: 'Abonnement par mois (TTC)',
      de: 'Grundgebühr pro Monat (inkl. MwSt.)',
      es: 'Suscripción al mes (IVA incl.)',
    }),
    description: ml({
      en: `Default: ${DEFAULT_POWER} kVA. ${others('en')}.`,
      fr: `Par défaut : ${DEFAULT_POWER} kVA. ${others('fr')}.`,
      de: `Standard: ${DEFAULT_POWER} kVA. ${others('de')}.`,
      es: `Por defecto: ${DEFAULT_POWER} kVA. ${others('es')}.`,
    }),
  };
}

function priceInput(key, value, label, rows, valueOf) {
  const reference = valueOf(rows.find((row) => row.power === DEFAULT_POWER));
  const differing = rows.filter((row) => valueOf(row) !== undefined && valueOf(row) !== reference);
  const input = { key, type: 'number', unit: 'EUR/kWh', default: value, required: true, label };
  if (differing.length > 0) {
    const others = (language) => otherPowers(language, differing, valueOf);
    input.description = ml({
      en: `Default: ${DEFAULT_POWER} kVA. ${others('en')}.`,
      fr: `Par défaut : ${DEFAULT_POWER} kVA. ${others('fr')}.`,
      de: `Standard: ${DEFAULT_POWER} kVA. ${others('de')}.`,
      es: `Por defecto: ${DEFAULT_POWER} kVA. ${others('es')}.`,
    });
  }
  return input;
}

function templateDescription(offer, grid) {
  const [year, month, day] = grid.date.split('-');
  return ml({
    en: `${offer.description.en} Defaults: official prices incl. VAT of the ${grid.date} grid, ${DEFAULT_POWER} kVA. Enter those of your contract: the "My contract prices" button of the integration gives them.`,
    fr: `${offer.description.fr} Par défaut : prix TTC officiels de la grille du ${day}/${month}/${year}, ${DEFAULT_POWER} kVA. Saisissez ceux de votre contrat : le bouton « Mes prix de contrat » de l'intégration les donne.`,
    de: `${offer.description.de} Standard: offizielle Bruttopreise der Preisliste vom ${day}.${month}.${year}, ${DEFAULT_POWER} kVA. Tragen Sie die Ihres Vertrags ein: die Schaltfläche „Meine Vertragspreise“ der Integration nennt sie.`,
    es: `${offer.description.es} Por defecto: precios oficiales con IVA de la tarifa del ${day}/${month}/${year}, ${DEFAULT_POWER} kVA. Introduzca los de su contrato: el botón «Mis precios de contrato» de la integración los da.`,
  });
}

/** The two templates (base, peak/off-peak) of one offer, from its grid. */
export function buildOfferTemplates(offer, grid) {
  const reference = grid.rows.find((row) => row.power === DEFAULT_POWER);
  const common = {
    country: 'FR',
    currency: 'EUR',
    timezone: 'Europe/Paris',
    pricing_mode: 'rules',
    version: grid.date,
  };
  const subscriptionComponent = {
    key: 'subscription',
    kind: 'fixed',
    label: 'Abonnement',
    amount: '{{input:subscription_per_month}}',
    per: 'month',
  };
  const base = {
    key: `${offer.key}-base`,
    name: ml({
      en: `Gaz de Bordeaux ${offer.name} – Base`,
      fr: `Gaz de Bordeaux ${offer.name} – Base`,
      de: `Gaz de Bordeaux ${offer.name} – Base`,
      es: `Gaz de Bordeaux ${offer.name} – Base`,
    }),
    description: templateDescription(offer, grid),
    ...common,
    inputs: [
      priceInput(
        'kwh_price',
        reference.base.kwh,
        ml({
          en: 'kWh price (incl. VAT)',
          fr: 'Prix du kWh (TTC)',
          de: 'kWh-Preis (inkl. MwSt.)',
          es: 'Precio del kWh (IVA incl.)',
        }),
        grid.rows,
        (row) => row.base?.kwh,
      ),
      subscriptionInput(grid.rows, 'base'),
    ],
    tariff: {
      tariff_version: 1,
      components: [
        {
          key: 'energy',
          kind: 'consumption',
          label: 'Base',
          fallback: { price: '{{input:kwh_price}}' },
        },
        subscriptionComponent,
      ],
    },
  };
  const peakOffPeak = {
    key: `${offer.key}-peak-off-peak`,
    name: ml({
      en: `Gaz de Bordeaux ${offer.name} – Peak/Off-peak`,
      fr: `Gaz de Bordeaux ${offer.name} – Heures creuses`,
      de: `Gaz de Bordeaux ${offer.name} – HT/NT`,
      es: `Gaz de Bordeaux ${offer.name} – Horas valle`,
    }),
    description: templateDescription(offer, grid),
    ...common,
    inputs: [
      priceInput(
        'peak_price',
        reference.peakOffPeak.peak,
        ml({
          en: 'Peak kWh price (incl. VAT)',
          fr: 'Prix du kWh heures pleines (TTC)',
          de: 'kWh-Preis Hochtarif (inkl. MwSt.)',
          es: 'Precio del kWh punta (IVA incl.)',
        }),
        grid.rows,
        (row) => row.peakOffPeak?.peak,
      ),
      priceInput(
        'off_peak_price',
        reference.peakOffPeak.offPeak,
        ml({
          en: 'Off-peak kWh price (incl. VAT)',
          fr: 'Prix du kWh heures creuses (TTC)',
          de: 'kWh-Preis Niedertarif (inkl. MwSt.)',
          es: 'Precio del kWh valle (IVA incl.)',
        }),
        grid.rows,
        (row) => row.peakOffPeak?.offPeak,
      ),
      {
        key: 'off_peak_slots',
        type: 'time_intervals',
        default: [['22:00', '06:00']],
        required: true,
        label: ml({
          en: 'Off-peak hours',
          fr: 'Heures creuses',
          de: 'Niedertarifzeiten',
          es: 'Horas valle',
        }),
        description: ml({
          en: 'Shown on your invoice and by the "My contract prices" button (8 hours a day, set by Enedis).',
          fr: 'Indiquées sur votre facture et par le bouton « Mes prix de contrat » (8 heures par jour, fixées par Enedis).',
          de: 'Auf Ihrer Rechnung und über die Schaltfläche „Meine Vertragspreise“ (8 Stunden am Tag, von Enedis festgelegt).',
          es: 'Indicadas en su factura y por el botón «Mis precios de contrato» (8 horas al día, fijadas por Enedis).',
        }),
      },
      subscriptionInput(grid.rows, 'peakOffPeak'),
    ],
    tariff: {
      tariff_version: 1,
      components: [
        {
          key: 'energy',
          kind: 'consumption',
          rules: [
            {
              label: 'Heures creuses',
              when: { time: '{{input:off_peak_slots}}' },
              price: '{{input:off_peak_price}}',
            },
          ],
          fallback: { label: 'Heures pleines', price: '{{input:peak_price}}' },
        },
        subscriptionComponent,
      ],
    },
  };
  return [base, peakOffPeak];
}

// What makes a template change: everything but its version and its
// description (which names the grid date — a new month with the same prices
// is not a new tariff).
const contentOf = (template) =>
  JSON.stringify({ ...template, version: undefined, description: undefined });

/**
 * The manifest with its templates rebuilt from the grids. A template whose
 * content did not change keeps its version; a template no grid builds (the
 * delegated "My contract" one) is kept as is, after the built ones.
 * @param {object} manifest
 * @param {Record<string, ReturnType<typeof parseGrid>>} grids by offer key
 * @returns {{ manifest: object, changed: string[] }} the keys of the changed templates
 */
export function updateManifest(manifest, grids) {
  const previous = new Map(
    (manifest.energy_contracts?.templates ?? []).map((template) => [template.key, template]),
  );
  const changed = [];
  const templates = OFFERS.filter((offer) => grids[offer.key])
    .flatMap((offer) => buildOfferTemplates(offer, grids[offer.key]))
    .map((template) => {
      const before = previous.get(template.key);
      if (before && contentOf(before) === contentOf(template)) {
        return before;
      }
      changed.push(template.key);
      return template;
    });
  // The grids build `rules` templates only: any other is not theirs to drop.
  templates.push(...[...previous.values()].filter((template) => template.pricing_mode !== 'rules'));
  return {
    manifest: { ...manifest, energy_contracts: { ...manifest.energy_contracts, templates } },
    changed,
  };
}

/** CHANGELOG.md with one more line under `## [Unreleased]` / `### Changed`. */
export function addChangelogLine(text, line) {
  const heading = '## [Unreleased]';
  // The heading line itself: the prose above it may quote `## [Unreleased]`.
  const start = text.search(/^## \[Unreleased\][ \t]*$/m);
  if (start === -1) {
    return text;
  }
  const bodyStart = start + heading.length;
  const next = text.slice(bodyStart).search(/\n## \[|\n\[Unreleased\]: /);
  const end = next === -1 ? text.length : bodyStart + next;
  const body = text.slice(bodyStart, end);
  const changedAt = body.indexOf('### Changed');
  let newBody;
  if (changedAt === -1) {
    newBody = `${body.trimEnd()}\n\n### Changed\n\n- ${line}\n`;
  } else {
    const afterHeading = changedAt + '### Changed'.length;
    const rest = body.slice(afterHeading);
    const listEnd = rest.search(/\n\n(?!- )|\n### /);
    const insertAt = listEnd === -1 ? body.length : afterHeading + listEnd;
    newBody = `${body.slice(0, insertAt).trimEnd()}\n- ${line}${body.slice(insertAt)}`;
  }
  return `${text.slice(0, bodyStart)}${newBody.startsWith('\n') ? '' : '\n'}${newBody}${text.slice(end)}`;
}

// --- Command line -------------------------------------------------------------

function pdfToText(file) {
  return execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
}

// Download the grid of every offer through the website form, the way a
// visitor does (the form refuses scripted posts: a real browser is needed).
async function downloadGrids(directory) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('Playwright is needed: npm install --no-save playwright');
  }
  const browser = await chromium.launch();
  try {
    for (const offer of OFFERS) {
      const page = await browser.newPage({ acceptDownloads: true });
      await page.goto(FORM_URL, { waitUntil: 'networkidle' });
      const form = page.locator('form.webform-submission-tariff-simulation-form');
      await form.locator('select[name=offer]').selectOption({ label: offer.label });
      // Choosing the offer rebuilds the form (Drupal AJAX): wait for it.
      await page.waitForLoadState('networkidle');
      await page.waitForTimeout(2000);
      await form.locator('input[name=post_code]').click();
      await form.locator('input[name=post_code]').pressSequentially(POSTCODE, { delay: 100 });
      await page.keyboard.press('Tab');
      await page.waitForFunction(
        () => {
          // Runs in the browser page, where `document` exists.
          const city = globalThis.document.querySelector(
            'form.webform-submission-tariff-simulation-form select[name=city]',
          );
          return city && !city.disabled && city.options.length > 1;
        },
        null,
        { timeout: 30_000 },
      );
      await form.locator('select[name=city]').selectOption({ index: 1 });
      await page.waitForTimeout(1500);
      const download = page.waitForEvent('download', { timeout: 60_000 });
      await form.locator('button[type=submit], input[type=submit]').first().click();
      const file = join(directory, `${offer.key}.pdf`);
      await (await download).saveAs(file);
      writeFileSync(join(directory, `grid-${offer.key}.txt`), pdfToText(file));
      console.log(`Downloaded the ${offer.label} grid`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
}

function update(directory) {
  const grids = {};
  for (const offer of OFFERS) {
    const file = join(directory, `grid-${offer.key}.txt`);
    if (existsSync(file)) {
      grids[offer.key] = parseGrid(readFileSync(file, 'utf8'));
    }
  }
  if (Object.keys(grids).length !== OFFERS.length) {
    throw new Error(`Expected ${OFFERS.length} grids in ${directory}`);
  }
  const manifestFile = 'gladys-assistant-integration.json';
  const { manifest, changed } = updateManifest(
    JSON.parse(readFileSync(manifestFile, 'utf8')),
    grids,
  );
  const date = Object.values(grids)[0].date;
  if (changed.length > 0) {
    writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(
      'CHANGELOG.md',
      addChangelogLine(
        readFileSync('CHANGELOG.md', 'utf8'),
        `Electricity contract templates: default prices of the official ${date} Gaz de Bordeaux grid (${changed.join(', ')}).`,
      ),
    );
  }
  console.log(changed.length ? `Changed: ${changed.join(', ')}` : 'Prices unchanged');
  if (process.env.GITHUB_OUTPUT) {
    writeFileSync(
      process.env.GITHUB_OUTPUT,
      `changed=${changed.length > 0}\ndate=${date}\ntemplates=${changed.join(' ')}\n`,
      { flag: 'a' },
    );
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const [command, directory] = process.argv.slice(2);
  try {
    if (command === 'fetch') {
      const target = mkdtempSync(join(tmpdir(), 'gdb-grids-'));
      await downloadGrids(target);
      update(target);
    } else if (command === 'update' && directory) {
      update(directory);
    } else {
      console.error('Usage: node .github/scripts/tariffs.mjs fetch | update <directory>');
      process.exit(1);
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
