---
title: Computer Use 原生协议契约
nav_title: 原生协议
description: macOS JavaScript 会话、AX 元素、窗口事件与显式观察的实现边界。
order: 15
---

# Computer Use 原生协议契约

macOS 原生 Computer Use 把 JavaScript 调度、界面观察与输入投递分开。协议兼容性需要沿实际调用链核对，不能从工具名称相似或一次任务成功推导完整兼容。平台差异与授权入口见 [Computer Use 架构](computer-use.md)。

## JavaScript 与原生边界

持久 JavaScript 会话通过 `cua.getApp()` 绑定目标，并通过宿主转发原生调用。相关入口是 `src/utils/computerUse/replRuntime.ts`、`replWorker.ts`、`replCompiler.ts` 和 `src/vendor/computer-use-mcp/replApi.ts`。脚本中的 App 对象不能绕过全局授权、进程身份、窗口校验或取消。

原生 App 输入与浏览器 Tab/DOM 自动化是不同链路。对浏览器发送原生坐标事件，不代表已经获得 DOM 节点或 Playwright 能力。

## 元素与窗口契约

- AX 元素以带世代的句柄标识，例如 `g17:4`。动作重新核对进程、窗口和元素；陈旧引用应重新观察，而不是猜测当前位置。
- 截图和输入使用同一窗口与坐标变换，不能按窗口标题或截图缩放后的两个独立比例猜测目标。
- 坐标拖拽的事件工厂保留 mouseDown、起点/中点/终点 mouseDragged、mouseUp 的顺序及一致窗口绑定。实现与测试集中在 `AXAction.swift`、`WindowTargetedEvent.swift`、`WindowGeometry.swift` 和 `MouseDragEventTests`。

## 动作不等于观察

脚本可以连续执行已确定的动作，在需要决定下一步时显式读取 AX 状态或截图。图像输出、文本输出与原生状态刷新不能混为一谈；菜单、窗口或界面结构变化后，应重新建立可用的观察基线。

批量执行不是事务。超时、取消、脚本失败或部分投递后，已经发生的副作用不会自动回滚；先观察现状，再决定是否继续，不能自动重放。

## 证据适用范围

worker 的临时目录与模拟原生工具测试证明隔离和协议边界；事件工厂测试证明事件构造。它们不证明所有真实应用、操作系统版本或模型任务的成功率。性能也应区分模型往返、动作、观察和目标实际完成的耗时，见[兼容性评估](computer-use-codex-parity-review.md)。
