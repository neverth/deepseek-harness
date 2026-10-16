---
description: "面向用户与维护者的首消息 LLM（大语言模型）会话标题提供方说明，用于选择标题策略或排查自动标题生成。"
kind: "package-reference"
---

# @deepseek-ai/dsh-session-title-first-prompt-llm

[English](README.md) | 中文

## 概述

`dsh-session-title-first-prompt-llm` 作为可选的 `ctx.sessionTitle` 提供方，通过 `ctx.llm` 为根会话生成标题。它注册 `first-prompt` 节奏：第一条符合条件的用户消息为会话生成标题，此后每第三条消息依据最近的对话重新生成，并把结果归因于它读取的 seq。自动失败会保留回退，由下一次到期的刷新或显式 `ctx.sessionTitle.refresh()` 重试。它拥有自己的系统指令、JSON 封装与输出解析；只与全消息提供方共享 `dsh-session-title-llm` 的[执行模块](../session-title-llm/README.zh.md)。自动行为与配置优先；实现是建立在该执行器之上的小型提供方策略。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步探索](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与延期工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

当会话应从第一条符合条件用户消息生成标题、并随对话推进重新生成时，在标题服务旁挂载此插件。它要求自己的 `targetWords` 与 `targetCjkCharacters`，外加共享的[执行控制](../session-title-llm/README.zh.md#configuration)，且全部无默认值。

### 标题生成时机

自动生成只对无父会话运行：在其第一条符合条件用户消息之后，创建回退并发出一次辅助请求，用该消息生成标题；此后每三条符合条件的用户消息，用最近的若干条消息重新生成标题。显式用户重命名与继承的 fork 历史都不会触发调用。自动失败会保留当前标题，直到下一次到期的刷新或显式 `ctx.sessionTitle.refresh()`。fork 会保留继承的标题，绝不会自动运行此提供方，即使其预置的首消息来自父会话。

### 配置

插件要求 `targetWords` 与 `targetCjkCharacters`，外加共享的[执行控制](../session-title-llm/README.zh.md#configuration)：`maxInputBytes`、`maxOutputTokens`、`timeoutMs`，以及可选成对的 `provider`/`model` 路由。同时省略二者，会继承当前已记录主请求的确切路由；同时设置二者，则让标题生成使用独立路由。生成的[配置目录](../../../docs/config-catalog.zh.md#deepseek-aidsh-session-title-first-prompt-llm)是每个受支持字段的穷尽式真源。

### 失败与恢复

失败的生成——主请求之前缺少路由、输入超过 `maxInputBytes`、超时、取消或无效模型输出——会发出警告并保留当前标题；下一次到期的刷新或显式 `refresh()` 会重试。自动工作不会为主 agent（智能体）请求增加 token 或延迟。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

本节解释插件形态；可观察行为已在[使用本包](#use-this-package)中完整说明。

### 设计理念

一个小型提供方策略：它为一次调用覆盖的消息构建系统指令与 JSON 输入——初始生成时仅首消息，否则是一段尾部窗口加上当前提供方标题——把组装后的响应解析为标题，只把路由、上限、取消、记录与组装委托给[共享执行模块](../session-title-llm/README.zh.md)。

### 源码地图

| 文件 | 职责 |
|---|---|
| [`src/index.ts`](src/index.ts) | 插件入口：配置 schema、提示词与封装、输出解析与直接提供方注册 |

### 调度

标题服务负责调度自动工作：对 `first-prompt` 节奏，在根会话的第一条符合条件消息上、以及此后每第三条消息上启动修订；提供方调用在确切主请求路由被记录后才开始，较新的修订会取代旧工作。

</details>

-----

<a id="further-exploration"></a>
## 进一步探索

当提供方约定不够用时阅读以下页面。它们从共享执行模块逐步进入替代节奏与它所插入的服务。

- [共享 LLM 执行模块](../session-title-llm/README.zh.md)——此提供方使用的执行模块。
- [全消息标题提供方](../../experimental/session-title-all-prompts-llm/README.zh.md)——在每条新提示词后重新生成标题的节奏。
- [会话标题服务](../session-title/README.zh.md)——回退行为、重命名、刷新与提供方注册。
- [会话包映射](../README.zh.md)——相邻的持久化、投影、标题与遥测包。

-----

<a id="model-experience"></a>
## 模型体验

### 自动标题请求

#### 模型看到什么

标题模型会收到此提供方的标题指令，以及一个包含本次调用所覆盖用户消息的 JSON 数组：初始生成时只有第一条符合条件消息，否则是最近三条。刷新时还会以 JSON 对象形式收到当前提供方标题作为 `currentTitle`，并附带一条稳定性规则，要求它在仍然描述会话时保持不变。继承的 fork 历史不会触发再次自动调用。

#### Token 影响

根会话先自动发出一次辅助请求，此后每三条符合条件的用户消息再发出一次，均受 `maxInputBytes` 与 `maxOutputTokens` 约束；显式刷新可能发出额外调用。它选择路由支持的最低推理强度；路由没有可选强度时不指定。主 agent 请求不会增加 token。

#### KV Cache 影响

不会使主请求的 KV Cache 失效。辅助请求使用已配置或已记录路由，其缓存行为由提供方决定。

## 已知限制与延期工作

<a id="known-limitations-and-deferred-work"></a>


这些限制说明此提供方何时不再代表会话。它们是当前包约束。

- **刷新间隔固定**——会话只在此后每第三条符合条件的用户消息上重新生成标题，因此更早变化的主题会保留此前标题直到间隔到来；若每条提示词都应重新生成标题，请使用全消息提供方。
- **fork 绝不自动重新生成标题**——fork 会保留继承的标题，绝不会自动运行此提供方，即使其预置的首消息来自父会话。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者的工作上下文——点击展开</summary>

无。

</details>
