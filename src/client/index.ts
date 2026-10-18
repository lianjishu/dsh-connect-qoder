import { installStyles } from "./styles.ts"
import { zh, en } from "./copy.ts"
import { QoderPluginCard } from "./card.tsx"
import { ComposerUsagePill } from "./composer-usage-pill.tsx"
import type { SettingsScope } from "./settings-write.ts"

/**
 * The browser plugin's Cordis context, from the members this file touches.
 *
 * Declared structurally for the same reason `HostContext` is (`domain.ts`):
 * Cordis is a peer the checkout has no types for, and a hand-written imitation
 * of its real `Context` would be worse than `unknown` because it could not
 * admit what it does not know. Everything below is either present in the
 * `inject` list above or probed with `ctx.get`, so nothing here is speculative.
 *
 * `get` answers `unknown` on purpose: it is the soft service locator this file
 * uses to the settings surface, which the 0.2 harness may or may not serve, and each is narrowed at
 * the point of use rather than trusted by name.
 */
interface ClientContext {
	effect(callback: () => unknown, name?: string): unknown
	locale: {
		register(namespace: string, copy: { zh: unknown; en: unknown }): unknown
		bind(namespace: string): (key: string) => string
	}
	slots: {
		inject(slotName: string, callback: () => unknown): unknown
		register(slot: Record<string, unknown>, card: unknown): unknown
	}
	get(name: string): unknown
}

/** Stable browser-plugin name. */
const name = "dsh-connect-qoder-client";
/**
 * The Loader entry id the host serves this plugin's settings under — the same
 * value the host half resolves in `settingsNamespaceOf` (`llm-qoder`). Named
 * once here so the namespace lookup and the row-slot key below cannot drift
 * into two spellings of the same id.
 */
const PROVIDER_NS = "llm-qoder";
/**
 * The namespace a Loader-less host serves this plugin under — the second half
 * of the exact candidate pair `resolveNamespace` matches, and the value the
 * card falls back to when the host derives no Loader entry id.
 *
 * Named once at module scope so the candidate pair (below), the live row
 * resolution, and the unserved warning all read one spelling. Two literals for
 * one namespace is the failure `docs/issues/14` catalogued.
 */
const FALLBACK_NS = "dsh-connect-qoder";
/**
 * Client services this card reads.
 *
 * The 0.2 harness serves settings through `configForms` only — the older
 * `settingsScope` wrapper service no longer exists, and Cordis' hard inject
 * gate would brick web boot on a listed-but-absent service ("1 entry did
 * not activate: … pending (waiting for service: …)"). Only guaranteed
 * services go in `inject`; the settings surface is probed softly inside
 * `apply` below.
 */
const inject = ["slots", "locale"];
/**
 * Register the Qoder card under Plugin configuration.
 *
 * The whole body is wrapped so that a future DSH slot-API change degrades
 * to a `console.error` instead of throwing into the loader and raising the
 * red "Failed to load plugins" banner — the host provider keeps working
 * either way, and the model channel is unaffected.
 *
 * `key` names the settings namespace the HOST serves. A card whose key
 * names no served namespace is registered into the slot but never
 * rendered, because the card list is built from the Host's installed
 * sections.
 */
