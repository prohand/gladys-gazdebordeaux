# Gaz de Bordeaux

This integration connects Gladys to your **Gaz de Bordeaux customer account**
([life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)). It reads your **gas**
and **electricity** consumption there, and its cost, to show them in Gladys,
chart them and start scenes.

It works over the Internet (**cloud** badge): nothing to install at home, no
module on the meter.

## Before you start

- You need an account on [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr)
  that shows your consumption. Sign in once from a browser to check.
- Gaz de Bordeaux publishes the consumption of a day **one or two days later**
  (the time it takes the Gazpar or Linky meter to report it). Gladys therefore
  always shows the **latest day read**, not today.
- Gladys 5.2 or later is required.

## Configuration

1. Open the **Configuration** tab of the integration.
2. Fill in the **email** and **password** of your customer account.
3. Adjust if needed:
   - **Refresh interval (hours)**: how often the customer account is read,
     every 6 hours by default (1 to 24). Readings only change once a day: there
     is no point going lower.
   - **Days of history to import**: past days sent to Gladys when a device is
     created, 30 by default (up to 90), so the charts do not start empty.
   - **Gas / electricity alert threshold (kWh/day)**: above it, the "High daily
     consumption" trigger fires. 0 turns it off.
4. Save. The **Test the connection** button checks the email and password and
   lists the contracts found.
5. Open the **Discovery** tab: one device is offered **per contract**
   ("Gaz de Bordeaux – Gaz", "Gaz de Bordeaux – Électricité"). Add the ones
   you want to follow.

The password is a secret field: it is never written to the logs.

## What you get

Each "contract" device carries read-only sensors:

| Feature                     | Unit | Contract    | Value                               |
| --------------------------- | ---- | ----------- | ----------------------------------- |
| Consumption of the day read | kWh  | all         | one value per day, dated by its day |
| Cost of the day read        | €    | all         | one value per day, dated by its day |
| Gas volume of the day read  | m³   | gas         | one value per day, dated by its day |
| Month consumption           | kWh  | all         | since the 1st of the month          |
| Month cost                  | €    | all         | since the 1st of the month          |
| Year consumption            | kWh  | all         | year total given by Gaz de Bordeaux |
| Year cost                   | €    | all         | year total given by Gaz de Bordeaux |
| Daily consumption           | kWh  | electricity | sent to the Gladys Energy module    |

Daily values are **dated by the day they describe**, not by the time of the
read: the chart shows Monday's consumption on Monday, even when it arrived on
Wednesday.

When a device is created, the last days (see **Days of history to import**)
are imported. They are never sent twice, even after a restart.

### The connection badge

- **Cloud**: the last read succeeded.
- **Cloud with an orange dot**: the customer account answers, but the latest
  reading is more than 4 days old. The meter may have stopped reporting:
  check it on the Gaz de Bordeaux website.
- **Unreachable**: the last read failed (see "Troubleshooting").

## Actions

- **Test the connection**: signs in with the email and password entered and
  lists the contracts found.
- **Refresh now**: reads the customer account right away and gives the latest
  day read.
- **My contract prices**: computes the prices actually charged on your
  electricity contract (see "Energy contracts").

## Scenes

The integration adds its cards to the scene editor, under **Integrations**.

### Triggers

- **New daily reading**: Gaz de Bordeaux published a new day. Optionally
  filter on a contract or an energy. The following actions can read
  `{{triggerEvent.data.date}}`, `{{triggerEvent.data.kwh}}`,
  `{{triggerEvent.data.cost}}` and `{{triggerEvent.data.volume}}` (gas).
- **High daily consumption**: the new day goes above the alert threshold set
  in the configuration. Variables: `date`, `kwh`, `threshold`.
- **Customer account unreachable**: reading failed after it had worked. Filter
  on the reason (sign-in refused, request blocked, network, unexpected answer,
  no contract). Variables: `reason`, `message`.

A day is announced once, even after a restart. On the very first read nothing
is announced: only the following days are.

### Actions

- **Refresh the Gaz de Bordeaux readings**: reads the customer account right
  away. Outputs: `success` and `contracts` (number of contracts read).
- **Get a Gaz de Bordeaux consumption**: pick a contract and a period (last day
  read, this month, this year). Outputs: `kwh`, `cost`, `volume`, `date` and
  `available` (false when there is no data). Handy for a "Yesterday: 42 kWh,
  €5.10" message.

Example: every morning at 8:00, **Get a consumption** (last day read), then
**Send a message** "Gas on {{date}}: {{kwh}} kWh, €{{cost}}".

## Dashboard

Add the **Gaz de Bordeaux consumption** widget to a dashboard. It shows:

- the consumption and cost of the latest day read and of the month;
- a bar chart of the last 30 days;
- the energy, the latest day read, the gas volume, the year total, the time
  of the last read and the connection state;
