---
description: "Client 会话状态表与 useSessionStatus hook：运行状态、生效的待交互请求、持久化完成提醒和共享的手动阅读标记。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-session-status

[English](README.md) | 中文

## 概述

通过同一张前端状态表显示每个会话的运行状态、优先级最高的待交互请求和完成提醒。观察到的完成提醒保存在浏览器存储中，刷新页面或重启宿主后仍保留，直到主动确认或开始下一次运行。已连接的前端通过宿主内存共享手动阅读标记。阅读标记不改变对话历史或模型请求。

## 目录

- [使用本包](#use-this-package)
- [理解实现](#understand-the-implementation)
- [进一步阅读](#further-exploration)
- [模型体验](#model-experience)
- [已知限制与后续工作](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="use-this-package"></a>
## 使用本包

Web bundle 中唯一的 `ui-session-status` 行同时加载两个面：宿主阅读服务 `ctx.sessionStatus`，以及在 [`dsh-client-ui-session`](../ui-session/README.zh.md) 之后加载、被 Web 前端列为启动必需入口的前端插件。不加载本包的组合没有状态表，也没有 `useSessionStatus` hook；不含 Web bundle 的 profile 不运行阅读服务。本包没有配置项。浏览器完成提醒使用 `dsh.session-completion-unread.v1` 和 `dsh.session-completion-pending-ack.v1` 两个 local storage 键；宿主阅读记录保存在内存中。

通过会话行菜单**标为已读**或**标为未读**，连接同一宿主的前端共享手动标记；操作失败时保留原有提醒并报告失败。观察到从运行转为空闲时产生未读完成提醒。在主视图打开会话后，提醒转为待确认，工作区浏览器以黄色显示。主动确认才清除；窗口聚焦、视图切换、刷新页面和重启宿主都会保留提醒。新一轮运行清除两种完成提醒。已有历史默认已读，除非存在存储的提醒或手动标记。未读提醒不表示任务成功，与运行和待交互状态分别显示。

组件通过根 hook `useSessionStatus` 读取状态表。读取 `ctx.uiSession.sessionStatus` 的前端插件需要在 `inject` 列表中加入 `'uiSession'` 和 `'uiSession.sessionStatus'`；否则 Cordis 会拒绝该属性读取。组件调用 `useSessionStatus` 的插件也注入 `'uiSession.sessionStatus'`，使插件随该 hook 一起卸载和重新加载。该成员声明在 ui-session 的 `UiSessionService`（`ctx.uiSession` 的类型）上；标注为 `UiSession` class 的值看不到它。

| 成员 | 用途 |
|---|---|
| `getSnapshot()` / `subscribe(listener)` | 按会话身份索引的状态；状态事实变化前快照保持同一引用，抛错的 listener 会被报告，不会阻止后续 listener |
| `mark(sessionId, unread)` | 把会话标为已读或未读；阅读状态未同步或宿主拒绝标记时拒绝 |
| `acknowledgeCompletion(sessionId)` | 主动清除观察到的完成提醒；手动未读标记需要宿主确认写入 |
| `readingReady` | 是否已取得当前宿主的阅读基线 |

每个 `SessionStatus` 有五个字段：

| 字段 | 来源 |
|---|---|
| `running` | 宿主会话列表基线和 `api-session/status` 事件；两者都未建立之前为缺省。Subagent 目录行和已保留子会话的 fallback 行不会建立它。 |
| `pendingInteraction` | `ctx.uiSession.pendingInteractions` 为该会话发布的同一个对象。领域插件通过 `ctx.uiSession.registerPendingInteraction(precedence)` 登记请求。 |
| `completionUnread` | 本地观察到的完成尚未在主视图打开，或宿主阅读记录带有手动未读标记 |
| `completionPendingAck` | 主视图打开了观察到的完成，但提醒仍需主动确认 |
| `completionFailed` | 会话未读，且最近完成的轮次以本宿主观察到的执行错误结束 |

宿主面通过 `sessionStatus` Remote 命名空间提供 `mark` 和 `follow`；失败使用 `session-status/not-found` 和 `session-status/unavailable`。前端保存的阅读记录副本是私有的：除 `ctx.uiSession.sessionStatus` 外，没有其他前端服务暴露这些记录。

-----

<a id="understand-the-implementation"></a>
## 理解实现

<details>
<summary>实现细节——点击展开</summary>

阅读记录放在宿主服务的 Map 中，只由 `turn/end` 事件和主动标记更新。每条记录包含 `completedTurn`、`failed`、`readTurn` 和 `manualUnread`。标记不会改变执行结果，也不会触发会话日志刷盘。

前端提交自己已看到的完成轮次。宿主只向前推进 `readTurn`，上限是提交位置与已知完成位置的较小值；自动确认保留 `manualUnread`。主动标为已读或未读按宿主处理顺序清除或设置该标记。冷会话的菜单操作只检查元数据，不打开历史。

只有有序订阅流更新前端记录，修改请求仅回复成功或失败。同步流先发送有权访问的完整快照，再推送完整记录。只有 `ctx.remoteAccess` 允许 `sessionStatus/follow` 时，前端才通过 `ctx.remote.$stream` 和 Gateway 的 `RemoteSnapshotStream` 跟随这些记录，因此 LiveShare 查看者不打开该流，`readingReady` 保持 false；流正常结束时返回带 Gateway `gateway/carrier-lost` code 的错误，因此流会重连，下一个快照替换记录。已有的访问流在授权变化时结束阅读订阅，前端重连后取得新快照。卸载会关闭订阅并清空记录，尚未返回的元数据查询不能再提交标记。

前端插件把会话列表基线、`api-session/status` 事件、ui-session 的待交互请求、本地完成提醒和宿主手动标记汇总为状态表，并以 `uiSession.sessionStatus` 的名字挂在 `ctx.uiSession` 下。主视图保留信号把本地未读提醒转为待确认。前端不安装自动阅读确认。已就绪目录移除其中不存在的会话身份的本地提醒。

</details>

-----

<a id="further-exploration"></a>
## 进一步阅读

- [会话阅读记忆决策](../../../.agents/notes/implemented/feature/2026-10-23-session-reading-memory.zh.md)——包结构、宿主内存归属、并发和暂缓的持久化。
- [会话 UI 适配层](../ui-session/README.zh.md)——上级服务 `ctx.uiSession` 与待交互登记。
- [工作区浏览器](../ui-workspace/README.zh.md)——会话菜单与提醒。

-----

<a id="model-experience"></a>
## 模型体验

无，阅读记录和状态表不添加工具、提示词或会话事件。

#### KV Cache 影响

无；阅读标记和状态表不参与模型请求构建。

## 已知限制与后续工作

<a id="known-limitations-and-deferred-work"></a>

阅读状态有以下运行限制：

- **并发主动标记**——以宿主最后处理的操作为准，不比较版本；延迟的主动已读可能清除较新的手动未读。
- **单个宿主进程**——不同宿主进程或机器之间不互相同步。
- **宿主重启或插件重载**——宿主阅读记录重置，包括手动标记和失败元信息；本地完成提醒仍保留。重启前失败的轮次不保留结果，因此其提醒显示普通完成状态。重载宿主插件会结束所有阅读流；前端重连时如果新服务尚未就绪，会收到终止错误并禁用阅读操作，只有刷新页面后才能恢复。
- **浏览器存储和离线完成**——存储受限或空间不足时，提醒仅保留在内存中。本地完成提醒属于单个浏览器，且需要观察到从运行转为空闲；浏览器断线期间的完成不会建立本地提醒。
- **仅 Web profile**——本包的行位于 Web bundle，不包含该行的 profile 不运行阅读服务。
- **元信息和传输失败**——元信息查询失败不改变阅读状态。流或协议的终态失败会禁用阅读操作，直到刷新页面；普通连接中断会自动重连。
- **已卸载和已归档的会话**——会话从内存卸载后，其记录保留到服务停止；回收记录需要会话删除生命周期。归档行隐藏未读样式和状态，按已读处理，行菜单和快捷键都不提供阅读标记。
- **不提供消息计数或他人的阅读回执**——状态属于宿主的使用者，只记录会话级提醒。LiveShare 查看者不能读取或修改该状态。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者上下文——点击展开</summary>

无。

</details>
