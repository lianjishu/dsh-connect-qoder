/**
 * Guard the host's settings read-back timing.
 *
 * Run: node --test test/settings-readback-timing.test.js
 *
 * WHY THIS FILE EXISTS
 *
 * `src/host/index.ts` finishes activation by registering the settings
 * presentation (`settings.configure({auto:true})`) and then reads the namespace
 * back out of `settings.describe()` to confirm the host really serves it.
 *
 * That read-back is right; WHEN it ran was wrong. `describe()` admits a row only
 * when `entry.fiber.state === 2` (ACTIVE) — and this callback runs inside
 * activation, so the plugin's own fiber is still settling. A `queueMicrotask`
 * read therefore lands BEFORE that transition and reports the row absent on
 * every boot, for a plugin whose row appears moments later.
 *
 * The observed evidence (DSH NEXT 2.0.19-next, desktop-next.log):
 *
 *   07:29:18.850  Qoder has no local sign-in; region not registered
 *   07:29:18.877  the settings namespace "llm-qoder" is absent from describe() …
 *
 * 27 ms apart, i.e. the check ran during activation, and the namespace list the
 * client half read a second later contained the row (21 -> 22 namespaces).
 *
 * `src/host/index.ts` cannot be imported here (Cordis peers), so — like
 * `test/config-schema.test.js` — this guard works on the source text. It pins the
 * shape of the fix, not its prose: no microtask read-back, a deferred timer, and
 * a read-back that reports the served names.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'host', 'index.ts'),
  'utf8',
)

/** The block that configures the settings presentation and reads it back. */
function settingsSurfaceBlock() {
  const anchor = SOURCE.indexOf("ctx.inject(['settings']")
  assert.ok(anchor !== -1, 'src/host/index.ts no longer registers the settings surface')
  // Walk to the end of the `ctx.inject([...], (…) => { … })` call by brace
  // depth, so the assertions below cannot accidentally read the next block.
  const open = SOURCE.indexOf('{', anchor)
  let depth = 0
  for (let i = open; i < SOURCE.length; i++) {
    if (SOURCE[i] === '{') depth++
    else if (SOURCE[i] === '}') {
      depth--
      if (depth === 0) return SOURCE.slice(anchor, i + 1)
    }
  }
  assert.fail('unbalanced braces in the settings-surface block')
}

test('the settings read-back does not run on a microtask', () => {
  // A microtask runs before the fiber reaches ACTIVE, which is exactly the
  // window in which describe() must NOT be asked whether the row exists.
  const block = settingsSurfaceBlock()
  assert.doesNotMatch(
    block,
    /queueMicrotask\s*\(/,
    'the read-back runs on a microtask again: describe() is read before the fiber ' +
      'is ACTIVE, so the row is reported absent on every boot (see the header)',
  )
})

test('the settings read-back is deferred by a timer', () => {
  const block = settingsSurfaceBlock()
  const timers = block.match(/setTimeout\s*\(/g) ?? []
  assert.ok(
    timers.length > 0,
    'the read-back is no longer deferred: a synchronous or microtask check reads ' +
      'describe() while this plugin’s own fiber is still settling',
  )
})

test('the deferred read-back is cancelled with the fiber', () => {
  // A timer that outlives the fiber fires into a disposed context. The fix
  // registers a disposer through ctx.effect for exactly that reason.
  const block = settingsSurfaceBlock()
  assert.match(
    block,
    /ctx\.effect\(/,
    'the deferred read-back is not registered with ctx.effect, so its timers ' +
      'outlive the plugin fiber and fire into a disposed context',
  )
  assert.match(block, /clearTimeout\s*\(/, 'the deferred read-back does not clear its timers on dispose')
})

test('the read-back names the served namespaces, not only an absence', () => {
  // Reporting "the namespace is absent" with no list is what made the earlier
  // false alarm unreadable: 22 namespaces were served and the warning named none
  // of them, so "presence" and "absence" looked identical in the log.
  const block = settingsSurfaceBlock()
  assert.match(
    block,
    /served: \$\{/,
    'the missing-namespace warning no longer lists what the host DOES serve; without ' +
      'that list a false absence cannot be told from a real one',
  )
})

test('the read-back matches the namespace exactly, never by substring', () => {
  // The same rule settings-save.ts and the client both follow: a loose match
  // would accept a row belonging to another plugin and then write through it.
  const block = settingsSurfaceBlock()
  assert.match(block, /\.includes\(settingsNs\)/, 'the read-back no longer does an exact namespace match')
  assert.doesNotMatch(
    block,
    /\.some\(\(?row\)?\s*=>\s*String\(row\?\.ns\)/,
    'the read-back is stringifying rows to compare; read `ns` as a string and match exactly',
  )
})
