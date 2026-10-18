# 宿主从未服务 `llm-qoder` 设置命名空间：卡片开关能渲染、能点，保存必 503

**P1 · 规模 M · 依赖 —（需先与宿主侧确认 `settings.configure()` 的注册契约）**

## 症状

DSH NEXT desktop `2.0.19-next` + `@eghrhegpe/dsh-connect-qoder@0.7.0`，
provider 本身**完全正常**（`qoder-cn/DeepSeek-Flash` 可正常对话、图像、目录刷新都对），
但插件设置里的三个开关**存不住**：

- 打开插件卡片，勾上「**按最大上下文显示**」（`useMaximumContextWindow`）
- 再取消勾选，或换任一开关（图像输入、模型勾选、区域开关）
- 保存失败；若走 `__save`，宿主回 **503**

同时宿主的模型设置页里**没有**本插件的配置行。

区别在于：**这次不是"整行静默消失"**——卡片本体是渲染出来的，复选框可见可点，
保存时才失败。用户看到的是一个"能操作但永远存不下来"的开关。

## 证据

### 1. 客户端侧的启动报错（每次启动各一条，`desktop-next.log`）

```text
[dsh-connect-qoder] the host serves 21 settings namespace(s)
(session-log-deepseek, agent-default-model, llm-pi-ai, pwsh-sandbox, permission,
 subagent, web, web-search-deepseek, web-deepseek-api, agent-loop, llm-deepseek,
 llm-deepseek-account, subagent-model-selection-settings, ui-settings-account,
 ui-theme, locale, ui-settings, ui-settings-general, ui-conversation, ui-chat,
 agent-preset-registry) but none of them is this plugin's
(dsh-connect-qoder / llm-qoder); the card is registering under "dsh-connect-qoder",
which is not served — its settings row will be missing.
```

这 21 个命名空间里**没有** `llm-qoder`，也没有 `dsh-connect-qoder`。
注意这条 `console.error` 本身是**正常工作**的——它正是 `docs/issues/14`
（命名空间四套说法）那一轮补的显式报错，此处如实命中。

### 2. Loader 行存在，命名空间不存在

同一次运行的日志里 `pluginId` 有 `include:llm-qoder`，说明 **Loader 条目建了**、
`apply()` 跑了、provider 注册成功。但 `settings.describe()` 里没有它。

也就是说问题不在"行 id 与字面量漂移"（那是 issue 14 已收敛的部分）：
`cordis.patch.yml` 的行 id 是 `llm-qoder`，`src/client/index.ts` 的 `PROVIDER_NS`
也是 `llm-qoder`，**两侧其实一致**。真正的缺口是**宿主没为这个行创建命名空间**。

### 3. 保存路径必然 503

`src/host/settings-save.ts:199-209`：

```ts
const row = findSettingsRow(rows, candidates)
if (row === undefined) {
  return {
    status: 503,
    body: { error: `${candidates.join('/')} namespace missing from describe(); known: ...` },
  }
}
```

客户端 `src/client/settings-write.ts:135` 把非 404 一律判为 `refused`，
`:232-234` 直接抛出 → 卡片渲染为"保存失败"。**没有任何静默降级**（这点是对的）。

### 4. 为什么开关是"可点"的——`settingsScope` 不为 `undefined`

`src/client/index.ts:162-169`：

```ts
let settingsScope: SettingsScope | undefined
const forms = softGet("configForms")
if (forms !== void 0) settingsScope = forms.get(namespace)
```

`configForms` 服务**存在**（宿主提供），所以 `forms.get("dsh-connect-qoder")`
返回了一个对象，`settingsScope` 因此有值。而保存按钮的禁用条件是
（`lib/client.js:2854`）：

```js
disabled: saving || !dirty || settingsScope === void 0
```

`settingsScope !== undefined` → **按钮可用**。但它指向的是一个
`describe()` 里不存在的命名空间，所以每次保存都必然 503。

