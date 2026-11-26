---
title: Sign in to EchoFlow SiHub
nav_title: EchoFlow SiHub
description: Sign in to EchoFlow SiHub recommended access with a browser, manage call tokens, and pick or rotate the token behind a model channel.
order: 3
---

# Sign in to EchoFlow SiHub

EchoFlow SiHub is EchoFlow's recommended access service. Once you sign in, you don't apply for vendor keys yourself — pick a call token and a model channel is built for you.

Using a different provider instead? See [Connect a model](./models.md). This page covers EchoFlow SiHub only.

> Models and services are offered only where the laws and regulations of your region permit them. Check your local compliance requirements and availability before use.

## Before you start

- An account registered at the [EchoFlow console](https://api.echoflowai.cc/console/personal), with credit on it
- The desktop app installed — see [Download and install](./install.md)

When you sign in through the site in the desktop app, you can use your existing site session without first generating a system access token.

## Two lines: main site and dedicated line

EchoFlow SiHub has two entry points. A tab switcher at the top of the account area selects between them:

| Line | URL | When to pick it |
|---|---|---|
| **Main site** | `https://api.echoflowai.cc` | The default. Use this most of the time |
| **Dedicated line** | `https://expapi.echoflowai.cc` | Try it when the main site is unstable or slow |

**The two lines sign in independently and their credentials never overwrite each other.** You can sign in with one account on the main site and a different one on the dedicated line, then build a channel for each. The dot on each tab shows its state: green means that line is signed in.

## Sign in

Find the EchoFlow SiHub area under Settings → Model Settings, pick a line tab, then click **Sign in to EchoFlow SiHub**. Complete the site sign-in inside Settings. A third-party identity provider may open its own authorization window. When sign-in succeeds, the app returns to the selected line’s account panel. Select **Cancel** or press Esc to leave the sign-in page.

Once signed in, the header shows that line's **user ID, username, balance, and last refresh time**.

On a signed-in line you can:

- **Refresh** — pull the balance and token list again. When the credential has expired, the panel asks you to sign in again.
- **Sign in to EchoFlow SiHub** — the desktop app tries to restore the session on restart. Sign in again if the credential expires or the session cannot be restored.
- **Disconnect** — clear the account and the site’s sign-in state for this line in the desktop app. To revoke a call token already issued by the gateway, revoke it separately in the console. **It affects only the selected line**; the other one is untouched.

### Manual binding (advanced)

In the local desktop app, you can also expand **Manual binding (advanced)** and enter the **user ID** and **system access token**:

1. Copy the user ID from your console profile page.
2. Generate the system access token under Security settings → System access token → Generate token. The field is masked; click the eye icon to reveal it.

Remote browser connections can read account information. Use the desktop app to bind an account or update credentials.

`echoflow-account.json` stores the line and user ID, along with the username, balance, token list, and refresh time when available. Manual binding saves the system access token in this file. The file may also contain full call-token keys in plain text. Site sign-in cookies and dedicated-line access tokens stay in memory and the line’s browser storage. Treat the account file and any `.bak-before-migration-*` copies as credentials. Exclude them from diagnostic reports.

## Pick a token and configure a channel

With the account signed in, the card lists that account's call tokens, each showing its **name and a masked key preview**, along with quota state.

Selecting a token opens the shared detail panel — model, capabilities, and advanced parameters all live there. **The channel only appears in the model channel list when you save.** Closing the panel without saving leaves nothing behind.

If the account has no usable tokens, click **Create token** above the list. The app requests a token from the selected gateway. If the result is uncertain, check the token list in the console before creating another. To change quota or expiry, or to check usage, click **Console** next to it.

## Tokens and API keys are different

This is the easiest thing to mix up, so it gets its own section:

- **System access token** — belongs to the account and proves "this account is you". After manual binding, the desktop app uses it to read the account and token list.
- **Call token (API key)** — belongs to one channel; it is the credential actually sent with model calls.

**The desktop app shows only a masked API key preview by default.** You select a token ID; tests, creation, and updates are done server-side by "account + token ID" and are forced onto the endpoint that token belongs to. You can select the token from the list without revealing or copying its full key.
- Rotating a channel's token needs no pasted secret — just a different token ID.
- A main-site account's tokens can only build main-site channels; they never leak onto the dedicated line.

## Upgrading from an older version

A single account from an older `echoflow-account.json` moves to the slot for its recorded line. An account without a line marker defaults to the main site.

If you have only the retired `qingyun-account.json`, the app leaves that file in place. To use the account, sign in or bind manually on the desired line.

## Troubleshooting

**The sign-in page closed before my account appeared.** If the request was already submitted when you cancelled, sign-in can still complete. If the result is uncertain, wait for the panel to reread the selected line and check the user ID. Sign in again only if the account you want is still missing.

**Balance is missing after signing in.** Click **Refresh**. Balance may not have synced right after sign-in; the panel shows "never synced" until it does.

**It says the sign-in has expired.** Click **Sign in to EchoFlow SiHub** to sign in again. If you use manual binding, generate a fresh system access token in the console and use **Update token**.

**The token list is empty.** This account has no call tokens yet. Click **Create token** above the list; it appears there as soon as it is created, with no refresh needed.

**I want to switch to a third-party provider.** EchoFlow SiHub and third-party providers coexist; switch between them in the model channel list at any time. See [Connect a model](./models.md).

## Related

- [Connect a model](./models.md) — third-party APIs and local models
- [Run your first session](./first-session.md) — the first thing after setting up an account
- [Settings reference](../desktop/settings.md) — the other switches in Model Settings
- [Install, launch, and connection problems](./troubleshooting.md) — what to check when sign-in fails
