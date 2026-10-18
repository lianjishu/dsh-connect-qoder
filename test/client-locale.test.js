/**
 * Guard the card's copy against the failure that actually shipped in 0.4.3.
 *
 * Run: node --test test/client-locale.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * In 0.4.3 the client registered its translation table under the literal
 * `"settings.qoder"` — a namespace the HOST has never served. The host's own
 * namespace resolution (`settingsNamespaceOf` in src/host/settings-save.ts)
 * keys off the Loader entry, falling back to `dsh-connect-qoder`; on 0.1.7 it
 * is the provider name `llm-qoder`. None of those is `settings.qoder`.
 *
 * When `locale.bind(ns)` cannot find a table for `ns`, it does not throw — it
 * returns the key it was asked for. So the card rendered `account.reload`,
 * `usage.checkin` and the rest as literal dotted identifiers. Two things made
 * that hard to see:
 *
 *   1. A key-echo looks identical to a MISSING TRANSLATION, in every locale.
 *      The report that arrived was "there is no English translation", which
 *      points at the copy tables — and those were complete and correct all
 *      along. 192 keys, both languages. Nothing was wrong with them.
 *   2. No test touched `locale.register` at all. `grep locale test/` was
 *      empty, so the whole registration path was unguarded.
 *
 * WHAT THIS FILE PINS
 *
 * The two namespaces must be ONE value. Not "the client's namespace is
 * `dsh-connect-qoder`" — that would just re-hardcode a constant that the host
 * is allowed to change. It asserts the invariant that was violated: whatever
 * namespace the client registers copy under is the same namespace it resolves
 * the settings scope with, and it is derived from what the host serves rather
 * than from a literal.
 *
 * It drives the REAL shipped bundle, not a transcription: the module factory is
 * extracted and evaluated with a stub `ctx` that records what was registered.
 * That is what makes it a guard — reintroducing the literal turns it red.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const BUNDLE = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/**
 * The namespace the host serves in this checkout.
 *
 * Read from the source rather than duplicated, so a future change to the
 * host's own constant cannot silently desync this test from reality.
 */
const HOST_NAMESPACE = /export const QODER_SETTINGS_NS = '([^']+)'/
  .exec(readFileSync(join(root, 'src', 'host', 'index.ts'), 'utf8'))?.[1]

assert.ok(
  HOST_NAMESPACE !== undefined,
  'could not read QODER_SETTINGS_NS from src/host/index.ts — this test keys on it',
)

/**
 * Drive the card's module factory with a stub client context.
 *
 * `configForms.describe()` answers with the namespace list the real host would
 * serve. Everything the card touches at load time is stubbed; the card body is
 * never rendered, only `apply()` is run.
 */
