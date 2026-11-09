---
title: Mobile App
nav_title: Mobile
description: Connect to your computer with the unified Expo and React Native app, continue sessions, handle approvals, and understand H5 support limits.
order: 0
---

# Mobile App

EchoFlow has one iOS / Android app mainline, built with Expo and React Native. It connects to a running EchoFlow Desktop or local service. Your phone displays sessions, handles approvals and questions, submits tasks, and shows results; model execution, project files, and the desktop runtime remain on your computer.

The H5 browser entry shares the same UI and session protocol and is useful for temporary access. Remote browser access still requires a restricted entry configured on the computer and browser pairing. H5 is not a second app: it has no native scanner, push notifications, SecureStore, or OS-level background activities, but it can display and control tasks running on the computer.

## Capabilities and boundaries

The following describes capabilities supported by the current source, not completed builds or device acceptance on every platform.

| Capability | Current scope |
| --- | --- |
| Multiple computers | Each computer has its own address, connection state, credentials, and drafts. A connection must be verified before it is saved. |
| Pairing and connection | Scan, paste connection information, or enter it manually. Redirects and untrusted connection addresses are rejected; remote pairing requires approval on the computer. |
| Sessions and approvals | Reuses desktop session, streaming, recovery, deduplication, tool approval, question, and plan protocols. Late or repeated actions must still pass current-session validation. |
| Files and voice | Image and file selection, sharing, and voice input, with feedback for size, type, cancellation, and permission failures. |
| Notifications and background activity | The native app integrates with system notifications and platform activities. It cannot execute tasks in place of a stopped or sleeping computer. |
| H5 | Hosted at `/m/`. LAN credentials stay within the current browser session, so a refresh may require reconnection. Remote browser pairing uses a Cookie, separate from native app Bearer credentials. |
| iOS / Android | Source and configuration share one Expo build chain. Release, signing, device notification, and background activity status require evidence for the specific version and platform. |

The mobile app is not a local execution engine. API keys, providers, MCP, plugins, project files, and high-risk system settings remain primarily managed on the desktop. Mobile approval actions must be validated against the current computer, session, and request ID.

## Connect from your computer

1. Start EchoFlow Desktop or the local service on your computer.
2. Open the desktop phone connection / H5 access settings and follow the prompts to generate a QR code or pairing link.
3. Make sure the phone can reach the computer. Use its LAN IP locally; for remote access, use HTTPS, a VPN, Tailscale, or the desktop's restricted remote entry.
4. Open the EchoFlow app, scan the QR code or paste the connection information, and confirm the host.
5. Enter the session list after verification succeeds. Remote pairing also requires approving the device on the computer.

`127.0.0.1` and `localhost` in a QR code refer to the phone itself and usually cannot reach your computer from a physical phone. Use the computer's LAN address, VPN address, or HTTPS domain. Do not expose the desktop's primary service port directly to the Internet.

If your phone is lost or credentials may have leaked, revoke the paired device and rotate the relevant credentials on the computer. Disabling LAN H5 or rotating its token is not yet a guarantee that every existing connection and resumable stream immediately loses access. For immediate isolation, stop the relevant service and close the remote entry. A network interruption or sleeping computer does not mean a task completed; check the session state after reconnecting.

## Choose the app or H5

| Need | Entry |
| --- | --- |
| Continue full sessions, approve permissions, and upload material | EchoFlow app |
| Temporary access or a device where installing the app is inconvenient | Desktop-hosted H5 (`/m/`) |
| Quick task submission, reminders, and lightweight approvals | A configured IM adapter |

See [desktop remote access](../desktop/remote.md) for computer-side setup. This page covers user operations and support limits; development, Expo configuration, platform differences, and build commands belong in `mobile/README.md` at the repository root.

## Support status

Code present in the repository, passing offline tests, simulator or device verification, and a store release are different levels of evidence. Available downloads and installable versions depend on actual EchoFlow release artifacts; an unpublished build configuration is not an installation promise. Native builds, notifications, background activities, camera access, and microphone permissions need separate verification on the relevant platform and version.
