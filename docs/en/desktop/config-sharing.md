---
title: Config sharing
nav_title: Config sharing
description: Open and import provider configuration links from trusted sources.
order: 14
---

# Config sharing

EchoFlow Code desktop can open `echoflowcode://` configuration import links from trusted sources. An administrator or service provider creates and distributes the link; the app no longer includes a link generator. Before importing, the app shows a confirmation dialog and skips providers with the same name and base URL rather than overwriting local configuration.

**Config templates share provider connection parameters and model mappings, not API keys.** The compatible `provider/add` format can carry an API key separately; only open links received through trusted channels.

There is one more guard on import: **a provider with the same name and the same base URL is skipped**, so your existing local configuration is never overwritten.

## Opening and importing

The recipient needs the EchoFlow Code desktop app installed and should verify the source, provider names, and endpoints before confirming. Regular config templates leave API keys blank; a `provider/add` link can provide a key for the new provider.

The link creator supplies an optional source label. It appears in the recipient's import preview but is **not a verified identity**. The label is unsigned and cannot prove who created the link.

A link looks like this:

```text
echoflowcode://config/import?v=1&data=eJw...（URL-safe compressed data）
```

`echoflowcode` is the protocol the desktop app registers, `config/import` is the import action, and `data` is the compressed payload — **not** plaintext JSON you can read in an address bar, and not AionUI's `{aionuiConfig}` payload either.

## What importing does

Opening the link on another machine raises a confirmation window listing the providers inside. After confirming:

- Those providers are **added** to that machine's configuration;
- Regular config templates leave **API keys blank**; a compatible `provider/add` link may include a key for the new provider;
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

Regular config templates carry connection parameters and model mappings, not API keys, access tokens, or machine identifiers. The compatible `provider/add` format is separate and can carry an API key for the new provider.

For the full payload fields, validation rules and validity window, see [Deep link protocol](./deep-link-protocol.md).

## Common questions

**It imported but does not work.** Regular config templates leave API keys empty; add your own under Model settings. A compatible `provider/add` link can carry a key.

**One provider did not come through.** You already have a provider with the same name and base URL, so the import skipped it on purpose. To replace it, remove the existing entry first and import again.

**The link will not open, or says it expired.** Links are valid for 30 days — have the sender generate a fresh one. Also check that the two machines do not have obviously different system clocks.

**Can one link contain several providers?** Yes. The `providers` array can contain multiple entries.

## Related

- [Deep link protocol](./deep-link-protocol.md) — link format, payload fields and validation rules
- [Connect a model service](../start/models.md) — API keys and official account login
- [EchoFlow SiHub](../start/account.md) — recommended access and call tokens
