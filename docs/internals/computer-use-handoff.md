---
title: Computer Use 源码导航
nav_title: 源码导航
description: 从设置、工具注册、会话传输到各平台原生引擎定位 Computer Use 的源码入口。
order: 19
---

# Computer Use 源码导航

阅读 Computer Use 源码时，先确认平台和失败边界，再沿同一调用链定位。工具可注册、运行组件可用、输入已投递与目标已完成是不同状态。产品与平台总览见 [Computer Use 架构](computer-use.md)。

## 从入口走到原生引擎

| 问题 | 源码入口 |
| --- | --- |
| 设置显示什么状态、如何启用 | `desktop/src/pages/ComputerUseSettings.tsx`、`src/server/api/computer-use.ts` |
| 平台与二进制是否可用 | `src/utils/computerUse/setup.ts`、`common.ts`、`gates.ts` |
| 哪个会话持锁、如何取消 | `src/vendor/computer-use-mcp/mcpServer.ts`、`src/utils/computerUse/wrapper.tsx` |
| macOS JavaScript 调度 | `src/utils/computerUse/replRuntime.ts`、`src/vendor/computer-use-mcp/replApi.ts` |
| macOS 原生观察与输入 | `native/cu-helper/Sources/cu-helper/` |
| Windows/Linux 命令与传输 | `src/vendor/computer-use-mcp/agentDesktopTools.ts`、`src/utils/computerUse/agentDesktopBridge.ts` |
| Windows/Linux 原生实现 | `native/agent-desktop/` |

## 排查时保留边界

用户在设置中启用并确认一次，即授权所有受支持应用。排查权限时区分全局开关、操作系统权限和目标有效性，不引入逐应用审批或应用类别权限。

macOS helper 与 Windows/Linux 引擎有不同的目标引用和输入机制。先检查所选引擎、会话身份和观察结果，不把失败静默转到另一条执行链重放。

## 修改后的证据

参数、状态、取消和协议改动用临时目录、模拟 runner 或 loopback transport 验证。焦点、TCC、多屏、Space 和实际输入交付需要单独的真机证据。不要用真实用户配置或 provider 作为确定性测试夹具。

继续阅读：[原生协议](computer-use-codex-impl-blueprint.md) · [窗口输入](computer-use-cef-injection.md) · [验证边界](computer-use-native-manual-qa.md)。