function loadClient({ servedNamespace, servedNamespaces, captureSlots = false, mutable = false }) {
  const registered = []
  const bound = []
  const describeCalls = []
  const logged = []
  const slots = []

  // `servedNamespaces` drives the multi-namespace case (a host serving rows that
  // are none of ours); `servedNamespace` keeps the single-row cases terse, and
  // `null` still means "the host serves nothing at all".
  //
  // `mutable` makes the list assignable through the returned handle, so a test
  // can model the real sequence: the first read happens at client boot (before
  // this plugin's Loader row has activated), a later read sees it. That timing
  // is the defect the "grows after boot" test below exists to pin.
  let namespaceList = servedNamespaces !== undefined
    ? servedNamespaces.map((ns) => ({ ns }))
    : servedNamespace === null ? [] : [{ ns: servedNamespace }]

  const realError = console.error
  console.error = (...args) => { logged.push(args.map(String).join(' ')) }

  const forms = {
    // The real `describe()` returns a snapshot STORE: `getSnapshot()` is read
    // fresh on every call, which is what lets a caller see a later answer.
    // Returning the same object here would make the mirror look frozen and
    // would hide exactly the bug this is modelling.
    describe: () => {
      describeCalls.push(true)
      return { getSnapshot: () => ({ view: { namespaces: namespaceList } }) }
    },
    get: (ns) => ({ __scopeFor: ns }),
  }
  /** Replace what the host serves, as a later mirror read would observe. */
  const setServed = (names) => {
    namespaceList = names === null ? [] : names.map((ns) => ({ ns }))
  }

  const ctx = {
    effect: (fn) => fn(),
    get: (name) => {
      if (name === 'configForms') return forms
      return undefined
    },
    locale: {
      register: (ns, table) => {
        registered.push({ ns, table })
      },
      bind: (ns) => {
        bound.push(ns)
        return (key) => key
      },
    },
    slots: {
      // `inject(slotName, callback)` runs the callback to obtain a registration;
      // the card's `registerCard` calls `ctx.slots.register({ …, inject }, Card)`.
      //
      // The registration's `inject` FACE is captured as a thunk rather than
      // called here. That is the whole point: the real renderer evaluates it
      // lazily at mount (`runInject`/`cachedRootInject` in
      // dsh-client-ui-renderer), so calling it at registration time would make
      // the test observe the boot-time answer and would fail to model the bug
      // where a namespace only appears after boot. Each captured `inject` is
      // therefore a zero-argument function the test calls when it means "mount".
      inject: (slotName, callback) => {
        if (captureSlots) {
          const registerWith = {
            register: (slot) => {
              slots.push({ slotName, inject: () => (typeof slot.inject === 'function' ? slot.inject() : slot.inject) })
              return undefined
            },
            inject: () => undefined,
          }
          // The bundle calls `ctx.slots.register(...)` directly, not through a
          // returned registrar, so route the capture through this object.
          return callback()
        }
        return undefined
      },
      register: (slot) => {
        if (captureSlots) slots.push({ slotName: slot.name, inject: () => (typeof slot.inject === 'function' ? slot.inject() : slot.inject) })
        return undefined
      },
    },
  }

  // The bundle is a browser build: it calls `window.__ModuleLoader__.load`
  // with `{ id, factory }`. Capture the entry instead of executing it.
  let entry
  const window = {
    __ModuleLoader__: { load: (mod) => { entry = mod } },
  }

  // `apply()` installs the card's stylesheet before it registers anything, and
  // that reaches for `document`. Only three members are needed, and the style
  // tag's contents are irrelevant here — so this stays a stub rather than a DOM
  // implementation. It must swallow the append silently: `apply` wraps its body
  // in a try/catch, so a throwing stub would make this test pass vacuously by
  // taking the "card failed to load" path.
  const document = {
    querySelector: () => null,
    createElement: () => ({ dataset: {}, textContent: '' }),
    head: { appendChild: () => undefined },
  }

  const sandbox = { window, document, console }
  const names = Object.keys(sandbox)
  new Function(...names, `${BUNDLE}\n;`)(...names.map((n) => sandbox[n]))

  assert.ok(entry !== undefined, 'the bundle did not call window.__ModuleLoader__.load')
  assert.equal(typeof entry.factory, 'function', 'the loader entry carries no factory')

  // `react` and `react/jsx-runtime` are externals the host supplies. The card
  // body is never rendered here, so the stubs only need to satisfy the
  // module-scope destructuring.
  const require = (name) => {
    if (name === 'react') return { useState: () => [], useEffect: () => {}, useRef: () => ({ current: undefined }), useMemo: (f) => f(), useCallback: (f) => f, Fragment: Symbol('Fragment') }
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null, Fragment: Symbol('Fragment') }
    throw new Error(`unexpected require("${name}") from the client bundle`)
  }
  const app = entry.factory(require)

  assert.equal(typeof app?.apply, 'function', 'the bundle exposes no apply()')
  try {
    app.apply(ctx)
  } finally {
    console.error = realError
  }

  return { registered, bound, describeCalls, logged, slots, setServed }
}

test('a host serving rows, none of them ours, is named instead of silently taken over', () => {
  // The Loader-less case this fallback is written for is an EMPTY namespace
  // list, and that one is genuinely fine. A host that serves other rows while
  // ours is missing is a different thing: the id moved, and the card is about
  // to register copy and a settings scope under a namespace nobody serves —
  // so the settings row is simply absent, with nothing in the UI to explain it.
  //
  // That is a silent failure by construction, so it gets said out loud. The
  // point of the message is that the fix is a one-value edit: cordis.patch.yml's
  // row id, plus the two literals that were written against it.
  const { registered, logged } = loadClient({
    servedNamespaces: ['llm-somebody-else', 'dsh-another-plugin'],
  })

  assert.equal(registered.length, 1, 'it still registers — degraded, not broken')
  assert.equal(registered[0].ns, 'dsh-connect-qoder', 'falling back to our own name is the safe move')
  assert.ok(
    logged.some((line) => /none of them is this plugin/.test(line) && /llm-somebody-else/.test(line)),
    `the mismatch must be named in the console; got ${JSON.stringify(logged)}`,
  )
})

test('a host that serves nothing is NOT reported as a mismatch', () => {
  // The Loader-less case: an empty list is a normal host, not an anomaly, and
  // logging on every such host would be noise that trains people to ignore it.
  const { registered, logged } = loadClient({ servedNamespace: null })
  assert.equal(registered[0].ns, 'dsh-connect-qoder')
  assert.deepEqual(logged, [], 'an empty namespace list is expected, not worth reporting')
})