**这就是最该修的那一环**：`forms.get(ns)` 对未服务的命名空间返回非 `undefined`，
使"只读降级"分支（`src/client/index.ts:171-172` 明确写了
"A host without the surface gets a read-only card"）**永远走不到**。

### 5. 影响面（实测）

`useMaximumContextWindow` 在 UI 上**完全无法设置**。Qoder 目录为多数模型声明
`contextOption[200000, 400000, 1000000]`，默认 200K；拿不到这个开关就只能停在 200K。

已验证的绕法（**当前建议写进 README**）：在 profile 的 patch 层声明式写入，
等价且不需要设置服务：

```yaml
- id: llm-qoder
  config:
    useMaximumContextWindow: true
```

实测生效：会话投影的 `contextPressure.contextWindow` 从 `200000` 变为
`1000000`，且经 `loader/volatile-update` **热生效、无需重启**。
（这也反证 `Config` schema 与 volatile 机制本身是通的——缺的只有命名空间注册。）

## 根因（待确认的部分已标出）

`src/host/index.ts:1280-1294` 通过动态注入完成发布：

```ts
ctx.inject(['settings'], (settingsCtx: HostContext) => {
  const settings = injected(settingsCtx.settings, 'settings')
  try {
    if (typeof settings.configure === 'function') {
      settings.configure({ auto: true }, ctx.fiber)
    } else {
      ctx.logger.warn?.('… settings service has no configure(); …')
    }
  } catch (error) { … }
})
```

这条路径上**没有 warning 也没有 throw**（日志里只有上面那条 client 侧的
namespace 报错），所以 `configure()` 大概率是被调用了的，但**没有产生命名空间行**。

两种可能，需要一条探针区分：

1. **`configure()` 在 0.2 线不再负责建行**——命名空间由 Loader 依据插件的
   `Config` schema 推导，而本插件的 `Config` 导出没有被 Loader 认到
   （插件 `package.json` 的 `dsh` 字段只声明了 `bundle.patch` 与 `client`，
   没有 schema/settings 声明）。
2. `configure()` 需要配合静态 `inject` 声明才被登记——本插件
   `export const inject = ['llm']`（`src/host/index.ts:87`），`settings` 是
   运行时 `ctx.inject` 注入的，可能晚于登记时机。

对照：同时装的 `dsh-workbuddy-connect` 在同一台机器上报的是
`host settings service has no installSection API; per-variant settings and the
maximum-context preference are unavailable`——**它的做法是"拿不到就明说不可用"**，
本插件则因为 `forms.get()` 有返回值而误判为可用。这个对照值得在修法里复用。

## 修法

分两半，**客户端这一半不依赖宿主结论，可以立刻做**。

### A. 客户端：把"命名空间真的被服务"作为可写的判据（必做）

不要用 `forms.get(ns) !== undefined` 判可写，改用
`describe()` 的 `namespaces` 是否**精确命中**：

```ts
const served = forms.describe().getSnapshot().view?.namespaces ?? []
const servedHere = served.find((e) => e.ns === namespace)
// 只读降级：没命中就不注入 settingsScope
if (servedHere !== undefined) settingsScope = forms.get(namespace)
```

这样上述 4 条路径会自然收敛：`settingsScope === undefined` →
保存按钮禁用（`client.js:2854` 现有条件即生效）→ 卡片走既有的只读分支。

同时把只读原因写进卡片文案（现在只读卡片**不解释为什么**）：新增
`row.settingsUnavailable`，{reason} 逐字带出宿主 `describe()` 的命名空间清单
摘要，复用 `docs/issues/08` 那个 `reason` 永不为空的规矩。

### B. 宿主侧：确认 `configure()` 的注册契约（阻塞项）

在 `settings.configure()` 之后**读回校验**，与 `settings-save.ts` 的
read-back 纪律一致：

