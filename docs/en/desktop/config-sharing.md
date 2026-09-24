---
title: Config sharing
nav_title: Config sharing
description: Package your model provider setup into a shareable link — no API keys included.
order: 14
---

# Config sharing

The config generator packages the providers you set up under Model settings into a single link that someone else can import in one click. Use it to standardize model services across a team, to rebuild an environment on a new machine, or to get a colleague started.

**What it shares is connection parameters and model mappings. It does not include API keys.** That is the thing to understand first — whoever receives the link still has to supply their own key, so nobody is importing a working credential.

There is one more guard on import: **a provider with the same name and the same base URL is skipped**, so your existing local configuration is never overwritten.

## Generating a link

Go to **Settings → Config Generator**.

1. Select the providers you want to share. You can pick more than one.
2. Enter a **source label** (optional). It appears in the recipient's import preview to show who the config came from — it is **not a verified identity**.
3. Generate the link.

A link looks like this:

```text
echoflowcode://config/import?v=1&data=eJw...（URL-safe compressed data）
```

`echoflowcode` is the protocol the desktop app registers, `config/import` is the import action, and `data` is the compressed payload — **not** plaintext JSON you can read in an address bar, and not AionUI's `{aionuiConfig}` payload either.

## What importing does

Opening the link on another machine raises a confirmation window listing the providers inside. After confirming:

- Those providers are **added** to that machine's configuration;
- **API keys are left blank** and have to be filled in locally;
- If a provider with the same name and base URL already exists, **it is skipped** and the local config is left alone.

Import is therefore a safe, additive operation. It will not clobber a working setup.

:::warning
Links are **not signed**. The source label and the timestamp are supplied by whoever created the link, so a link cannot prove that its author is really your team's admin. Only import links from sources you trust — the template contains provider names, endpoints and model mappings, and while it carries no keys, that is still information that can be misused.
:::

## How long a link stays valid

| Item | Value |
|---|---|
| Validity | **30 days** from generation |
| Clock skew tolerated | up to **5 minutes** |
| After expiry | The import side rejects it; generate a new one |

Validation checks the version, the timestamp, required provider fields, the endpoint protocol, and whether any sensitive field has been smuggled in. Failing any of these makes the link unusable.

Machines with badly drifted clocks can fail validation too — if two systems disagree on the time, fix the system clock first.

## What is actually inside

What travels is connection parameters and model mappings — **no API keys, access tokens, or machine identifiers**. That is a deliberate boundary, not an accident of the current format.

For the full payload fields, validation rules and validity window, see [Deep link protocol](./deep-link-protocol.md).

## Common questions

**It imported but does not work.** API keys are never shared, so imported providers arrive with an empty key. Add your own under Model settings.

**One provider did not come through.** You already have a provider with the same name and base URL, so the import skipped it on purpose. To replace it, remove the existing entry first and import again.

**The link will not open, or says it expired.** Links are valid for 30 days — have the sender generate a fresh one. Also check that the two machines do not have obviously different system clocks.

**Can I share several providers at once?** Yes. Select multiple entries when generating; the link carries a `providers` array.

## Related

- [Settings reference](./settings.md) — where Config Generator sits in Settings
- [Deep link protocol](./deep-link-protocol.md) — link format, payload fields and validation rules
- [Connect a model service](../start/models.md) — API keys and official account login
- [EchoFlow account](../start/account.md) — official account and call tokens
