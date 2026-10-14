# Security policy

## Supported versions

Only the latest release of the Gaz de Bordeaux integration receives security
fixes. Update the integration from the Gladys store before reporting an issue.

| Version      | Supported |
| ------------ | --------- |
| 1.x (latest) | Yes       |
| older        | No        |

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub: open the **Security** tab of
[prohand/gladys-gazdebordeaux](https://github.com/prohand/gladys-gazdebordeaux/security),
then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove email addresses, passwords, tokens and
  contract numbers first).

You should get a first answer within 7 days. The fix ships as a new version of
the integration, and the advisory is published once users can update.

## Scope

In scope: the code of this repository and the Docker image it publishes —
including how it stores and sends the customer account credentials.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
and the Gaz de Bordeaux website and services the integration talks to (report
those to Gaz de Bordeaux).

## How the integration handles your data

- The email and password of the customer account are stored by Gladys in the
  integration configuration; the password is a `secret` field.
- They are only sent to `https://life.gazdebordeaux.fr`, over HTTPS, to sign
  in. Neither they nor the session token are ever written to the logs.
- The only file the integration writes is `/data/state.json`: the last day
  published and announced per contract, no credentials.

## Good practices for users

- Use a password for the Gaz de Bordeaux account that you use nowhere else.
- Keep Gladys and the integration up to date.
- Remove personal data (email, contract numbers) from logs before sharing them.
