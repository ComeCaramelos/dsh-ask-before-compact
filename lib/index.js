/**
 * @comecaramelos/dsh-ask-before-compact — host half.
 *
 * Asks the user before the context of a session is compacted, and raises a
 * visible toast once usage crosses a configured percentage.
 *
 * One plugin instance per dsh host. It owns three things:
 *
 * 1. The `ask-before-compact` settings namespace (base layer = row config),
 *    edited by the Web GUI card in ./client.js:
 *
 *      active          ask before every compaction      (default true)
 *      timeoutSeconds  how long to wait for an answer   (default 30)
 *      onTimeout       action when nobody answers       (default "permit")
 *      warnAtPercent   usage % that raises the warning  (default 70; 0 = off)
 *      warnNonce       host→client toast re-serve trigger (default 0; user-
 *                      authored only by this host pushing a warning)
 *
 * 2. The `askBeforeCompact` service consumed by the compaction engine
 *    (./engine.js, mounted by the ask-before-compact agent preset in place
 *    of @deepseek-ai/dsh-compaction-basic):
 *
 *      config()                      live resolved settings snapshot
 *      usagePercent(session, signal) % of the routed model window, or null
 *      confirm({agent,trigger,signal}) → "permit" | "block"
 *      maybeWarn({agent, signal})     publishes the threshold warning (a
 *                                     toast the browser draws) at most once
 *                                     per 10-point rise, rearming when usage
 *                                     drops back below the threshold
 *
 * 3. The bundled `agents-md-compactor` skill (./skills.js), registered on
 *    `ctx.skills` as one host-plane provider when the host carries a skill
 *    registry — optional by design: a host without a registry simply never
 *    registers it, exactly like every other "cannot ask"-style path, the
 *    plugin never fails and compaction is never affected.
 *
 * The usage warning is owned by the host half: `apply` registers one
 * `agent/pre-step` listener on the host context, so every agent of every
 * preset gets the warn-on-% check. (The confirmation gate cannot do the
 * same — it must intercept the compaction backend, which is realm-isolated
 * per preset; that lives in ./engine.js.)
 *
 * Confirmation goes through `ctx.userQuestions.ask` — the same answerer
 * waterfall the ask_user tool uses, so the Web GUI renders it with its
 * standard question UI. Timeout races `AbortSignal.timeout` against the
 * caller signal. Fail-open policy: when no answerer is available (headless,
 * disconnected browser) or the agent is not a live runtime root, the
 * compaction proceeds instead of wedging the session.
 */
import z from "@deepseek-ai/schemastery";
import { createBundledSkillProvider } from "./skills.js";

/** Cordis plugin name used by loader diagnostics. */
const name = "ask-before-compact";

/**
 * Host services the plugin resolves; all are host-plane rows of the base. The
 * `contextPressure` projection (registered by `dsh-token-meter`) supplies the
 * percent; `userQuestions` drives the confirmation. `skills` is resolved
 * conditionally in apply (optional provider registration), never a hard dependency.
 */
const inject = ["sessionProjections", "userQuestions"];

/** Fixed settings namespace; also the client card's slot key. */
export const SETTINGS_NAMESPACE = "ask-before-compact";

/** Service the compaction engine injects. */
export const SERVICE_NAME = "askBeforeCompact";

/** Identifier tag kept on plugin-pushed warnings (host→client toast signal). */
export const PLUGIN_ID = "ask-before-compact";

/** Usage warning re-arms after dropping below the threshold; otherwise it
 * escalates at most every 10 percentage points. */
export const WARN_ESCALATION_STEP = 10;

const OnTimeout = z.union([z.const("permit"), z.const("block")]);

/**
 * User-settings section served to the Web GUI card.
 *
 * schemastery has no `z.enum`/`.optional`: the closed union is a union of
 * consts, and every field carries a default so the resolved snapshot is
 * always complete.
 */
export const SettingsSchema = z.object({
	/** Ask the user before every compaction; false disables the plugin. */
	active: z.boolean().default(true),
	/** Seconds to wait for a confirmation answer. */
	timeoutSeconds: z.number().step(1).min(1).max(3600).default(30),
	/** Action applied when nobody answers before the timeout. */
	onTimeout: OnTimeout.default("permit"),
	/** Usage percentage that raises the warning; 0 disables it. */
	warnAtPercent: z.number().step(1).min(0).max(100).default(70)
});

/**
 * Live warn payload pushed host→browser through the same namespace, alongside
 * the four user fields. `lastWarn` carries the most recent warning crossing —
 * a monotonic `seq` (so an already-shown toast is not re-staged), the session
 * that raised it (so only that session's view toasts), and the rounded
 * percent. Every field defaults, so the resolved snapshot stays complete for
 * a host that has not yet warned. The host writes `seq`/`sessionId`/`percent`;
 * nothing here is user-authored, so the card never surfaces it.
 */
