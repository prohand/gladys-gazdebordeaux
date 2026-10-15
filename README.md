# Gaz de Bordeaux — Gladys Assistant integration

External integration connecting [Gladys Assistant](https://gladysassistant.com) to a
**Gaz de Bordeaux** customer account ([life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)):
the daily **gas** and **electricity** consumption, its cost, and the month and year totals,
in Gladys, its charts, its scenes and its dashboard.

Built on the official
[JavaScript integration template](https://github.com/GladysAssistant/integration-template-js)
and the SDK
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

User documentation: [English](./docs/en.md) · [Français](./docs/fr.md) ·
[Deutsch](./docs/de.md) · [Español](./docs/es.md).

## What it does

| Gladys surface   | What the integration offers                                                         |
| ---------------- | ----------------------------------------------------------------------------------- |
| Devices          | One per contract (gas, electricity): daily kWh / € / m³ dated by day, month, year   |
| Energy           | Electricity contracts feed their daily consumption (`publishEnergyConsumption`)     |
| Transport badge  | `cloud` — `unreachable` when the account fails, degraded when readings are stale    |
| Configuration    | Email + password (secret), refresh interval, history to import, alert thresholds    |
| Buttons          | **Test the connection**, **Refresh now**, **My contract prices**                    |
| Scene triggers   | New daily reading · High daily consumption · Customer account unreachable           |
| Scene actions    | Refresh the readings · Get a consumption (last day, month, year)                    |
| Dashboard widget | Last day / month consumption and cost, 30-day chart, year total, Refresh button     |
| Energy contracts | NovaFixe, NovaFixe Bonus, NovaFlex Élec templates (Base, Peak/Off-peak), Gladys 5.2 |
| Contract prices  | **My contract prices** button + widget row: the prices charged, from the account    |

Manifest: `type: "device"`, `transports: ["cloud"]`, `categories: ["energy"]`,
`gladys_version: ">=5.2.0"` (scenes and widget need 5.1, energy contracts 5.2).

## How it talks to Gaz de Bordeaux

One transport: **cloud**. There is no public API: the integration calls the JSON endpoints of
the customer website (sign-in, contracts, consumptions), the same ones the community
[Home Assistant integration](https://github.com/chriscamicas/gazdebordeaux-ha) uses. See
[`src/gazdebordeaux/client.js`](./src/gazdebordeaux/client.js) and [`CLAUDE.md`](./CLAUDE.md)
for the endpoints and their quirks.

### Electricity prices

- **New prices**: the contract templates default to the **official price grids**, downloaded from
  www.gazdebordeaux.fr (`.github/scripts/tariffs.mjs`: Playwright fills the website form, `pdftotext`
  reads the PDF). The [Electricity prices](.github/workflows/tariffs.yml) workflow runs it every
  month and opens a pull request when a price changed.
- **Old prices**: a fixed-price offer keeps the price of its subscription date, which no current grid
  gives. The integration reads it on the customer's own account
  ([`src/gazdebordeaux/prices.js`](./src/gazdebordeaux/prices.js)) and shows it on the
  **My contract prices** button and in the widget, to type into the **My contract** templates (Base,
  Peak/Off-peak) of the Gladys contract wizard.

### Readings

Gaz de Bordeaux publishes each day one or two days late, so the integration reads the account
every few hours (6 by default), publishes the new days **dated by the day they describe**, and
imports the last days when a device is created. A small state file in `/data` makes sure a
restart never publishes a day twice nor announces it twice.

## Project structure

```
.
├─ index.js                          # SDK bootstrap (no logic)
├─ src/
│  ├─ integration.js                 # SDK handlers + refresh pipeline + timer
│  ├─ config.js                      # defaults + normalization
│  ├─ i18n.js                        # en / fr / de / es helpers
│  ├─ messages.js                    # user-facing messages
│  ├─ store.js                       # /data/state.json
│  ├─ publish.js                     # states (paced), transport badges
│  ├─ gazdebordeaux/                 # website client, payload parsing, account, dates
│  ├─ devices/                       # contract device + registry
│  └─ capabilities/                  # scenes + widget (Gladys 5.1+)
├─ docs/{en,fr,de,es}.md             # user documentation, re-hosted by Gladys
├─ test/                             # node --test, fake Gladys (SDK) + fake website
├─ gladys-assistant-integration.json # manifest
├─ Dockerfile                        # Node 24 Alpine, non-root, read-only rootfs ready
├─ CHANGELOG.md                      # Keep a Changelog, rolled by the Release workflow
├─ CLAUDE.md                         # project rules for contributors and coding assistants
├─ SECURITY.md                       # how to report a vulnerability privately
└─ .github/
   ├─ workflows/ci.yml               # format, lint, tests (Node 22 + 24), store checks, Docker build
   ├─ workflows/release.yml          # UI-driven release: bump + changelog + tag + build
   ├─ workflows/build.yml            # multi-arch image (amd64 + arm64) to ghcr.io
   ├─ workflows/github-release.yml   # GitHub Release of every version tag
   ├─ workflows/tariffs.yml          # monthly: official electricity prices -> pull request
   ├─ scripts/changelog-release.mjs  # changelog roll used by release.yml
   ├─ scripts/tariffs.mjs            # official price grids -> contract templates
   └─ dependabot.yml                 # npm weekly, Actions and Docker monthly
```

## Run it locally

```bash
npm install
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="gazdebordeaux" \
GDB_DATA_DIR="./data" \
LOG_LEVEL=debug \
npm start
```

The three `GLADYS_*` variables are injected by the Gladys supervisor in production.
`GDB_DATA_DIR` (default `/data`) is where the state file goes.

## Quality checks

```bash
npm run format:check   # Prettier
npm run lint           # ESLint
npm test               # node --test — no network: a fake website and the SDK fake Gladys
npx github:GladysAssistant/integration-store .   # store admission checks
```

The same checks run on every push and pull request (see
[`.github/workflows/ci.yml`](.github/workflows/ci.yml)).

## Release

1. Describe the changes under `## [Unreleased]` in [`CHANGELOG.md`](CHANGELOG.md).
2. **Actions → Release → Run workflow**, pick `patch`, `minor` or `major`.

The workflow bumps `package.json` and the manifest (`version` + `docker_image`), rolls the
changelog, tags `vX.Y.Z`, builds the `linux/amd64` + `linux/arm64` image to
`ghcr.io/prohand/gladys-gazdebordeaux` and publishes the GitHub Release. The store indexer
picks up the new version.

Before the first release: add the GitHub topic `gladys-assistant-integration` to the
repository, make the ghcr.io package public, and turn on **Private vulnerability reporting**
(see [`SECURITY.md`](SECURITY.md)).

## Disclaimer

Not affiliated with Gaz de Bordeaux. The integration reads the same data as the customer
website; a change on that website may break it until an update.

## License

Apache-2.0
