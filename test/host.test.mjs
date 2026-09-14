/**
 * Host-half tests: the askBeforeCompact decision table (createController)
 * and the apply() wiring (settings namespace + provided service).
 *
 * No live composition: ctx is a minimal fake carrying exactly the services
 * the controller touches (sessionProjections, userQuestions, logger,
 * settings). Usage comes from the `contextPressure` projection — the same
 * source the GUI context meter reads — never a meter/model-info round-trip.
 * Warnings are published (a toast signal) rather than injected as messages.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
	apply,
	CONFIRM_OPTIONS,
	createController,
	SectionSchema,
	SETTINGS_NAMESPACE,
	SERVICE_NAME,
	WARN_ESCALATION_STEP
} from "../lib/index.js";

/** One fake session; usage lives on ctx, not on the session. */
function makeAgent() {
	return { id: "agent-1", session: { id: "session-1" } };
}

/**
 * Build the fake host context.
 * @param options - window / tokens seed the initial contextPressure projection
 *   (window: null means no projection yet → usage reads null);
 *   askImpl is the userQuestions answerer behavior; settings overrides the
 *   installSection sink; skills carries a registerProvider sink (when present
 *   apply fires its skills injection and registers the bundled provider).
 */
function makeCtx(opts = {}) {
	const window = opts.window === undefined ? 100000 : opts.window;
	const tokens = opts.tokens === undefined ? 80000 : opts.tokens;
	const { askImpl, settings } = opts;
	// The live contextPressure projection. null = no usage sample yet.
	let pressure = window === null ? null : { contextWindow: window, pressureTokens: tokens };
	const provided = {};
	const asked = [];
	const listeners = [];
	const registered = [];
	const mutations = [];
	const ctx = {
		logger: { info() {}, warn() {}, error() {} },
		sessionProjections: {
			snapshot(_session, keys) {
				if (!keys.includes("contextPressure")) return { values: {} };
				return { values: { contextPressure: pressure } };
			}
		},
		userQuestions: {
			ask: (req) => {
				asked.push(req);
				return askImpl(req);
			}
		},
		provide(name, value) {
			provided[name] = value;
		},
		on(eventName, listener) {
			listeners.push([eventName, listener]);
		},
		inject(names, fn) {
			if (names.length === 1 && names[0] === "settings") return fn(ctx);
			if (names.length === 1 && names[0] === "skills") {
				// Mirrors cordis: the callback only runs once `skills` resolves.
				if (ctx.skills === undefined) return;
				return fn({ skills: { registerProvider: (create) => registered.push(create) } });
			}
			assert.fail(`unexpected inject dependencies: ${names.join(",")}`);
		}
	};
	ctx.settings = settings ?? {
		installSection(owner, ns, schema, entry, hooks) {
			ctx.__installed = { owner, ns, schema, entry, hooks };
			hooks.setSource(() => entry);
			hooks.onChange();
		},
		mutate(_ns, ops) {
			mutations.push(ops);
			return Promise.resolve({ revision: 1 });
		}
	};
	if (opts.skills !== undefined) ctx.skills = opts.skills;

	/** Advance the usage trajectory: `tokens` at `window` (default 100k). */
	function setPressure(tokens, win = 100000) {
		pressure = tokens === null ? null : { contextWindow: win, pressureTokens: tokens };
	}
	return { ctx, provided, asked, listeners, registered, mutations, setPressure };
}

/** An answerer that settles only when the ask signal aborts, like the Web one. */
function abortingAskImpl() {
	return (req) =>
		new Promise((resolve, reject) => {
			const fail = () => {
				const error = new Error("ask_user_question was aborted before the user answered");
				error.code = "ASK_ABORTED";
				reject(error);
			};
			if (req.signal?.aborted) return fail();
			req.signal?.addEventListener("abort", fail, { once: true });
		});
}

const baseConfig = { active: true, timeoutSeconds: 30, onTimeout: "permit", warnAtPercent: 70 };

// ── confirm(): decision table ────────────────────────────────────────────────

test("confirm: plugin off permits without asking", async () => {
	const { ctx, asked } = makeCtx();
	const controller = createController(ctx, () => ({ ...baseConfig, active: false }));
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "permit");
	assert.equal(asked.length, 0);
});

test("confirm: answering Compact permits", async () => {
	const { ctx } = makeCtx({ askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: ["Compact"] }] }) });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "permit");
});