export const LastWarnSchema = z.object({
	/** Monotonic counter; 0 = nothing warned yet. */
	seq: z.number().step(1).min(0).default(0),
	/** Session id that raised the crossing; "" = none. */
	sessionId: z.string().default(""),
	/** Rounded context occupancy at the crossing, 0–100. */
	percent: z.number().step(1).min(0).max(100).default(0)
});

/**
 * Full namespace schema: the four user fields, the host-pushed `lastWarn`
 * crossing payload, and `warnNonce`.
 *
 * `lastWarn` lives in the composition BASE layer (in-memory, never persisted)
 * so no session id or stale warning leaks into `settings.yaml`. But a
 * base-only change recomputes nothing and fires no `settings/document-updated`
 * — the only host→browser channel — so the host pairs each crossing with a
 * monotonic `warnNonce` written to the user layer, exactly the docker/chrome
 * base-layer push idiom: the raw nonce change bumps the revision and re-serves
 * the merged value (base `lastWarn` + user fields) to every open browser.
 *
 * Note: schemastery objects do not expose their member schemas as properties,
 * so the four user fields are re-declared here (they must stay in step with
 * {@link SettingsSchema}).
 */
export const SectionSchema = z.object({
	active: z.boolean().default(true),
	timeoutSeconds: z.number().step(1).min(1).max(3600).default(30),
	onTimeout: OnTimeout.default("permit"),
	warnAtPercent: z.number().step(1).min(0).max(100).default(70),
	lastWarn: LastWarnSchema.default({ seq: 0, sessionId: "", percent: 0 }),
	warnNonce: z.number().step(1).min(0).default(0)
});

/** Row config = the namespace base layer; the user layer resolves above it. */
export const Config = SectionSchema;

/**
 * Read one session's live context occupancy as a percent of its context
 * window, straight from the `contextPressure` session projection — the exact
 * number the Web GUI context meter draws (`projectedTokens ?? pressureTokens
 * / contextWindow`, capped at 100). The projection is synchronous and
 * host-plane; before the first provider usage sample either field is absent
 * and the read returns `null`.
 *
 * Deliberately NOT `tokenMeter.measure(session).totalTokens`: that adds the
 * previous call's output tokens and re-estimates the whole surface after any
 * request-envelope change — in the field it read ~12 points above the meter,
 * quoting a percentage the user could not reconcile with it.
 *
 * @param sessionProjections - the host projection registry.
 * @param session - the session to measure.
 * @returns the percentage, or null when no usage sample or window exists yet.
 */
function contextPressurePercent(sessionProjections, session) {
	const values = sessionProjections.snapshot(session, ["contextPressure"])?.values;
	const pressure = values?.contextPressure;
	if (pressure === void 0 || pressure === null || typeof pressure.contextWindow !== "number" || pressure.contextWindow <= 0) return null;
	const used = pressure.projectedTokens ?? pressure.pressureTokens;
	if (typeof used !== "number" || used < 0) return null;
	return Math.min(100, (used / pressure.contextWindow) * 100);
}

/**
 * The confirmation options the question offers, in GUI order.
 *
 * The Web answerer echoes back the **label** the user picked, so this table is
 * the single source of truth for both the question payload and the decision:
 * each entry declares the label the UI renders and the decision it selects.
 * Growing the ask later (a "compact and keep the last N messages"-style entry)
 * means appending one row here — nothing else reads the labels. The internal
 * `permit`/`block` vocabulary stays put: it is what the settings namespace,
 * `onTimeout`, and the engine's block path speak, so stored configs and the
 * fail-open table keep working across future label changes.
 *
 * No presentation `intent` is declared: the live `userQuestions` surface claims
 * a request only for the binary `plan-review` intent — one question, `detail`
 * present, not multi-select, **at most two options** — so a table that grows
 * past two entries would fall out of the claim and be rendered as the generic
 * option list anyway. Riding the generic list from the start keeps every option
 * visible instead of letting the presentation change when a third lands.
 */
export const CONFIRM_OPTIONS = [
	{ label: "Compact", description: "Run the compaction now", decision: "permit" },
	{ label: "Cancel", description: "Keep the conversation as it is", decision: "block" }
];

/**
 * Build the `askBeforeCompact` service object.
 *
 * Kept pure over its inputs so tests can exercise the decision table without
 * a live composition; `apply` wires the real ones.
 *
 * @param ctx - host plugin context (sessionProjections, userQuestions, logger).
 * @param configOf - returns the live resolved settings snapshot.
 * @param publishWarn - pushes a `{ sessionId, percent }` crossing to every
 *   connected browser (wired by `apply`; defaults to a no-op so the decision
 *   table stays testable without a live settings service).
 * @returns the service object published as {@link SERVICE_NAME}.
 */
