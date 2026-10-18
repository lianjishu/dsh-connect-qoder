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
		const fallback = "dsh-connect-qoder";
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
	 * Whether the host actually SERVES this plugin's namespace.
	 *
	 * `forms.get(ns)` is not a servability test: it answers an object for any
	 * namespace name, including one the host never created. Using it as the
	 * writability gate made the card offer live controls whose every save is
	 * refused — the host's `__save` finds no row in `describe()` and answers
	 * 503, so the user sees a switch that renders, toggles, and never lands.
	 *
	 * `describe()` is the authority: it lists exactly the active profile
	 * entries that produced a volatile form. A namespace missing from that
	 * list has nothing to persist into, so the card must stay read-only —
	 * the degraded path this file already had, now actually reachable.
	 */
	const namespaceServed = (): { served: boolean; hostRows: number } => {
		if (forms === void 0) return { served: false, hostRows: 0 };
		try {
			const namespaces = forms.describe().getSnapshot().view?.namespaces ?? [];
			const served = namespaces.some((entry) => {
				// Rows are `{ ns, ... }`; any other shape is not a match.
				const ns = (entry as { ns?: unknown } | null | undefined)?.ns;
				return typeof ns === 'string' && ns === namespace;
			});
			return { served, hostRows: namespaces.length };
		} catch {
			// A describe() that throws cannot prove the namespace exists, and a
			// speculative writable card is the defect this guard exists to stop.
			return { served: false, hostRows: 0 };
		}
	};
	/**
	 * Resolve the writable scope AT RENDER TIME, not once at load.
	 *
	 * `describe()` is a mirror of the Host's document, and that mirror is
	 * populated asynchronously (`SettingsDescribeMirror.load`, driven by
	 * `remote.settings.describe()`). Reading it once during `apply()` asks a
	 * question the answer to which is not ready yet: this plugin's bundle is
	 * LAST in `dsh.profile.bundles`, so at the moment the client half runs, the
	 * mirror still holds the startup snapshot the earlier bundles loaded —
	 * every one of the host's own namespaces, and none of the third-party rows
	 * that had not activated yet.
	 *
	 * That is exactly what the 21-namespace console error described: a TRUE
	 * snapshot of the wrong instant. Pinning `settingsScope` from it left the
	 * card permanently read-only even though the row appears moments later.
	 *
	 * The slot's `inject` face is evaluated lazily by the renderer (once per
	 * registered entry, cached on the entry), so resolving here means the card
	 * sees whatever the mirror knows by the time it is actually mounted.
	 */
	const servedState = (): { served: boolean; hostRows: number } => namespaceServed();
	/**
	 * Whether the "serving other rows, but not ours" warning has been raised.
	 *
	 * That condition is a standing one — the Loader row id drifted, or the host
	 * never created the namespace — and it deserves a name in the console. But
	 * the same list is briefly incomplete on every cold start, so raising it at
	 * the first mount would cry wolf. `reportUnserved` is called from a timer
	 * after activation settles (see below), where an absence is real.
	 */
	let warnedUnserved = false;
	/**
	 * The scope to hand the card, or `undefined` for the read-only path.
	 *
	 * Deliberately silent: a mount that happens before the mirror settles is
	 * normal, and the standing-condition warning is raised once by
	 * {@link reportUnserved} instead.
	 */
	const liveScope = (): SettingsScope | undefined => {
		if (forms === void 0) return undefined;
		return servedState().served ? (forms.get(namespace) as SettingsScope) : undefined;
	};
	/**
	 * Name the standing anomaly once, after the document has had time to settle.
	 *
	 * `describe()` lists the ACTIVE profile entries that produced a volatile
	 * form. A namespace missing from it long after boot means this plugin's row
	 * is not configurable at all — either its Loader row id drifted from
	 * `PROVIDER_NS` (the failure `plugins/issues/14` catalogued) or the host
	 * never created the row (the Loader-less case, which is normal only when the
	 * whole list is empty).
	 *
	 * The delay is the point. Reading the mirror synchronously in `apply()` is
	 * what produced the false alarm this plugin shipped: this bundle is last in
	 * `dsh.profile.bundles`, so at client boot the mirror still holds the
	 * snapshot the earlier bundles loaded and our own row has not appeared yet.
	 */
	const reportUnserved = (): void => {
		if (warnedUnserved) return;
		const { served, hostRows } = servedState();
		if (served) return;
		// An EMPTY list is the ordinary Loader-less host and stays silent — the
		// same rule `resolveNamespace` follows above.
		if (hostRows === 0) return;
		warnedUnserved = true;
		console.error(
			`[dsh-connect-qoder] the host serves ${hostRows} settings namespace(s) but not ` +
				`"${namespace}"; the card stays read-only (its saves would be refused). ` +
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