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

You no longer need to generate a system access token first: the login window hands the site session you already have to the desktop app.

## Two lines: main site and dedicated line

EchoFlow SiHub has two entry points. A tab switcher at the top of the account area selects between them:

| Line | URL | When to pick it |
|---|---|---|
| **Main site** | `https://api.echoflowai.cc` | The default. Use this most of the time |
| **Dedicated line** | `https://expapi.echoflowai.cc` | Try it when the main site is unstable or slow |

**The two lines sign in independently and their credentials never overwrite each other.** You can sign in with one account on the main site and a different one on the dedicated line, then build a channel for each. The dot on each tab shows its state: green means that line is signed in.

## Sign in

Find the EchoFlow SiHub area under Settings → Model Settings, pick a line tab, then click **Sign in to EchoFlow SiHub**. A browser window opens; complete the site sign-in there. The window closes itself on success and the account details fill the panel.

Once signed in, the header shows that line's **user ID, username, balance, and last refresh time**.

A signed-in line offers three actions:

- **Refresh** — pull the balance and token list again. When the credential has expired, the panel asks you to sign in again.
- **Sign in to EchoFlow SiHub** — run the browser sign-in again after the credential expires or the app restarts.
- **Disconnect** — clear the account on this line together with the locally stored sign-in state. **It affects only the selected line**; the other one is untouched.

### Manual binding (advanced)

Where no login window is available (the browser build, for example, or a remote desktop), expand **Manual binding (advanced)** and enter the **user ID** and **system access token**:

1. Copy the user ID from your console profile page.
2. Generate the system access token under Security settings → System access token → Generate token. The field is masked; click the eye icon to reveal it.

The account record lives locally in `echoflow-account.json` (user ID and line only) and is never uploaded; site credentials stay in memory and in the login window's own storage.

## Pick a token and configure a channel

With the account signed in, **Choose an API key and configure a channel** appears below it. The dropdown lists that account's call tokens, each showing its **name and a masked key preview**, along with quota state.

Selecting a token opens the shared detail panel — model, capabilities, and advanced parameters all live there. **The channel only appears in the model channel list when you save.** Closing the panel without saving leaves nothing behind.

If the account has no usable tokens, create one in the console first, then click **Refresh**.

## Tokens and API keys are different

This is the easiest thing to mix up, so it gets its own section:

- **System access token** — belongs to the account and proves "this account is you". Manual binding, account checks, reading the token list, and rotating tokens all rely on it.
- **Call token (API key)** — belongs to one channel; it is the credential actually sent with model calls.

**The desktop app shows only a masked API key preview by default.** You select a token ID; tests, creation, and updates are done server-side by "account + token ID" and are forced onto the endpoint that token belongs to. The settings page has an explicit reveal toggle; only when you reveal does it fetch the full key for that account endpoint and token ID. The token list itself still returns masked previews.
- Rotating a channel's token needs no pasted secret — just a different token ID.
- A main-site account's tokens can only build main-site channels; they never leak onto the dedicated line.

## Upgrading from an older version

Older builds stored a single account. After upgrading, it is migrated into the main-site and dedicated-line slots automatically: the old account lands on the **main site**, and the dedicated line starts empty.

If the account area looks empty after upgrading, click **Refresh** once. If it is still empty, the migration did not read the old file — sign in or bind manually once. The old `qingyun-account.json` is read for migration only; all new data goes to `echoflow-account.json`.

## Troubleshooting

**The login window closed but no account appeared.** Click **Sign in to EchoFlow SiHub** again. A transient network fault or a local server restart can interrupt one verification and close the window early; retrying is enough.

**Balance is missing after signing in.** Click **Refresh**. Balance may not have synced right after sign-in; the panel shows "never synced" until it does.

**It says the sign-in has expired.** Click **Sign in to EchoFlow SiHub** to sign in again. If you use manual binding, generate a fresh system access token in the console and use **Update token**.

**The dropdown has no tokens.** This account has no call tokens yet. The console normally provides one; if not, create one and click **Refresh**.

**I want to switch to a third-party provider.** EchoFlow SiHub and third-party providers coexist; switch between them in the model channel list at any time. See [Connect a model](./models.md).

## Related

- [Connect a model](./models.md) — third-party APIs and local models
- [Run your first session](./first-session.md) — the first thing after setting up an account
- [Settings reference](../desktop/settings.md) — the other switches in Model Settings
- [Install, launch, and connection problems](./troubleshooting.md) — what to check when sign-in fails