export function createController(ctx, configOf, publishWarn = () => {}) {
	/** sessionId → last warned percent; re-armed when usage drops. */
	const warnedAt = new Map();

	/**
	 * Current context usage as a percentage of the routed model window.
	 *
	 * Reads the `contextPressure` projection — the exact number the Web GUI
	 * context meter draws — so a warning never quotes a percentage the user
	 * cannot reconcile with the meter in front of them.
	 *
	 * @param session - session to measure.
	 * @param signal - unused; kept for service-contract compatibility.
	 * @returns the percentage, or null when no usage sample or window exists.
	 */
	async function usagePercent(session, signal) {
		return contextPressurePercent(ctx.sessionProjections, session);
	}

	/**
	 * Ask the user what to do about one compaction.
	 *
	 * Decision table (logged either way):
	 *   active false                      → "permit" (plugin off)
	 *   caller signal already aborted     → "permit" (the turn is dying)
	 *   answer "Compact"                  → "permit"
	 *   answer "Cancel"                   → "block"
	 *   custom text / empty selection     → "block" (no option picked)
	 *   caller signal aborted mid-ask     → "permit" (abort wins over timeout)
	 *   timeout fired                     → the configured `onTimeout`
	 *   answerer unavailable / other error→ "permit" (fail open, logged)
	 *
	 * The offered options live in {@link CONFIRM_OPTIONS}, so the GUI can offer
	 * more than the two entries that exist today without touching this logic.
	 *
	 * @param req - `{ agent, trigger: "pressure" | "context-overflow" | "manual", signal }`.
	 * @returns "permit" or "block".
	 */
	async function confirm({ agent, trigger, signal }) {
		const cfg = configOf();
		if (!cfg.active) return "permit";
		if (signal?.aborted) return "permit";
		const percent = await usagePercent(agent.session, signal).catch(() => null);
		const detail =
			trigger === "manual"
				? "Requested through /compact."
				: trigger === "context-overflow"
					? "The last model request exceeded the context window; compacting is the only way to continue this session."
					: "Automatic compaction: the older conversation is condensed into one summary; the recent tail is kept.";
		const question = {
			id: "compact",
			header: "Compact context",
			question:
				percent !== null
					? `Context is at ${Math.round(percent)}% of the model window. What do you want to do?`
					: "This session's older history can be compacted. What do you want to do?",
			detail,
			options: CONFIRM_OPTIONS.map(({ label, description }) => ({ label, description }))
		};
		const timeoutMs = cfg.timeoutSeconds * 1000;
		const timeoutSignal = timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : null;
		const askSignal = timeoutSignal === null ? signal : AbortSignal.any([signal, timeoutSignal]);
		try {
			const answer = await ctx.userQuestions.ask({ questions: [question], agent, signal: askSignal });
			const picked = answer?.answers?.[0];
			const selected = Array.isArray(picked?.selected) ? picked.selected : [];
			for (const option of CONFIRM_OPTIONS) {
				if (!selected.includes(option.label)) continue;
				if (option.decision === "permit") {
					ctx.logger.info(`ask-before-compact: compaction permitted by user confirmation ("${option.label}")`);
					return "permit";
				}
				ctx.logger.info(`ask-before-compact: compaction blocked by user confirmation ("${option.label}")`);
				return "block";
			}
			ctx.logger.info("ask-before-compact: confirmation picked none of the offered options; blocking");
			return "block";
		} catch (error) {
			if (signal?.aborted) return "permit";
			if (timeoutSignal !== null && timeoutSignal.aborted) {
				ctx.logger.info(`ask-before-compact: confirmation timed out after ${cfg.timeoutSeconds}s; applying "${cfg.onTimeout}"`);
				return cfg.onTimeout;
			}
			const reason = error?.code ?? (error instanceof Error ? error.message : String(error));
			ctx.logger.warn(`ask-before-compact: confirmation unavailable (${reason}); permitting compaction`);
			return "permit";
		}
	}

	/**
	 * Raise the usage warning once per crossing/escalation per session.
	 *
	 * Rules: silent while active is false, warnAtPercent is 0, or the usage
	 * cannot be measured. Once usage reaches the threshold the crossing is
	 * published as a toast the browser draws for that session; while usage
	 * stays high it re-warns at most every {@link WARN_ESCALATION_STEP}
	 * points; dropping back below the threshold re-arms the first crossing.
	 *
	 * Never throws: a failed measurement or publish is a logged warning, not
	 * a compaction blocker.
	 *
	 * @param req - `{ agent, signal }`.
	 */
	async function maybeWarn({ agent, signal }) {
		try {
			const cfg = configOf();
			if (!cfg.active || cfg.warnAtPercent <= 0) return;
			if (signal?.aborted) return;
			const percent = await usagePercent(agent.session, signal);
			if (percent === null) return;
			const key = String(agent.session.id);
			const last = warnedAt.get(key);
			if (percent < cfg.warnAtPercent) {
				if (last !== void 0) warnedAt.delete(key);
				return;
			}
			if (last !== void 0 && last >= cfg.warnAtPercent && percent < last + WARN_ESCALATION_STEP) return;
			if (last !== void 0 && percent < last) return;
			warnedAt.set(key, Math.round(percent));
			publishWarn({ sessionId: agent.session.id, percent: Math.round(percent) });
			ctx.logger.info(`ask-before-compact: context at ${Math.round(percent)}% of the model window (warn threshold ${cfg.warnAtPercent}%)`);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			ctx.logger.warn(`ask-before-compact: usage warning failed: ${reason}`);
		}
	}

	return { config: configOf, usagePercent, confirm, maybeWarn };
}