```ts
settings.configure({ auto: true }, ctx.fiber)
const served = /* settings.describe() */
if (!served.some((e) => String(e.ns) === settingsNs)) {
  ctx.logger.warn?.(`dsh-connect-qoder: settings.configure() did not create "${settingsNs}"; card is read-only. served: …`)
}
```

这条 warn 的价值在于：它把"配置面不可用"从**只在浏览器控制台可见**
（现在是 `console.error`，宿主日志里没有）搬到宿主日志——运维看日志就能定位。

再据 A 的结论决定是否需要补 `package.json` 的 schema 声明。

### C. 文档：把声明式写法写进 README

`useMaximumContextWindow` / `enabledModelIds` / `imageOverrides` 三者都能用
patch 层表达。README 应给出这段 YAML 并说明"设置服务不可用时的等价写法"，
否则用户在 0.2 线宿主机上没有第二条路。

## 验收标准

- [ ] 新用例：`describe()` 返回的 `namespaces` 里**没有**本插件时，
      `initialEditableState` / 卡片的 `settingsScope` 为 `undefined`，
      保存按钮 `disabled`。（现成的 `test/controller.test.js` +
      `test/card-dom.test.js` 可承载，后者已在用 `useMaximumContextWindow: false`
      的 fixture，加一条"命名空间缺失"变体即可）
- [ ] 新用例：`__save` 在 `findSettingsRow` 返回 `undefined` 时仍是 503，
      **且**该 503 在卡片上渲染为失败而不是静默通过——守
      `docs/issues/06`（假"已保存"）不被这条路径绕过。
- [ ] `settings.configure()` 后读回校验的 warn 有断言（可用
      `test/publish-regions.test.js` 同款注入接缝，把 `describe()` 造成空）。
- [ ] README 出现 patch 层声明式写法，且
      `test/docs-facts.test.js` 不因新增段落变红。
- [ ] **变异验证**：把 A 的判据改回 `forms.get(ns) !== undefined`，
      上面第一条必须变红。

## 本条与 `docs/issues/14` 的边界

14 收的是"同一个命名空间有四套拼法、失配时整行静默消失"，做法是**收敛拼法
+ 失配显式报错**。那部分**确实已修**：本次启动的 `console.error` 就是它的产物，
拼法也已经两侧一致。

本条不重复它。本条是**下一层**：拼法一致了、报错也响了，可宿主**根本没有
创建**这个命名空间。14 的验收标准里"仓库里只剩一处命名空间推导"一条至今
标 `[ ]`（跨 bundle 不可共享，已登记为不可行），与此无关。

需要 14 的报错文本作为诊断入口保留——不要因为本条把那条 `console.error` 删掉。

---

## 附：一条相关但不构成独立 issue 的观察（未定级）

同一次运行的日志里出现过：

```text
[warn] step compaction failed: no adapter registered for provider "dsh-provider-qoder";
       continuing the turn
```

**触发条件已查明**：那是 `dsh-provider-qoder` 被卸载后，另一个会话
（`session-f151b80e`）的 `modelSelection.pending` 里仍残留
`{ provider: "dsh-provider-qoder", model: "performance" }` 所致，
**不是 `qoder-cn` 的问题**，属卸载时的残留 pending 值。

但顺着查出一件值得记下的事实：**本插件源码里完全没有 compaction 相关代码**
（`src/` 与 `lib/` 全量匹配 `compaction` 零命中），而宿主的
`basic-compaction-engine` 是**按 provider 注册适配器**的。所以第三方 provider
（`qoder-cn`）上的自动压缩是否可用，取决于宿主是否为非内置 provider 提供
默认适配器——**这一点本条没有验证**。

若后续要用长会话，这比命名空间更值得先探一次：用一个 `qoder-cn` 会话把
上下文压到触发阈值，看是否出现同一条 `no adapter registered`。
在此之前，长会话请按"不会自动瘦身"对待，主动开新会话。