test("confirm: answering Cancel blocks", async () => {
	const { ctx } = makeCtx({ askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: ["Cancel"] }] }) });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "block");
});

test("confirm: custom text is not a permit", async () => {
	const { ctx } = makeCtx({ askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: [], custom: "not now" }] }) });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "manual", signal: new AbortController().signal });
	assert.equal(decision, "block");
});

test("confirm: empty selection is not a permit", async () => {
	const { ctx } = makeCtx({ askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: [] }] }) });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "block");
});

test("confirm: timeout applies the configured onTimeout=block", async () => {
	const { ctx } = makeCtx({ askImpl: abortingAskImpl() });
	const controller = createController(ctx, () => ({ ...baseConfig, timeoutSeconds: 0.02, onTimeout: "block" }));
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "block");
});

test("confirm: timeout applies the configured onTimeout=permit", async () => {
	const { ctx } = makeCtx({ askImpl: abortingAskImpl() });
	const controller = createController(ctx, () => ({ ...baseConfig, timeoutSeconds: 0.02, onTimeout: "permit" }));
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "permit");
});

test("confirm: caller abort wins over timeout (permit, turn is dying)", async () => {
	const { ctx } = makeCtx({ askImpl: abortingAskImpl() });
	const controller = createController(ctx, () => ({ ...baseConfig, timeoutSeconds: 3600, onTimeout: "block" }));
	const controllerAbort = new AbortController();
	const confirmPromise = controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: controllerAbort.signal });
	setTimeout(() => controllerAbort.abort(), 10);
	const decision = await confirmPromise;
	assert.equal(decision, "permit");
});

test("confirm: already-aborted signal permits without asking", async () => {
	const { ctx, asked } = makeCtx({ askImpl: abortingAskImpl() });
	const controller = createController(ctx, () => ({ ...baseConfig, timeoutSeconds: 3600, onTimeout: "block" }));
	const controllerAbort = new AbortController();
	controllerAbort.abort();
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "manual", signal: controllerAbort.signal });
	assert.equal(decision, "permit");
	assert.equal(asked.length, 0);
});

test("confirm: missing answerer (NO_PROVIDER) fails open", async () => {
	const failing = () => {
		const error = new Error("no user-questions answerer accepted the request");
		error.code = "NO_PROVIDER";
		throw error;
	};
	const { ctx } = makeCtx({ askImpl: failing });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "context-overflow", signal: new AbortController().signal });
	assert.equal(decision, "permit");
});

test("confirm: live agent registry mismatch (CALLER_NOT_LIVE) fails open", async () => {
	const failing = () => {
		const error = new Error("human interaction requires the exact live calling agent when an agent is supplied");
		error.code = "CALLER_NOT_LIVE";
		throw error;
	};
	const { ctx } = makeCtx({ askImpl: failing });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "manual", signal: new AbortController().signal });
	assert.equal(decision, "permit");
});

// ── confirm(): question content ──────────────────────────────────────────────

test("confirm: question carries rounded percent, header, options, and trigger detail", async () => {
	const { ctx, asked } = makeCtx({
		window: 100000,
		tokens: 84321,
		askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: ["Compact"] }] })
	});
	const controller = createController(ctx, () => baseConfig);
	const agent = makeAgent();
	await controller.confirm({ agent, trigger: "pressure", signal: new AbortController().signal });
	assert.equal(asked[0].agent, agent); // agent scope rides the request
	const question = asked[0].questions[0];
	assert.equal(question.id, "compact");
	assert.equal(question.header, "Compact context");
	assert.match(question.question, /84%/);
	assert.match(question.detail, /Automatic compaction/);
	// The options come from CONFIRM_OPTIONS: label + description only, the
	// decision column stays host-side, and no intent is declared (the generic
	// option list must keep rendering every option as the table grows).
	assert.deepEqual(
		question.options.map((option) => option.label),
		["Compact", "Cancel"]
	);
	assert.deepEqual(question.options.map((option) => typeof option.description), ["string", "string"]);
	assert.equal(question.intent, void 0);
});