function apply(ctx: ClientContext) {
	try {
		installStyles();
	/**
	 * Probe the settings surface without a hard dependency. The 0.2 harness
	 * serves it through `configForms`; `ctx.get` returns undefined (never
	 * throws) for an absent service, so a host without it degrades to a
	 * read-only card instead of bricking boot. The older `settingsScope`
	 * wrapper no longer exists, so it is no longer probed for. `forms.get(ns)`
	 * answers the `.set` / `.getSnapshot` shape the card writes through.
	 */
	/**
	 * Probe a service by name without a hard dependency.
	 *
	 * Answers `unknown`, matching the fact that `ctx.get` is a string-keyed
	 * lookup: there is no mapping the compiler could check, so each caller
	 * states the shape it expects at the point it reads a member. The shape
	 * below (`configForms`) belongs to the harness, not
	 * to this plugin, which is why they are declared inline where they are used
	 * rather than invented as interfaces here — a hand-written guess at a peer
	 * package's surface is worse than an honest `unknown`.
	 */
	const softGet = (name: string): unknown => ctx.get(name);
	/**
	 * The namespace the HOST actually serves this plugin's settings under.
	 *
	 * Read from the live `describe()` view rather than trusted from a constant,
	 * because a plugin no longer picks its own namespace: on the 0.2 line the
	 * service derives it from the Loader entry (`ns: entry.options.id`, which
	 * is the provider name `llm-qoder`), and a host that mounts the plugin
	 * without a Loader entry serves it under the plugin namespace. The host
	 * half already resolves this the same way in `settingsNamespaceOf` — and
	 * reads it live for the same reason.
	 *
	 * This value drives BOTH the locale table and the settings scope, and that
	 * is the point: they must name one namespace, or the copy and the section
	 * the user is looking at belong to different identities. An earlier version
	 * hardcoded `"settings.qoder"` here — a namespace the host has never
	 * served — so `locale.bind` found no table, every lookup fell back to
	 * echoing its own key, and the card rendered as raw `account.reload`-style
	 * identifiers in BOTH languages. The fault was misread as "no English
	 * translation" for a while, because a key-echo looks the same as a missing
	 * translation whichever locale is active.
	 */
	const resolveNamespace = (): string => {
		const fallback = FALLBACK_NS;
		// The two hops below are the harness's own `configForms` surface. Each is
		// declared as the minimum this line reads rather than guessed at whole:
		// `describe()` returns a live view whose `namespaces` array carries the
		// `ns` strings, and the optional links are optional because a future
		// harness that flattens any of them should answer `fallback` here, not
		// throw — the `try`/`catch` below already covers a throwing shape.
		const forms = softGet("configForms") as
			| { describe(): { getSnapshot(): { view?: { namespaces?: Array<{ ns: string }> } } } }
			| undefined;
		if (forms === void 0) return fallback;
		try {
			// Exact candidates only, never a substring: a loose match would find
			// a row belonging to another plugin, and the locale table and the
			// settings scope would then name a namespace that is not ours — the
			// card silently configured someone else's section. The two names are
			// the one the Loader serves (the entry id, `llm-qoder`) and the
			// fallback declared above; the host's own `settingsNamespaceOf`
			// resolves the same pair, and test/plugin-identity.test.js holds the
			// two spellings against the Loader row id in cordis.patch.yml.
			const namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];
			const served = namespaces
				.find((entry) => entry.ns === fallback || entry.ns === PROVIDER_NS);
			if (served !== void 0) return served.ns;
			// A host that serves SOME namespaces but none of ours is not the
			// Loader-less case this fallback is written for — there the list is
			// empty. It means the id moved and every copy below was written
			// against the old one, so the card will register where nobody is
			// served and the settings row will simply be absent. That is
			// invisible by construction, so it is named here: the whole failure
			// is a one-value edit in cordis.patch.yml plus the two literals.
			if (namespaces.length > 0) {
				console.error(
					`[dsh-connect-qoder] the host serves ${namespaces.length} settings namespace(s) ` +
					`(${namespaces.map((entry) => entry.ns).join(", ")}) but none of them is this ` +
					`plugin's (${fallback} / ${PROVIDER_NS}); the card is registering under ` +
					`"${fallback}", which is not served — its settings row will be missing. ` +
					'This is the Loader row id in cordis.patch.yml drifting from src/client/index.ts.',
				);
			}
			return fallback;
		} catch {
			return fallback;
		}
	};
	const namespace = resolveNamespace();
	ctx.effect(() => ctx.locale.register(namespace, {
		zh,
		en
	}), "dsh-connect-qoder: settings copy");
	const t = ctx.locale.bind(namespace);
	// The settings surface, narrowed to the calls it is probed with.
	// `SettingsScope` is this card's own type (declared with the card), so
	// the cast below is where the harness's answer meets it — the same
	// division of labour as the `unknown` above, kept to one line.
	const forms = softGet("configForms") as
		| {
				get(ns: string): unknown
				describe(): { getSnapshot(): { view?: { namespaces?: unknown[] } } }
		  }
		| undefined;
	/**
	 * The settings row the host serves for this plugin, read from the live
	 * mirror — never from a value captured at load.
	 *
	 * Both halves of the answer must be live, not just the writability flag:
	 *
	 * - `ns` is the row's OWN name. `namespace` (above) is resolved once during
	 *   `apply()` and, on a cold start where the mirror has not loaded yet,
	 *   that answer is the `dsh-connect-qoder` fallback — because an EMPTY list
	 *   is indistinguishable from "not served yet" at that instant. Comparing
	 *   a later snapshot against that frozen fallback would report a missing
	 *   row on a host that serves `llm-qoder` perfectly well. The observed
	 *   shape was exactly this: 22 namespaces served, `llm-qoder` among them,
	 *   and a warning claiming it was absent.
	 * - `hostRows` is how many rows the host serves, so an empty list (the
	 *   ordinary Loader-less host) can stay silent while a populated list with
	 *   no row of ours is named.
	 *
	 * The candidate pair is the same one `resolveNamespace` matches and the
	 * host's own `settingsNamespaceOf` resolves: the Loader entry id
	 * (`llm-qoder`) first, then the fallback the service uses when it derives
	 * no entry id.
	 */
	const servedRow = (): { ns: string | undefined; hostRows: number; namespaces: string[] } => {
		if (forms === void 0) return { ns: undefined, hostRows: 0, namespaces: [] };
		try {
			const namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];
			// Each hop is narrowed to the shape it is read as. A row that is not
			// `{ ns: string }` matches nothing — the same "not this row" answer
			// an exact-compare miss gives, rather than a match on a coercion.
			const nsOf = (entry: unknown): string | undefined => {
				const ns = (entry as { ns?: unknown } | null | undefined)?.ns;
				return typeof ns === 'string' ? ns : undefined;
			};
			const names = namespaces.map(nsOf).filter((ns): ns is string => ns !== undefined);
			// The Loader id wins: it is what the host derives the namespace from,
			// so when both are somehow present the entry id is the authoritative
			// one and the fallback is the duplicate.
			const ns = names.find((name) => name === PROVIDER_NS)
				?? names.find((name) => name === FALLBACK_NS);
			return { ns, hostRows: names.length, namespaces: names };
		} catch {
			// A describe() that throws cannot prove the row exists, and a
			// speculative writable card is the defect this guard exists to stop.
			return { ns: undefined, hostRows: 0, namespaces: [] };
		}
	};
	/**
	 * The scope to hand the card, or `undefined` for the read-only path.
	 *
	 * Deliberately silent: a mount that happens before the mirror settles is
	 * normal, and the standing-condition warning is raised once by
	 * {@link reportUnserved} instead.
	 */
	const liveScope = (): SettingsScope | undefined => {
		if (forms === void 0) return undefined;
		const { ns } = servedRow();
		return ns === undefined ? undefined : (forms.get(ns) as SettingsScope);
	};
	/**
	 * Whether the standing "not served" warning has already been raised.
	 *
	 * That condition is a standing one, so it is worth naming once — but the same
	 * list is briefly incomplete (or empty) on every cold start, which is why the
	 * report is deferred rather than raised at the first mount.
	 */
	let warnedUnserved = false;
	/**
	 * Name the standing anomaly once, after the document has had time to settle.
	 *
	 * `describe()` lists the ACTIVE profile entries that produced a volatile
	 * form. A row missing from it long after boot means this plugin is not
	 * configurable at all — either its Loader row id drifted from `PROVIDER_NS`
	 * (the failure `docs/issues/14` catalogued) or the host never created the
	 * row (the Loader-less case, which is normal only when the whole list is
	 * empty).
	 *
	 * The delay is the point. Reading the mirror synchronously in `apply()` is
	 * what produced the false alarm this plugin shipped: this bundle is last in
	 * `dsh.profile.bundles`, so at client boot the mirror still holds the
	 * snapshot the earlier bundles loaded — or nothing at all.
	 *
	 * The served names are listed, not just counted: the previous version of
	 * this warning reported a count alone, which is what let "22 namespaces"
	 * read as proof of absence when the row was very likely one of the 22.
	 */
	const reportUnserved = (): void => {
		if (warnedUnserved) return;
		const { ns, hostRows, namespaces } = servedRow();
		if (ns !== undefined) return;
		// An EMPTY list is the ordinary Loader-less host and stays silent — the
		// same rule `resolveNamespace` follows above.
		if (hostRows === 0) return;
		warnedUnserved = true;
		console.error(
			`[dsh-connect-qoder] the host serves ${hostRows} settings namespace(s) ` +
				`(${namespaces.join(", ")}) but none of them is this plugin's ` +
				`(${PROVIDER_NS} / ${FALLBACK_NS}); the card stays read-only (its saves would be refused). ` +
				`Either the Loader row id in cordis.patch.yml drifted, or the host never created the row. ` +
				`Set these fields declaratively in the profile patch instead — see README.`,
		);
	};
	// A host that does not serve the namespace gets a read-only card:
	// `settingsScope` is absent and the slot registration degrades to `{ t }` —
	// the existing degraded path, not an error.
	/**
	 * FIX 0.1.7: the plugin-manager detail page renders a bundle's config
	 * card from the `plugins.bundle.config` slot (and a row's from
	 * `plugins.row.config`); the legacy `settings.plugin.item` slot is no
	 * longer rendered there. The host gates the section on
	 * `ledger.bundles.has(openPkg.name)`, and that set is read back from
	 * these very slot registrations — a card registered under a key nobody
	 * installs as a dependency is invisible even though `apply` ran.
	 * The 0.3.2 scoped rename made that real: profiles may carry this
	 * bundle as either bare `dsh-connect-qoder` (the historical name) or
	 * scoped `@eghrhegpe/dsh-connect-qoder` (the npm name), so each key is
	 * registered in both identities. Registration itself degrades to a
	 * read-only card when no settings surface is served, instead of
	 * throwing into the loader.
	 */
	const registerCard = (slotName: string, key: string) => {
		try {
			ctx.slots.inject(slotName, () => ctx.slots.register({
				name: slotName,
				key,
				priority: 30,
				// Evaluated lazily by the renderer when the card is mounted, so
				// this reads the settings mirror at MOUNT time — not at the
				// instant the client half booted, which is earlier than the
				// first `remote.settings.describe()` answer.
				inject: () => {
					const scope = liveScope();
					return scope === void 0 ? { t } : { t, settingsScope: scope };
				}
			}, QoderPluginCard));
		} catch (error) {
			console.error(`[dsh-connect-qoder] card slot "${slotName}" failed to register (host provider unaffected):`, error);
		}
	};
	for (const bundle of ["@eghrhegpe/dsh-connect-qoder", "dsh-connect-qoder"]) {
		registerCard("plugins.bundle.config", bundle);
		registerCard("plugins.row.config", `${bundle}#${PROVIDER_NS}`);
	}
	registerCard("settings.plugin.item", "qoder");
	// 对话框用量胶囊（composer-usage-pill.tsx）：输入框工具栏 `conversation.input.right`
	// 座席。`useProjection` 是 renderer 物化注入的 session 作用域标准 prop（严格必需，
	// 见 test/composer-pill.test.js），这里的 inject 只补本插件字典 `t`。注册失败
	// 照卡片同款降级：console.error 后继续，不 throw 进 loader —— host provider 与
	// Plugins 页卡片都不受影响，只是对话框旁不出现胶囊。
	try {
		ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
			name: "conversation.input.right",
			id: `${PROVIDER_NS}-composer-pill`,
			locale: namespace,
			order: 4,
			inject: () => ({
				t
			})
		}, ComposerUsagePill));
	} catch (error) {
		console.error(`[dsh-connect-qoder] composer pill slot failed to register (host provider unaffected):`, error);
	}
	// Raise the standing "not served" anomaly once the document has had time to
	// settle. `setTimeout(0)` is the shortest defer that leaves the current task
	// queue — which is all that is needed to get past the synchronous part of
	// boot. A later second look covers the case where the first answer was still
	// the pre-activation snapshot: by then the mirror has re-read at least once.
	//
	// Registered through `ctx.effect` so the timers die with the plugin instead
	// of firing into a torn-down context. `ctx.effect` accepts the disposer form
	// everywhere this client targets, and the callbacks themselves are guarded by
	// `warnedUnserved`, so a double mount cannot double-log.
	try {
		ctx.effect(() => {
			const first = setTimeout(reportUnserved, 0);
			const second = setTimeout(reportUnserved, 4000);
			return () => {
				clearTimeout(first);
				clearTimeout(second);
			};
		}, "dsh-connect-qoder: unserved-namespace warning");
	} catch (error) {
		// The warning is diagnostic, never load-bearing: a host whose `effect`
		// rejects a disposer must still keep the card. Say so rather than vanish.
		console.error("[dsh-connect-qoder] could not schedule the settings-surface check:", error);
	}
	} catch (error) {
		console.error("[dsh-connect-qoder] client card failed to load (host provider unaffected):", error);
	}
}

export { apply, inject, name }