/**
 * Mount the settings namespace, publish the `askBeforeCompact` service,
 * register the host-plane `agent/pre-step` listener that drives the usage
 * warning for every agent of every preset, and (when the host carries a skill
 * registry) register the bundled `agents-md-compactor` provider.
 *
 * The provided object is stable for the process lifetime; its `config` closure
 * follows the live resolved value (user layer over the row-config base) without
 * re-provisioning the service. The warning listener lives on the host context
 * (not the preset-mounted engine) so warn-on-% works regardless of which agent
 * preset a session runs under — the confirmation gate alone is preset-bound,
 * because only the preset can swap the realm-isolated compaction backend.
 *
 * A warning is delivered as a browser toast, not an injected message. Crossing
 * decisions run here, host-plane, through the controller's
 * {@link createController} publisher, which stages the crossing on the live
 * base entry and bumps `warnNonce` so the change re-serves to open browsers.
 *
 * @param ctx - plugin context.
 * @param config - validated {@link Config} (the namespace base layer).
 */
function apply(ctx, config) {
	// Live base entry: the four user fields plus the host-owned warn payload,
	// mutated in memory on every crossing (never persisted — it never appears in
	// `settings.yaml`). The user layer resolves above it, so a base `lastWarn`
	// mutation surfaces as `value.lastWarn` on re-serve.
	const base = { ...config, lastWarn: { seq: 0, sessionId: "", percent: 0 } };
	// Host-owned counter driving the persisted `warnNonce`. `bumpRevision` fires
	// `document-updated` only when the raw user section changes, so the
	// base-layer payload alone never travels — each crossing must also land a
	// new `warnNonce` in the user layer.
	let warnSeq = 0;
	let settings = null;
	let source = () => base;

	ctx.inject(["settings"], (settingsCtx) => {
		settings = settingsCtx.settings;
		settings.installSection(ctx, SETTINGS_NAMESPACE, SectionSchema, base, {
			setSource: (next) => {
				source = next;
			},
			onChange: () => {
				// The controller reads the snapshot on demand; nothing to react to.
			}
		});
	});

	const publishWarn = ({ sessionId, percent }) => {
		try {
			warnSeq += 1;
			base.lastWarn = { seq: warnSeq, sessionId: String(sessionId), percent };
			// The base mutation alone recomputes nothing. The raw user-layer
			// nonce change is what bumps the revision, re-serves the merged value,
			// and reaches open browsers.
			// Fail-open: a rejected write (read-only provider, shutdown) must
			// never wedge the step — the crossing was already logged by the caller.
			settings?.mutate(SETTINGS_NAMESPACE, [{ op: "set", path: ["warnNonce"], value: warnSeq }]).catch(() => {
				ctx.logger.warn("ask-before-compact: warning re-serve rejected; toast may not surface");
			});
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			ctx.logger.warn(`ask-before-compact: warning publish failed: ${reason}`);
		}
	};

	const controller = createController(ctx, source, publishWarn);
	ctx.provide(SERVICE_NAME, controller);
	// Bundled skill registration is optional: the host carries `skills` in
	// every standard composition, but a minimal host that does not must not
	// stop this plugin (nor compaction) from working.
	ctx.inject(["skills"], (skillsCtx) => {
		skillsCtx.skills.registerProvider(() => createBundledSkillProvider());
	});
	// maybeWarn never throws, but the listener still contains any failure so
	// the step always continues.
	ctx.on("agent/pre-step", async ({ agent, signal }, next) => {
		if (!signal.aborted) {
			try {
				await controller.maybeWarn({ agent, signal });
			} catch (error) {
				const reason = error instanceof Error ? error.message : String(error);
				ctx.logger.warn(`ask-before-compact: usage warning failed: ${reason}`);
			}
		}
		return next();
	});
}

export { apply, inject, name };