test("confirm: an option added to the table is offered and maps to its decision", async () => {
	// The ask is table-driven: appending an entry is the whole change — the
	// payload grows and the new label routes to the decision it declares.
	CONFIRM_OPTIONS.push({
		label: "Compact and keep the last 5 messages",
		description: "Summarize everything except the newest exchange",
		decision: "permit"
	});
	try {
		const { ctx, asked } = makeCtx({
			askImpl: () =>
				Promise.resolve({ answers: [{ id: "compact", selected: ["Compact and keep the last 5 messages"] }] })
		});
		const controller = createController(ctx, () => baseConfig);
		const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
		assert.equal(decision, "permit");
		assert.equal(asked[0].questions[0].options.length, 3);
		assert.equal(asked[0].questions[0].options[2].label, "Compact and keep the last 5 messages");
	} finally {
		CONFIRM_OPTIONS.pop();
	}
});

test("confirm: a selection naming none of the offered options blocks", async () => {
	// A stale or hand-typed selection never unlocks a compaction — only a label
	// the plugin itself offered does.
	const { ctx } = makeCtx({ askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: ["Keep everything"] }] }) });
	const controller = createController(ctx, () => baseConfig);
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "pressure", signal: new AbortController().signal });
	assert.equal(decision, "block");
});

test("confirm: manual and overflow triggers get their own detail", async () => {
	const answer = () => Promise.resolve({ answers: [{ id: "compact", selected: ["Compact"] }] });
	const { ctx, asked } = makeCtx({ askImpl: answer });
	const controller = createController(ctx, () => baseConfig);
	await controller.confirm({ agent: makeAgent(), trigger: "manual", signal: new AbortController().signal });
	assert.match(asked[0].questions[0].detail, /\/compact/);
	await controller.confirm({ agent: makeAgent(), trigger: "context-overflow", signal: new AbortController().signal });
	assert.match(asked[1].questions[0].detail, /exceeded the context window/);
});

test("confirm: unmeasurable usage still asks, without a percent", async () => {
	const { ctx, asked } = makeCtx({
		window: null, // no projection yet
		askImpl: () => Promise.resolve({ answers: [{ id: "compact", selected: ["Compact"] }] })
	});
	const controller = createController(ctx, () => baseConfig);
	await controller.confirm({ agent: makeAgent(), trigger: "manual", signal: new AbortController().signal });
	assert.doesNotMatch(asked[0].questions[0].question, /%/);
	assert.match(asked[0].questions[0].question, /can be compacted/);
});

// ── usagePercent() ───────────────────────────────────────────────────────────

test("usagePercent: pressure over window", async () => {
	const { ctx } = makeCtx({ window: 100000, tokens: 80000 });
	const controller = createController(ctx, () => baseConfig);
	const percent = await controller.usagePercent(makeAgent().session, new AbortController().signal);
	assert.equal(percent, 80);
});

test("usagePercent: projectedTokens wins over pressureTokens", async () => {
	const { ctx } = makeCtx({ window: 100000, tokens: 80000 });
	// The projected figure is what the meter shows; it must win.
	const controller = createController(ctx, () => baseConfig);
	ctx.sessionProjections = { snapshot: () => ({ values: { contextPressure: { contextWindow: 100000, pressureTokens: 80000, projectedTokens: 91000 } } }) };
	const percent = await controller.usagePercent(makeAgent().session, new AbortController().signal);
	assert.equal(percent, 91);
});

test("usagePercent: usage beyond the window clamps to 100", async () => {
	const { ctx } = makeCtx({ window: 100000, tokens: 130000 });
	const controller = createController(ctx, () => baseConfig);
	const percent = await controller.usagePercent(makeAgent().session, new AbortController().signal);
	assert.equal(percent, 100);
});

test("usagePercent: no projection yet → null", async () => {
	const { ctx } = makeCtx({ window: null });
	const controller = createController(ctx, () => baseConfig);
	const percent = await controller.usagePercent(makeAgent().session, new AbortController().signal);
	assert.equal(percent, null);
});

test("usagePercent: projection without a window → null", async () => {
	const { ctx } = makeCtx({ window: 100000 });
	ctx.sessionProjections = { snapshot: () => ({ values: { contextPressure: { pressureTokens: 80000 } } }) };
	const controller = createController(ctx, () => baseConfig);
	const percent = await controller.usagePercent(makeAgent().session, new AbortController().signal);
	assert.equal(percent, null);
});

// ── maybeWarn(): threshold, escalation, re-arm ───────────────────────────────

