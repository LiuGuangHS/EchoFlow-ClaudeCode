---
title: Bind an EchoFlow account
nav_title: Official account
description: Bind an EchoFlow account, manage call tokens, and pick or rotate the token behind a model channel.
order: 3
---

# Bind an EchoFlow account

EchoFlow Code can call the model service EchoFlow provides directly. Once an account is bound you don't apply for vendor keys yourself — pick a call token and a model channel is built for you.

Using a different provider instead? See [Connect a model](./models.md). This page covers the official account only.

## Before you start

- An account registered at the [EchoFlow console](https://api.echoflowai.cc/console/personal), with credit on it
- A **system access token** generated there (Security settings → System access token → Generate token)
- The desktop app installed — see [Download and install](./install.md)

## Two lines: main site and dedicated line

The official service has two entry points. A tab switcher at the top of the binding area selects between them:

| Line | URL | When to pick it |
|---|---|---|
| **Main site** | `https://api.echoflowai.cc` | The default. Use this most of the time |
| **Dedicated line** | `https://expapi.echoflowai.cc` | Try it when the main site is unstable or slow |

**The two lines bind independently and their credentials never overwrite each other.** You can bind one account on the main site and a different one on the dedicated line, then build a channel for each. The dot on each tab shows its binding state: green means that line is bound.

## Bind the account

Find the official binding area under Settings → Model Settings (named "Providers" in older builds), pick a line tab, then:

1. Enter the **user ID** — copy it from your console profile page.
2. Enter the **system access token** — paste the one you just generated. The field is masked; click the eye icon to reveal it.
3. Click **Bind main-site account** or **Bind dedicated-line account**.

Once bound, the header shows that line's **user ID, username, balance, user group, and last refresh time**. The two most common failures are a mistyped user ID and an expired token; the UI reports both in place.

A bound line offers three actions:

- **Update token** — paste a fresh system access token when the old one stops working.
- **Refresh** — pull the balance and token list again.
- **Disconnect** — clear the account on this line. **It affects only the selected line**; the other one is untouched.

Account information is stored locally in `echoflow-account.json` and is never uploaded.

## Pick a token and configure a channel

With the account bound, **Choose an API key and configure a channel** appears below it. The dropdown lists that account's call tokens, each showing its **name and a masked key preview**, along with quota state.

Selecting a token opens the shared detail panel — model, capabilities, and advanced parameters all live there. **The channel only appears in the model channel list when you save.** Closing the panel without saving leaves nothing behind.

If the account has no usable tokens, create one in the console first and click **Refresh**.

## Tokens versus API keys

This is the part people mix up, so it is worth stating plainly:

- A **system access token** belongs to the account. It proves the account is yours. Detecting the account, reading the token list, and rotating tokens all use it.
- A **call token (API key)** belongs to one channel. It is the credential actually sent on model calls.

**The desktop app never handles the full API key.** What you pick is a token ID; testing, creation, and updates are resolved server-side from the account and token ID, and are forced onto that token's endpoint. That means:

- The token list only ever shows masked previews — the full key never reaches the desktop app.
- Rotating a channel's token needs no pasted secret, only a different token ID.
- A main-site token can only build main-site channels; it never leaks onto the dedicated line.

## Upgrading from an older version

Older builds stored a single account. On upgrade it is migrated into the two slots automatically: the previous account lands on the **main site**, and the dedicated line is left empty.

If the account area looks empty after upgrading, click **Refresh** once. If it still does, the migration could not read the old file — just bind again. The legacy `qingyun-account.json` is only read during migration; new data always goes to `echoflow-account.json`.

## Troubleshooting

**No balance after binding.** Click **Refresh**. A freshly bound account may not have synced yet, and the UI shows "not synced yet".

**"Token invalid or expired."** Generate a new system access token in the console and use **Update token**.

**The dropdown has no tokens.** This account has no call tokens yet. The console usually provides one; create one if not, then click **Refresh**.

**I want to use a third-party provider instead.** Official accounts and third-party providers coexist; switch between them in the model channel list at any time. See [Connect a model](./models.md).

## Related

- [Connect a model](./models.md) — third-party APIs and local models
- [Run your first session](./first-session.md) — what to do once the account works
- [Settings reference](../desktop/settings.md) — the other switches in Model Settings
- [Won't install, won't open, won't connect](./troubleshooting.md) — order to check when binding fails
