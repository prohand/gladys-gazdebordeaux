# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) and to human contributors working on
this repository.

## What this is

A Gladys Assistant **external integration** (Node 22+, ESM, no build step, one runtime dependency:
`@gladysassistant/integration-sdk`) for **Gaz de Bordeaux**, a French gas and electricity
supplier. It signs in to the customer account (life.gazdebordeaux.fr) with the user's email and
password and publishes, per contract, the daily consumption, cost and gas volume, plus the month
and year totals. Gladys 5.1+ adds scene triggers (new daily reading, high consumption, account
unreachable), scene actions (refresh, get a consumption) and a "consumption" widget; Gladys 5.2+
adds electricity contract templates (three offers × Base, Peak/Off-peak) to the contract wizard,
declared in the manifest `energy_contracts` (the core rule engine prices them), and the
"My contract prices" button gives the current prices of the user's own contracts, read on
espaceclient.gazdebordeaux.fr.

Started from the official
[JavaScript template](https://github.com/GladysAssistant/integration-template-js); the workflows
are the ones of [prohand/gladys-devmel](https://github.com/prohand/gladys-devmel).

## Commands

```bash
npm install
npm test                                  # node --test (built-in runner)
node --test test/client.test.js           # one file
node --test --test-name-pattern "widget"  # tests whose name matches
npm run lint                              # eslint .
npm run format:check                      # prettier --check . (CI gate)
npm run format                            # prettier --write .
npx github:GladysAssistant/integration-store .   # store admission checks
```

CI runs `format:check`, `lint`, `test` on Node 22 and 24; pull requests also run the store checks
and build the Docker image. Run the three commands before pushing.

## Architecture

```
index.js                     SDK bootstrap only: createIntegration(gladys), shutdown, connect
src/integration.js           every SDK handler + the refresh pipeline and its timer
src/config.js                DEFAULT_CONFIG (mirrors the manifest defaults) + normalization
src/i18n.js                  LANGUAGES = en, fr, de, es; localize() / pick()
src/messages.js              user-facing messages (connection status, action answers)
src/store.js                 /data/state.json: last day published / announced per contract
src/publish.js               states of the created devices, paced; transport badges
src/gazdebordeaux/client.js  HTTP client of life.gazdebordeaux.fr (login, contracts, consumptions)
src/gazdebordeaux/readings.js payloads -> plain days and totals
src/gazdebordeaux/account.js one refresh = every contract read; snapshots kept in memory
src/gazdebordeaux/dates.js   YYYY-MM-DD days on the Paris calendar
src/gazdebordeaux/prices.js  the current prices of the user's contracts (espaceclient), as given
src/devices/contract.js      the device of a contract: features, dated states, totals
src/devices/index.js         discovery payload, contract lookup, "is it created?"
src/capabilities/scenes.js   scene triggers fired after a refresh, scene action handlers
src/capabilities/widget.js   dashboard widget content + its Refresh action
docs/{en,fr,de,es}.md        user documentation, re-hosted by Gladys (keep the four in sync)
test/                        node --test, against the SDK fake Gladys + test/helpers/fakeWebsite.js
.github/scripts/changelog-release.mjs  changelog roll of the Release workflow (tested)
.github/scripts/tariffs.mjs  official price grids -> energy contract templates (tested)
```

### The Gaz de Bordeaux website

There is no public API: the client calls the JSON endpoints the customer website itself uses
(the same as the community Home Assistant integration `gazdebordeaux-ha`).

- `POST /api/login_check` `{email, password}` → `{token}` (JWT, a few hours). 401 = bad
  credentials or expired token: the client signs in again once.
- `GET /api/users/me` → `selectedHouse` + `houses[]`. `selectedHouse` is `/api/houses/x` or
  `/houses/x` depending on the account, and `null` on gas + electricity accounts: always go
  through `normalizeHousePath`, and read every house.
- `GET /api/houses/{uuid}` → `contractType.category` (`gas`, `electricity`).
- `GET /api/houses/{uuid}/consumptions?scale=month&startDate&endDate` → one entry per day
  (`kwh`, `volumeOfEnergy`, `price`, `temperature`) + `total`; `scale=year` → `total`.
- The current prices come from **espaceclient.gazdebordeaux.fr** (same email and password):
  `POST /api/authentication-token` → `{token}`, `GET /api/me` → `contracts[]` (`id`,
  `type`: `gaz` / `elec`), `GET /api/contracts/{id}` → `tarif`, `optionTarif`, `power`,
  `offPeakHours`, `tarifScale` (see `prices.js`).
- A filter in front of the site answers **HTML** (403, or 200 with the app) to requests that do
  not look like the site's own: every call sends `BROWSER_HEADERS`. HTML = `blocked` error.

### Invariants worth knowing

- **External ids are forever**: device = `externalIds('contract', <house uuid>)`, feature keys in
  `FEATURES`. Never change them, nor the manifest keys (config, actions, triggers, scene actions,
  widget): users store them.
- **Readings arrive a day or two late.** Daily values are published with `created_at` = noon UTC
  of their day (same day in Paris), never "now".
- **Only created devices get states.** A device created later is caught up by `onDeviceCreated`
  from the in-memory snapshot, history included.
- **No duplicates across restarts**: `store.lastPublishedDay` (dated states) and
  `store.lastEventDay` (scene events) are kept in `/data/state.json`. The very first read of a
  contract announces nothing.
- **300 states per minute** on the host API: `publishPaced` sends 100 per request and pauses a
  minute every 250.
- **Electricity** also feeds a `daily-consumption` feature through `publishEnergyConsumption`
  (upserted by day, older Gladys refuse it: a warning, not a failure). Gas does not: the core
  attaches such a consumption to the electric meter.
- **No polling by Gladys** (`should_poll: false`): the integration's own timer refreshes every
  `refresh_hours`. Refreshes never overlap.
- **Transport badge** `cloud` (last read OK), `unreachable` (failed), `degraded` when the latest
  reading is more than `STALE_AFTER_DAYS` old.
- **Every feature declares `min`/`max`** (NOT NULL in Gladys).
- **Secrets**: never log the password, the token or the login body. The rootfs is read-only:
  write only under `/data`.
- **Energy contracts** (`energy_contracts.templates`, `pricing_mode: "rules"`, Gladys 5.2+): six
  templates (NovaFixe Élec, NovaFixe Bonus Élec, NovaFlex Élec × Base, Peak/Off-peak), **generated**
  by `.github/scripts/tariffs.mjs` from the official grids — never edit them by hand: run
  `node .github/scripts/tariffs.mjs fetch` (needs `npm install --no-save playwright` and
  `pdftotext`), or `update <dir>` on `grid-<offer>.txt` files. The monthly workflow
  `.github/workflows/tariffs.yml` does it and opens a PR; a template whose prices changed takes the
  grid date as `version` (shown by the wizard; Gladys never updates an existing contract: a price
  change is a new contract, which the docs tell the user), an
  unchanged one is kept as is. When the
  prices change, also update the price tables of `docs/*.md` and `test/fixtures/grid-*.txt`
  (`test/tariffs.test.js` checks the manifest matches the fixtures). Prices are template `inputs`:
  a fixed-price contract keeps the price of its subscription date. Never rename a template key.
  Electricity only (Gladys contracts do not cover gas). Peak/Off-peak needs half-hourly readings.
- **Contract prices** (`src/gazdebordeaux/prices.js`): read from espaceclient
  `tarifScale` (`prixTotalTTCAbo` or `abo.prixAboTTC`; `base` / `hp` / `hc`
  `.prixConsoUniteWithTaxeTTC`; gas `prixTotalTTCConso`), shown with every decimal given.
  **Never compute a price** from the daily amounts: they are rounded to the cent, the result is
  approximate (0.16066 instead of 0.160164 on a real account). When espaceclient cannot be read,
  the button sends the user to its "Votre prix actuel" line. These field names come from the
  website's own code, not from a documented API: keep every read null-safe; their NAMES are
  logged at debug level to check them on a real account.
- **Widget budget**: 8 components at most (4 tiles + chart + status + button today);
  `test/widget.test.js` runs `validateWidgetContent` in the four languages.

## Rules

- **Versions belong to the Release workflow** (Actions → Release). Never edit `version` in
  `package.json` or the manifest, nor the `docker_image` tag, by hand. `test/manifest.test.js`
  checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]` in `CHANGELOG.md`
  (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`). Never write a version heading.
- **Languages.** Every user-facing text is `{ en, fr, de, es }`: manifest texts (checked by
  `test/manifest.test.js`), messages (`src/messages.js`, built with `src/i18n.js`), widget texts
  and the four docs.
- **Manifest.** `categories` needs Gladys ≥ 4.86.0; `widgets`, `scene_triggers`,
  `scene_actions` need ≥ 5.1.0; `energy_contracts` needs ≥ 5.2.0. The catalog `description`
  holds 10 to 100 characters per language. Change the manifest and the handlers together.
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why, in English. Tests
  never touch the network: use `test/helpers/fakeWebsite.js`.
