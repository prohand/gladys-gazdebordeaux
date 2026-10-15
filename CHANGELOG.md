# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.5] - 2026-10-15

### Changed

- "My contract" energy contract template: nothing to type any more. The
  integration now also gives Gladys the subscription read on espaceclient
  (spread over the month like Gladys does), so the wizard asks for no price.
  A contract created with the first version keeps its typed subscription,
  counted once.

## [1.0.4] - 2026-10-15

### Added

- Energy contract template "Gaz de Bordeaux – My contract (customer account
  prices)" (Gladys 5.2+): pick it in the Gladys contract wizard and type only
  the subscription; the integration gives Gladys the kWh price of your own
  contract, read on espaceclient.gazdebordeaux.fr (Base or Peak/Off-peak, any
  offer). A price change applies from the day it is read, with no new
  contract to create. "My contract prices" now points to it.

## [1.0.3] - 2026-10-15

### Added

- "Contract prices changed" scene trigger: the current prices of
  espaceclient.gazdebordeaux.fr are read at every refresh, and a change (kWh,
  peak/off-peak or subscription) fires it once, with the new and previous
  values, to send yourself a message.
- The widget shows the current price of the contract, read on espaceclient.

## [1.0.2] - 2026-10-15

### Changed

- "My contract prices" now reads the current prices of your contracts on
  espaceclient.gazdebordeaux.fr (same email and password), as the line
  "Votre prix actuel" gives them, instead of computing them from the daily
  amounts (0.16066 €/kWh and 16.01 €/month instead of 0.160164 and 15.87 on
  a real account). When espaceclient cannot be read, it says where to find
  them.

### Removed

- The "Price paid" row of the widget, and the price change found in the
  readings: both were computed, so approximate.

### Fixed

- The Release workflow put the version heading inside the changelog intro.

## [1.0.1] - 2026-10-15

### Added

- First version of the Gaz de Bordeaux integration, built on the official
  JavaScript template: sign-in to the customer account (life.gazdebordeaux.fr),
  one device per contract (gas, electricity).
- Daily consumption, cost and gas volume, dated by day, with the last days
  imported when a device is created; month and year totals.
- Electricity contracts feed their daily consumption to the Gladys energy
  feature (`publishEnergyConsumption`).
- Cloud transport badge, flagged degraded when the latest reading is more than
  four days old.
- Scene triggers: new daily reading, high daily consumption (thresholds in the
  configuration), customer account unreachable.
- Scene actions: refresh the readings, get a consumption (last day, month,
  year).
- Dashboard widget: last day, month and year consumption and costs, a chart
  of the last 30 days and a Refresh button.
- Energy contract templates for the Gladys contract wizard (Gladys 5.2+):
  NovaFixe Élec, NovaFixe Bonus Élec and NovaFlex Élec, Base and
  Peak/Off-peak, with the official Gaz de Bordeaux prices of 1 October 2026
  as defaults.
- "My contract prices" button and a "Price paid" widget row: the kWh price,
  subscription, power and off-peak hours of your own contract, incl. VAT,
  computed from the customer account (a fixed price keeps its
  subscription-date price) within a cent of the daily amounts' rounding.
  Offers without a template (Ecodigo Elec, older offers): the docs say how
  to set their contract.
  A price change found in the readings is given with its day, the prices
  computed over the days since then, and what to do in Gladys (end the
  contract the day before, create a new one); the docs explain it.
- Monthly "Electricity prices" workflow: downloads the official price grids
  and opens a pull request when a price changes.
- "Test the connection" and "Refresh now" buttons in the configuration screen.
- English, French, German and Spanish texts and documentation.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build),
  Release, multi-arch build and GitHub Release workflows, Dependabot.
- `SECURITY.md` and `CLAUDE.md`.

[Unreleased]: https://github.com/prohand/gladys-gazdebordeaux/compare/v1.0.5...HEAD
[1.0.5]: https://github.com/prohand/gladys-gazdebordeaux/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/prohand/gladys-gazdebordeaux/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/prohand/gladys-gazdebordeaux/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/prohand/gladys-gazdebordeaux/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/prohand/gladys-gazdebordeaux/releases/tag/v1.0.1