test('the copy is registered under the namespace the host actually serves', () => {
  const { registered, bound } = loadClient({ servedNamespace: HOST_NAMESPACE })

  assert.equal(registered.length, 1, 'expected exactly one locale.register call')
  assert.equal(
    registered[0].ns,
    HOST_NAMESPACE,
    `copy registered under "${registered[0].ns}" but the host serves "${HOST_NAMESPACE}" — ` +
      'a namespace that is not served makes locale.bind echo every key, so the card ' +
      'renders raw identifiers in BOTH languages',
  )
  assert.deepEqual(bound, [HOST_NAMESPACE], 'the card must bind the namespace it registered')
})

test('the locale namespace follows the host, not a hardcoded literal', () => {
  // The 0.1.7 line derives the namespace from the Loader entry, so the served
  // value can differ from the fallback. The client must follow it.
  const { registered, bound } = loadClient({ servedNamespace: 'llm-qoder' })

  assert.equal(registered[0].ns, 'llm-qoder', 'the client ignored what the host serves')
  assert.deepEqual(bound, ['llm-qoder'])
})

test('a host that serves nothing still yields a usable namespace', () => {
  // `configForms` present but with no namespaces listed: the plugin must fall
  // back to its own name rather than registering under `undefined`, which
  // would make the tables unreachable AND look like a typo.
  const { registered, bound } = loadClient({ servedNamespace: null })

  assert.equal(registered[0].ns, 'dsh-connect-qoder')
  assert.deepEqual(bound, ['dsh-connect-qoder'])
})

/**
 * The writable-scope gate, which used to be `forms.get(ns) !== undefined`.
 *
 * `forms.get()` answers an object for ANY namespace name — including one the
 * host never created — so that test could not distinguish "served" from
 * "asked for". The card therefore offered live controls whose every save the
 * host refused (its `__save` finds no row in `describe()` and answers 503):
 * a switch that renders, toggles, and never lands.
 *
 * These two cases pin the gate to `describe()`, which is the list the host
 * actually serves from.
 */
test('a namespace the host does not serve leaves the card read-only', () => {
  const { slots } = loadClient({
    // The host is up and serving rows — just not ours. This is the real
    // DSH NEXT 2.0.19 shape: 21 namespaces, none named `llm-qoder`.
    servedNamespaces: ['llm-pi-ai', 'agent-loop', 'ui-chat'],
    captureSlots: true,
  })

  const withScope = slots.filter((s) => s.inject().settingsScope !== undefined)
  assert.deepEqual(
    withScope.map((s) => s.slotName),
    [],
    'the card was handed a settings scope for a namespace the host does not serve — ' +
      'every save through it is refused with 503, so the controls must stay read-only',
  )

  const withCopy = slots.filter((s) => s.inject().t !== undefined)
  assert.ok(withCopy.length > 0, 'the card must still register (degraded, not broken)')
})

test('a served namespace does hand the card its settings scope', () => {
  // The other direction, or the gate above could be satisfied by never
  // granting a scope at all — which would make the card permanently read-only.
  const { slots } = loadClient({ servedNamespace: HOST_NAMESPACE, captureSlots: true })

  const withScope = slots.filter((s) => s.inject().settingsScope !== undefined)
  assert.ok(
    withScope.length > 0,
    `no slot received a settingsScope even though "${HOST_NAMESPACE}" is served; got ${JSON.stringify(slots.map((s) => s.slotName))}`,
  )
})

/**
 * The defect that made every cold start report a missing namespace.
 *
 * `describe()` is a client mirror filled asynchronously from
 * `remote.settings.describe()`. This bundle is LAST in `dsh.profile.bundles`,
 * so the answer read during `apply()` is the snapshot the earlier bundles
 * loaded — all of the host's own namespaces, and not yet this plugin's row,
 * whose Loader entry has not finished activating.
 *
 * Pinning `settingsScope` from that first read left the card read-only for the
 * whole session even though the row appeared moments later. The fix resolves
 * the scope inside the slot's `inject` face, which the renderer evaluates
 * lazily at mount time.
 *
 * This test models the real order of events:
 *   1. boot: the mirror knows only the host's rows      -> apply() runs here
 *   2. the row activates; the next mirror read sees it  -> the card mounts here
 * and asserts the card is writable at mount, which is when it matters.
 */
