---
title: Privacy and network access
nav_title: Privacy
description: What EchoFlow Code stores locally, when it uses the network, and what to check before removing data.
order: 6
---

# Privacy and network access

EchoFlow Code is a local-first development workbench. Local first does not mean fully offline: account sign-in, model services, MCP, messaging, remote connections, and updates may send the data needed for an operation to the relevant service. Review the destination and its privacy policy before enabling a feature; local storage does not mean that all data stays on the device.

## Data stored locally

The application stores sessions, workspace records, provider configuration, skills, agents, memory, UI settings, and logs on your device. Primary user data lives under `~/.claude`; some desktop state is managed in the operating system's application-data directory. Authentication tokens and API keys are kept locally, but are sent to the selected service when needed to authenticate a request.

## When the application uses the network

Depending on the features you enable, the application may send the following information:

- **Model and OAuth services:** Prompts, attachments, selected code context, tool results, model parameters, and authentication information are sent to the model or account provider you choose.
- **MCP servers and external tools:** Configured MCP servers, search, image generation, and other tools receive the input required to perform the requested operation.
- **Messaging and remote access:** If you enable Telegram, Feishu, WeChat, DingTalk, WhatsApp, or remote H5 access, selected session content, messages, and connection metadata pass through the relevant platform or a relay you configure.
- **Updates:** The application contacts GitHub Releases to check versions and, when requested, download installers.
- **Web links:** Opening documentation, login pages, or other links causes the browser to connect directly to the destination site.
- **Upstream runtime traffic:** The bundled upstream agent runtime may contact diagnostic, analytics, or feature-flag services depending on the provider and configuration. Set `DISABLE_TELEMETRY=1` and `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1` to reduce or disable nonessential traffic.

Each third-party service processes the data it receives under its own privacy policy. Review the provider's terms before use, and do not send secrets, personal information, or private code to a service you do not trust.

## What the project maintainers do not do

The project maintainers do not sell user data or place advertising based on personal data in the application. The maintainers do not receive locally stored sessions or configuration unless you choose to include them in an issue, discussion, log, or security report.

## Removing data

Uninstalling the application does not mean all local data has been removed. Before cleanup, confirm the active configuration directory, run mode, and ownership of the data, and back up the sessions and configuration you need to keep. Other tools may share `~/.claude`; do not delete the whole directory as if it belonged exclusively to EchoFlow Code. Older versions may use compatibility names such as `Claude Code Haha`; inspect their contents and remove only data confirmed to belong to this application. To remove data already sent to a third-party service, follow that provider's process.

## Contact

For privacy or security questions, contact the maintainer through a [private GitHub security advisory](https://github.com/LiuGuangHS/EchoFlow-ClaudeCode/security/advisories/new). Do not send EchoFlow Code private logs or account information to the upstream project's contact addresses.

Last updated: November 10, 2026.
