---
title: Computer Use Swift Helper 设计
nav_title: Swift Helper
description: macOS 原生 helper 的观察、输入、权限与共享桌面边界。
order: 14
---

# Computer Use Swift Helper 设计

macOS 的 Computer Use 由 Swift `cu-helper` 承担原生操作。它把 AX 观察、窗口捕获与目标进程输入放在同一原生边界内；Windows/Linux 使用独立的 agent-desktop 引擎，不套用这套实现。完整调用链见 [Computer Use 架构](computer-use.md)。

## 职责划分

| 边界 | 负责内容 |
| --- | --- |
| TypeScript 宿主 | 平台可用性、全局启用状态、会话锁、取消与原生通道 |
| Swift helper | 进程和窗口校验、AX 树与动作、定向输入、截图 |
| 操作系统 | 辅助功能、屏幕录制、应用焦点与图形会话 |

源码位于 `native/cu-helper/Sources/cu-helper/`。AX 元素定位、窗口坐标、事件工厂和捕获各有自己的契约，不能用一种机制的成功推断其他机制都可用。

## 权限与签名

用户在设置中启用并确认一次 Computer Use，即授权所有受支持应用；不增加逐应用审批、应用名单或权限分层。全局禁用、系统权限和目标有效性检查仍然生效。

macOS 辅助功能与屏幕录制是不同权限。安装包、宿主和 helper 的代码签名与启动方式会影响系统如何识别权限主体。开发二进制运行成功不能代替安装版授权、更新后权限保留和打包链路的验证。

## 不移动指针不等于完全隔离

AX 操作与 `CGEvent.postToPid` 定向输入不需要借用真实指针定位；虚拟光标是视觉反馈，不是第二套硬件鼠标。系统仍共享一个图形会话、焦点和剪贴板，同一应用内的真人操作可能与 Agent 干扰。

目标被遮挡、隐藏、最小化或位于其他 Space 时，捕获新鲜度和输入可达性需要分别判断。无法建立目标或新鲜画面时，不把旧截图或一次投递当成完成证据。验证方式见[验证边界](computer-use-native-manual-qa.md)。