/** Drive a controller against a usage trajectory via the projection. */
function makeWarnController(trajectory, config = baseConfig) {
	const { ctx, setPressure } = makeCtx({ window: 100000, tokens: trajectory[0] });
	const published = [];
	const controller = createController(ctx, () => config, (payload) => published.push(payload));
	/** Feed the next trajectory point and run one maybeWarn pass. */
	async function step(index) {
		setPressure(trajectory[index]);
		await controller.maybeWarn({ agent: makeAgent(), signal: new AbortController().signal });
	}
	return { published, step };
}

test("maybeWarn: below threshold publishes nothing", async () => {
	const { published, step } = makeWarnController([65000]);
	await step(0);
	assert.equal(published.length, 0);
});

test("maybeWarn: crossing the threshold publishes one warning", async () => {
	const { published, step } = makeWarnController([75000]);
	await step(0);
	assert.equal(published.length, 1);
	const warning = published[0];
	assert.equal(warning.sessionId, "session-1");
	assert.equal(warning.percent, 75);
});

test("maybeWarn: no re-warning within the escalation step", async () => {
	const { published, step } = makeWarnController([75000, 84000, 86000]);
	for (let i = 0; i < 3; i++) await step(i);
	assert.equal(published.length, 2); // 75%, then 86% (84% is within 10 of 75)
	assert.deepEqual(published.map((w) => w.percent), [75, 86]);
});

test("maybeWarn: dropping below the threshold re-arms the crossing", async () => {
	const { published, step } = makeWarnController([75000, 60000, 71000]);
	for (let i = 0; i < 3; i++) await step(i);
	assert.equal(published.length, 2); // 75%, then 71% after the drop
	assert.deepEqual(published.map((w) => w.percent), [75, 71]);
});

test("maybeWarn: warnAtPercent 0 disables the warning", async () => {
	const { published, step } = makeWarnController([99000], { ...baseConfig, warnAtPercent: 0 });
	await step(0);
	assert.equal(published.length, 0);
});

test("maybeWarn: plugin off publishes nothing", async () => {
	const { published, step } = makeWarnController([99000], { ...baseConfig, active: false });
	await step(0);
	assert.equal(published.length, 0);
});

test("maybeWarn: a missing projection never throws or publishes", async () => {
	const { ctx } = makeCtx({ window: null });
	const published = [];
	const controller = createController(ctx, () => baseConfig, (payload) => published.push(payload));
	await controller.maybeWarn({ agent: makeAgent(), signal: new AbortController().signal }); // must not throw
	assert.equal(published.length, 0);
});

test("maybeWarn: a throwing projection never throws", async () => {
	const { ctx } = makeCtx();
	ctx.sessionProjections = { snapshot: () => {
		throw new Error("projection exploded");
	} };
	const published = [];
	const agent = makeAgent();
	const controller = createController(ctx, () => baseConfig, (payload) => published.push(payload));
	await controller.maybeWarn({ agent, signal: new AbortController().signal }); // must not throw
	assert.equal(published.length, 0);
});

// ── apply(): wiring ──────────────────────────────────────────────────────────

test("apply: registers the settings namespace with the row config plus warn base", () => {
	const { ctx, provided } = makeCtx();
	apply(ctx, { active: true, timeoutSeconds: 42, onTimeout: "block", warnAtPercent: 66 });
	const installed = ctx.__installed;
	assert.equal(installed.ns, SETTINGS_NAMESPACE);
	assert.equal(installed.schema, SectionSchema);
	assert.deepEqual(installed.entry, {
		active: true,
		timeoutSeconds: 42,
		onTimeout: "block",
		warnAtPercent: 66,
		lastWarn: { seq: 0, sessionId: "", percent: 0 }
	});
	assert.ok(provided[SERVICE_NAME]);
	assert.equal(typeof provided[SERVICE_NAME].confirm, "function");
	assert.equal(typeof provided[SERVICE_NAME].maybeWarn, "function");
});

test("apply: the service follows the resolved user layer, not the row config", async () => {
	let resolved = { ...baseConfig };
	const settings = {
		installSection(owner, ns, schema, entry, hooks) {
			hooks.setSource(() => resolved);
			hooks.onChange();
		},
		mutate() {
			return Promise.resolve({ revision: 1 });
		}
	};
	const { ctx, provided } = makeCtx({ settings, askImpl: abortingAskImpl() });
	apply(ctx, baseConfig);
	const controller = provided[SERVICE_NAME];
	// Row config is active; user layer flips it off → the controller must follow.
	resolved = { ...baseConfig, active: false };
	const decision = await controller.confirm({ agent: makeAgent(), trigger: "manual", signal: new AbortController().signal });
	assert.equal(decision, "permit"); // off: no ask
});