test('a namespace that appears after boot still makes the card writable', () => {
  // Boot: exactly the shape the 21-namespace console error described.
  const { slots, setServed, logged } = loadClient({
    servedNamespaces: ['llm-pi-ai', 'agent-loop', 'ui-chat'],
    captureSlots: true,
    mutable: true,
  })

  // The deferred "standing anomaly" check must not have fired for this: the
  // absence at boot is a timing artifact, not a drifted Loader row id. The
  // timers are scheduled but the test never advances them, which mirrors a
  // mount that happens well before any such delay.
  assert.equal(slots.length > 0, true, 'the card never registered')

  // The row activates; the mirror re-reads and now lists our namespace.
  setServed([...['llm-pi-ai', 'agent-loop', 'ui-chat'], HOST_NAMESPACE])

  // Mount time: the slot's `inject` face is evaluated NOW, not at boot.
  const injectedAtMount = slots
    .filter((s) => s.slotName === 'plugins.bundle.config')
    .map((s) => s.inject())

  assert.ok(injectedAtMount.length > 0, 'the bundle config slot was never registered')
  const writable = injectedAtMount.filter((face) => face?.settingsScope !== undefined)
  assert.ok(
    writable.length > 0,
    'the card resolved its scope at boot and cached the read-only answer: a namespace ' +
      'that only appears after this plugin’s Loader row activates must still make the ' +
      'card writable, or every user sees a permanently read-only card on a host that ' +
      'serves the namespace perfectly well',
  )
})

test('the read-only card is still read-only when the namespace never appears', () => {
  // The other half of the same contract: deferring the resolution must not turn
  // the gate into "always writable". This is the shape that must stay refused —
  // resolves at mount, finds nothing, degrades.
  const { slots, setServed } = loadClient({
    servedNamespaces: ['llm-pi-ai', 'agent-loop', 'ui-chat'],
    captureSlots: true,
    mutable: true,
  })
  setServed(['llm-pi-ai', 'agent-loop', 'ui-chat']) // unchanged: still not ours

  const injectedAtMount = slots
    .filter((s) => s.slotName === 'plugins.bundle.config')
    .map((s) => s.inject())
  const writable = injectedAtMount.filter((face) => face?.settingsScope !== undefined)
  assert.deepEqual(
    writable,
    [],
    'a namespace the host does not serve must not hand the card a writable scope — ' +
      'every save through it would be refused with 503',
  )
  assert.ok(
    injectedAtMount.every((face) => typeof face?.t === 'function'),
    'the card must still register with its translation function (degraded, not broken)',
  )
})

test('every key the card can ask for is present, in both languages', () => {
  const { registered } = loadClient({ servedNamespace: HOST_NAMESPACE })
  const { zh, en } = registered[0].table

  assert.equal(typeof zh, 'object', 'no zh table was registered')
  assert.equal(typeof en, 'object', 'no en table was registered')

  /**
   * The keys the CARD actually asks for.
   *
   * Taken from card.tsx rather than from the copy tables, and that is the whole
   * point: comparing the tables to themselves would pass even if every key in
   * them were spelled differently from the lookups. This is the direction that
   * catches a typo on either side.
   */
  const card = readFileSync(join(root, 'src', 'client', 'card.tsx'), 'utf8')
  const asked = new Set()
  for (const m of card.matchAll(/\bt\(\s*"([\w.]+)"/g)) asked.add(m[1])
  for (const m of card.matchAll(/\bt\(\s*`([\w.]+)\.\$\{/g)) {
    // A template lookup like t(`account.state.${state}`) — expand it over the
    // suffixes the copy table actually carries.
    const prefix = `${m[1]}.`
    for (const key of Object.keys(zh)) if (key.startsWith(prefix)) asked.add(key)
  }

  assert.ok(asked.size > 50, `expected the card to ask for many keys, found ${asked.size}`)

  const missingZh = [...asked].filter((k) => !(k in zh))
  const missingEn = [...asked].filter((k) => !(k in en))
  assert.deepEqual(missingZh, [], 'the card asks for these keys but zh has no entry')
  assert.deepEqual(missingEn, [], 'the card asks for these keys but en has no entry')

  const zhKeys = Object.keys(zh).sort()
  const enKeys = Object.keys(en).sort()
  assert.deepEqual(
    zhKeys.filter((k) => !enKeys.includes(k)),
    [],
    'these keys have Chinese copy but no English',
  )
  assert.deepEqual(
    enKeys.filter((k) => !zhKeys.includes(k)),
    [],
    'these keys have English copy but no Chinese',
  )

  // A value equal to its own key is the signature of a key-echo — which is
  // what the shipped 0.4.3 bug produced at RUNTIME. Catching it in the table
  // means a copy mistake cannot masquerade as the same symptom as the
  // namespace bug this file exists for.
  for (const [key, value] of Object.entries(zh)) {
    assert.notEqual(value, key, `zh["${key}"] is its own key — that is a key-echo, not copy`)
  }
  for (const [key, value] of Object.entries(en)) {
    assert.notEqual(value, key, `en["${key}"] is its own key — that is a key-echo, not copy`)
  }
})
