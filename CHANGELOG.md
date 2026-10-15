# Changelog

All notable changes to this integration are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[semantic versioning](https://semver.org/), bumped by the Release workflow.

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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
- Monthly "Electricity prices" workflow: downloads the official price grids
  and opens a pull request when a price changes.
- "Test the connection" and "Refresh now" buttons in the configuration screen.
- English, French, German and Spanish texts and documentation.
- CI (format, lint, tests on Node 22 and 24, store checks, Docker build),
  Release, multi-arch build and GitHub Release workflows, Dependabot.
- `SECURITY.md` and `CLAUDE.md`.

[Unreleased]: https://github.com/prohand/gladys-gazdebordeaux/commits/main
