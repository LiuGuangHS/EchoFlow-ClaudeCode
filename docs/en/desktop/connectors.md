---
title: Connectors
nav_title: Connectors
description: Bring Feishu, Notion, GitHub and similar services in, so the agent can read and write your data there.
order: 7
---

# Connectors

A connector lets the agent work directly with data in a third-party service — read a document, inspect a repository, pull a table. It is the entry point for wiring an external service into a session, not a separate concept.

The entry point is **Skills · Connectors** in the sidebar. It holds two collections:

- **Service connectors** — account-authorized services that are themselves the data source: Tencent Docs, Notion, GitHub, Airtable. **54** are listed today.
- **Tool plugins** — packs that give the agent a method or a specialized skill, such as drawing architecture diagrams or exporting PDFs.

Filter by collection, by region (China / global), or by category, or just search.

## Connectors versus skills

The two entry points sit next to each other and are the easiest thing here to confuse, so it is worth stating up front:

| | Connector | Skill |
|---|---|---|
| What it is | A channel to an external service | A ready-made method or process |
| Prerequisite | **Account authorization is required** | Installing is enough |
| When unconfigured | The capability is **not attached to any session** | Usable immediately |

The one-line version: **a connector opens a door; a skill hands over a manual.** Skills themselves are covered in [Skills and the skill market](./skills.md).

A few services sit on both sides: Feishu, DingTalk, WeCom, WeChat, QQ, Slack, Telegram and WhatsApp are **service connectors** here, and are also **IM adapters** (the ones you chat with from your phone). To use them from a chat app, see [IM integrations](../im/index.md); to read and write their data inside a session, use the connector.

## Installing and authorizing

Find the service under Skills · Connectors and click **Connect service**, then complete authorization in your browser.

One constraint matters: **until authorization completes, the capability is not attached to any session.** That is deliberate — installed but unconnected means the model cannot see or call it, so you never get the "I thought it was connected" state. Such entries are marked **service not connected** in the list.

Tool plugins take a different path: they need no external account, and after installing you click **Save and verify** to actually load the skill pack.

## Referencing them in a session

Both `@` and `/` reference plugins and skills.

Installing and connecting a connector **while a session is open refreshes that session's skills and tools immediately** — no app restart, no new session. Conversely, if a reference resolves inside a session but the list outside says it is unconnected, go back and confirm the authorization actually finished.

## Managing and removing

Install, deactivate and remove all live in the same place.

- **Deactivate** — keeps the installation; it simply stops being attached to sessions.
- **Remove** — drops the entry. For a tool plugin this also deletes its skill files, but **existing tasks and output files are unaffected**.

A service connector's credentials belong to that service; removing the entry does not revoke authorization on the other side. To truly disconnect, cancel it in that service's account settings.

## Troubleshooting

**Icons are missing.** Packaged builds once failed to load connector and skill icons; fixed in 0.5.5. Upgrade if you are still on an older build.

**Install hangs and never finishes.** 0.5.6 fixed stale state blocking installs. Remove the entry and install it again.

**The skill shows as loaded but the task fails.** Loaded only means the skill pack arrived. Any Node.js, command-line tool, or other runtime the task needs must still be satisfied separately — **a loaded skill does not mean those runtimes are installed**.

**Authorization expired.** Go back to the connector entry and authorize again. Credentials last as long as the service says they do.

## Related

- [Skills and the skill market](./skills.md) — what a skill is and how it differs from an agent
- [IM integrations](../im/index.md) — chat from Feishu, WeChat, Telegram
- [Subagents and task splitting](./agents.md) — who does the work
- [Settings reference](./settings.md) — where the plugin switches live