- a **Refresh** button.

In the widget settings, pick the contract to show; left empty, it is the
first one.

## Energy contracts (electricity)

The integration adds contract templates to the Gladys contract wizard
(**Energy** → the meter contract), so Gladys computes the cost of your
electricity at the Gaz de Bordeaux prices. One template per offer and option:

| Offer               | Prices                                                             | Templates           |
| ------------------- | ------------------------------------------------------------------ | ------------------- |
| NovaFixe Élec       | locked for 3 years at subscription, 10% below the regulated tariff | Base, Peak/Off-peak |
| NovaFixe Bonus Élec | like NovaFixe, plus €100 off the first year                        | Base, Peak/Off-peak |
| NovaFlex Élec       | indexed on the regulated tariff (TRV), kWh excl. taxes 5% below it | Base, Peak/Off-peak |

### Your prices: the "My contract prices" button

A fixed-price offer keeps **the price of its subscription day**: a contract
signed two years ago does not have today's grid prices. The **My contract
prices** button (**Configuration** tab) computes them from **your** customer
account: for each day Gaz de Bordeaux gives the kWh and what they cost, and
the integration derives the kWh price actually charged (peak and off-peak
apart), the monthly subscription, the power and the off-peak hours. Example:

> Electricity (6 kVA): 0.18373 €/kWh, subscription 15.87 €/month. Computed from
> the last 30 days of your account.

Copy these values into the Gladys contract wizard. The price charged is also
shown in the widget (**Price paid** row).

Gladys gives an integration no way to fill a contract in for you: that is why
they are copied once (and at each price change, for NovaFlex).

### The default prices: the official grids

The values offered by default are those of the **official Gaz de Bordeaux
price grids** (incl. VAT, here the 1 October 2026 ones). They are downloaded
every month from gazdebordeaux.fr: when a price changes, a new version of the
integration offers the new prices (Gladys then asks whether to update your
contract).

| Power  | Subscription / month | NovaFixe: Base kWh | NovaFixe: peak / off-peak | NovaFlex: Base kWh | NovaFlex: peak / off-peak |
| ------ | -------------------- | ------------------ | ------------------------- | ------------------ | ------------------------- |
| 3 kVA  | 12.13                | 0.18373            | –                         | 0.19190            | –                         |
| 6 kVA  | 15.87                | 0.18373            | 0.19648 / 0.14669         | 0.19190            | 0.20536 / 0.15280         |
| 9 kVA  | 19.88                | 0.18233            | 0.19648 / 0.14669         | 0.19042            | 0.20536 / 0.15280         |
| 12 kVA | 23.76                | 0.18233            | 0.19648 / 0.14669         | 0.19042            | 0.20536 / 0.15280         |
| 15 kVA | 27.40                | 0.18233            | 0.19648 / 0.14669         | 0.19042            | 0.20536 / 0.15280         |
| 18 kVA | 31.14                | –                  | 0.19648 / 0.14669         | –                  | 0.20536 / 0.15280         |
| 24 kVA | 39.13                | –                  | 0.19648 / 0.14669         | –                  | 0.20536 / 0.15280         |
| 30 kVA | 46.46                | –                  | 0.19648 / 0.14669         | –                  | 0.20536 / 0.15280         |
| 36 kVA | 53.88                | –                  | 0.19648 / 0.14669         | –                  | 0.20536 / 0.15280         |

The subscription is the same for the three offers. NovaFixe Bonus Élec has the
NovaFixe Élec prices.

### Good to know

- **Base** works with the daily consumption this integration sends to the
  Energy module.
- **Peak/Off-peak** needs a **half-hourly** consumption (a Linky meter read
  every 30 minutes by another integration). With the daily consumption only,
  Gladys cannot tell which kWh were off-peak: do not use this template then.
- **Gas is not covered**: Gladys energy contracts are for electricity only. The
  gas cost stays the one given by Gaz de Bordeaux ("Cost of the day read",
  "Month cost"… features).

## Troubleshooting

The status message of the **Configuration** tab says what is wrong:

- **Sign-in refused**: the email or password is wrong. Use the ones of
  [life.gazdebordeaux.fr](https://life.gazdebordeaux.fr) and check you can
  sign in from a browser.
- **The website blocked the request**: the Gaz de Bordeaux website sometimes
  filters automated requests. The integration retries at the next refresh; if
  it lasts, open an issue on the GitHub repository.
- **Unreachable**: Gladys has no Internet access, or the website is down.
- **No contract**: the account has no visible gas or electricity contract.

The integration logs (Gladys → Integrations → Gaz de Bordeaux → logs) give the
details. They never contain the password nor the session token.

This integration is not published by Gaz de Bordeaux: it reads the same data
as your customer account. If the website changes, it may stop working until
an update.