test("apply: registers one host pre-step listener feeding maybeWarn", () => {
	const { ctx, listeners } = makeCtx();
	apply(ctx, baseConfig);
	assert.deepEqual(
		listeners.map(([name]) => name),
		["agent/pre-step"]
	);
});

test("apply: the pre-step listener publishes a warning crossing and always continues the step", async () => {
	const { ctx, listeners, mutations } = makeCtx();
	apply(ctx, baseConfig); // 80% >= 70% threshold
	const [, listener] = listeners[0];
	const agent = makeAgent();
	// normal step: the warning check runs, the crossing is pushed, the step continues
	const nextResult = await listener({ agent, signal: new AbortController().signal }, () => "NEXT");
	assert.equal(nextResult, "NEXT");
	assert.equal(mutations.length, 1);
	const ops = mutations[0];
	assert.equal(ops[0].path.join("."), "warnNonce");
	assert.equal(ops[0].value, 1);
	// aborted step: the check is skipped, the step still continues, no new push
	const aborted = new AbortController();
	aborted.abort();
	const nextResult2 = await listener({ agent, signal: aborted.signal }, () => "NEXT2");
	assert.equal(nextResult2, "NEXT2");
	assert.equal(mutations.length, 1);
});

test("apply: the crossing writes the live base lastWarn payload", async () => {
	const { ctx, listeners } = makeCtx();
	apply(ctx, baseConfig);
	const [, listener] = listeners[0];
	await listener({ agent: makeAgent(), signal: new AbortController().signal }, () => "NEXT");
	assert.deepEqual(ctx.__installed.entry.lastWarn, { seq: 1, sessionId: "session-1", percent: 80 });
});

// ── SectionSchema: Standard Schema surface ──────────────────────────────────

test("SectionSchema: defaults fill a bare section", () => {
	const result = SectionSchema["~standard"].validate({});
	assert.equal(result.issues, undefined);
	assert.deepEqual(result.value, { ...baseConfig, lastWarn: { seq: 0, sessionId: "", percent: 0 }, warnNonce: 0 });
});

test("SectionSchema: rejects out-of-range and out-of-vocabulary values", () => {
	assert.ok(SectionSchema["~standard"].validate({ timeoutSeconds: 0 }).issues);
	assert.ok(SectionSchema["~standard"].validate({ timeoutSeconds: 3601 }).issues);
	assert.ok(SectionSchema["~standard"].validate({ warnAtPercent: 101 }).issues);
	assert.ok(SectionSchema["~standard"].validate({ warnAtPercent: -1 }).issues);
	assert.ok(SectionSchema["~standard"].validate({ onTimeout: "maybe" }).issues);
	assert.ok(SectionSchema["~standard"].validate({ active: "yes" }).issues);
});

test("SectionSchema: accepts the extremes", () => {
	const result = SectionSchema["~standard"].validate({ active: false, timeoutSeconds: 1, onTimeout: "block", warnAtPercent: 0 });
	assert.equal(result.issues, undefined);
	assert.equal(result.value.active, false);
	assert.equal(result.value.warnAtPercent, 0);
});

test("exports are stable identities", () => {
	assert.equal(typeof WARN_ESCALATION_STEP, "number");
	assert.equal(SETTINGS_NAMESPACE, "ask-before-compact");
	assert.equal(SERVICE_NAME, "askBeforeCompact");
});

// ── bundled skills registration (apply wiring) ───────────────────────────────

test("apply: registers one bundled provider when the host carries a registry", async () => {
	const { ctx, registered } = makeCtx({ skills: {} });
	apply(ctx, baseConfig);
	assert.equal(registered.length, 1);
	// The registry invokes the creator to obtain the provider object.
	const provider = registered[0]();
	assert.equal(provider.name, "ask-before-compact-skills");
	const candidates = await provider.list();
	assert.equal(candidates.length, 1);
	assert.equal(candidates[0].name, "agents-md-compactor");
	assert.equal(candidates[0].provider, "ask-before-compact-skills");
});

test("apply: registers nothing when the host carries no skill registry", () => {
	const { ctx, registered } = makeCtx();
	apply(ctx, baseConfig);
	assert.equal(registered.length, 0);
});
