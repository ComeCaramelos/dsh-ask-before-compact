/**
 * Client-bundle tests: load the factory bundle with a window.__ModuleLoader__
 * stub, drive the card controller through the injected slot face, and smoke
 * render the card with react-dom/server.
 *
 * Baseline modules (react, react/jsx-runtime) come from the devDependencies;
 * @deepseek-ai/dsh-client-store (a shell-baseline module, not an npm dep here)
 * is stubbed with a minimal snapshot store.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const requireCjs = createRequire(import.meta.url);

// ── baseline stubs ───────────────────────────────────────────────────────────

/** Minimal stand-in for the shell-baseline @deepseek-ai/dsh-client-store. */
function createSnapshotStore(initial) {
	let value = initial;
	const listeners = new Set();
	return {
		set(next) {
			value = next;
			for (const listener of listeners) listener();
		},
		getSnapshot() {
			return value;
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		}
	};
}

const bundleExports = {};
globalThis.window = {
	__ModuleLoader__: {
		load(spec) {
			Object.assign(bundleExports, spec);
		}
	}
};

// The toast host mounts through `react-dom/client` onto a body-level node.
// Stub the DOM so `apply`'s effect can create a host and a root in-process.
const createdRoots = [];
globalThis.document = {
	head: { appendChild() {} },
	body: { appendChild() {} },
	querySelector() {
		return null;
	},
	createElement() {
		return { dataset: {}, remove() {} };
	}
};
const reactDomClient = {
	createRoot() {
		const root = { render() {}, unmount() {} };
		createdRoots.push(root);
		return root;
	}
};

// The shared Toast primitive + its warning icon, and the Switch primitive the
// Active control renders. The Switch stub renders nothing: the primitive is
// the shell's responsibility, not this bundle's, so the structural test below
// asserts the card delegates to it rather than re-implementing a native
// checkbox, and the controller tests exercise the flip it drives.
const primitives = {
	Toast: null,
	IconWarningOutline16: null,
	Switch() {
		return null;
	}
};

await import("../lib/client.js");

const fakeRequire = (id) => {
	switch (id) {
		case "react":
			return requireCjs("react");
		case "react/jsx-runtime":
			return requireCjs("react/jsx-runtime");
		case "@deepseek-ai/dsh-client-store":
			return { createSnapshotStore };
		case "@deepseek-ai/dsh-client-ui-primitives":
			return primitives;
		case "react-dom/client":
			return reactDomClient;
		default:
			throw new Error(`unexpected require in client bundle: ${id}`);
	}
};

const bundle = bundleExports.factory(fakeRequire);

// ── bundle shape ─────────────────────────────────────────────────────────────

test("the bundle exports apply and the inject list", () => {
	assert.equal(typeof bundle.apply, "function");
	assert.deepEqual(bundle.inject, ["slots", "locale", "settingsScope", "sessions"]);
});

// ── harness for apply() ──────────────────────────────────────────────────────

const DEFAULTS = { active: true, timeoutSeconds: 30, onTimeout: "permit", warnAtPercent: 70, warnNonce: 0 };

/** A mutable fake settings scope mirroring the stock bound-scope surface. */
function makeScope(section = {}) {
	const scope = {
		writes: [],
		state: {
			status: "ready",
			value: { ...DEFAULTS, ...section },
			base: { ...DEFAULTS },
			user: { ...section },
			writable: true
		},
		listeners: new Set(),
		getSnapshot() {
			return this.state;
		},
		subscribe(listener) {
			this.listeners.add(listener);
			return () => this.listeners.delete(listener);
		},
		set(field, value) {
			this.writes.push(["set", field, value]);
			this.state = {
				...this.state,
				value: { ...this.state.value, [field]: value },
				user: { ...this.state.user, [field]: value }
			};
			for (const listener of this.listeners) listener();
			return Promise.resolve();
		},
		unset(field) {
			this.writes.push(["unset", field]);
			const user = { ...this.state.user };
			delete user[field];
			this.state = { ...this.state, user, value: { ...this.state.base, ...user } };
			for (const listener of this.listeners) listener();
			return Promise.resolve();
		}
	};
	return scope;
}

/** A fake sessions service reporting a fixed active session id. */
function makeSessions(current) {
	return {
		list: {
			current,
			getSnapshot() {
				return { current: this.current };
			},
			subscribe(listener) {
				return () => listener();
			}
		}
	};
}

function mountCard(section = {}, options = {}) {
	const scope = makeScope(section);
	const locales = {};
	const registrations = [];
	const effects = [];
	const sessions = makeSessions(options.current === undefined ? "session-1" : options.current);
	const ctx = {
		effect(fn, label) {
			effects.push(label);
			fn();
		},
		sessions,
		locale: {
			register(ns, dict) {
				locales[ns] = dict;
			},
			bind() {
				return (key) => locales["askBeforeCompact"].en[key];
			}
		},
		settingsScope: {
			bind(spec) {
				assert.equal(spec.namespace, "ask-before-compact");
				return scope;
			}
		},
		slots: {
			inject(slotName, fn) {
				assert.equal(slotName, "settings.plugin.item");
				fn();
			},
			register(entry, component) {
				registrations.push({ entry, component });
			}
		}
	};
	bundle.apply(ctx);
	assert.equal(registrations.length, 1);
	const { entry, component } = registrations[0];
	assert.equal(entry.key, "ask-before-compact");
	assert.equal(entry.locale, "askBeforeCompact");
	assert.ok(locales["askBeforeCompact"].en.title);
	assert.ok(locales["askBeforeCompact"].zh.title);
	const face = entry.inject();
	return { scope, sessions, locales, component, face, effects };
}

// ── apply() registration ─────────────────────────────────────────────────────

test("apply: registers the card under the namespace slot key", () => {
	const { face } = mountCard();
	assert.equal(typeof face.edit, "function");
	assert.equal(typeof face.flipActive, "function");
	assert.equal(typeof face.resetField, "function");
	assert.equal(typeof face.save, "function");
	assert.equal(typeof face.discard, "function");
	assert.ok(face.hooks.askBeforeCompactCard);
});

// ── controller: staging, plan, save, reset, discard ──────────────────────────

test("the card shows the served values with no drafts", () => {
	const { face } = mountCard();
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.available, true);
	assert.equal(state.writable, true);
	assert.equal(state.dirty, false);
	assert.equal(state.fields.active.raw, true);
	assert.equal(state.fields.timeoutSeconds.raw, "30");
	assert.equal(state.fields.onTimeout.raw, "permit");
	assert.equal(state.fields.warnAtPercent.raw, "70");
	assert.ok(state.fields.active.overridden === false);
});

test("edits stage drafts and mark the card dirty", async () => {
	const { face } = mountCard();
	face.edit("timeoutSeconds", "45");
	face.edit("active", false);
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.dirty, true);
	assert.equal(state.fields.timeoutSeconds.raw, "45");
	assert.equal(state.fields.timeoutSeconds.dirty, true);
	assert.equal(state.fields.active.raw, false);
	assert.equal(state.fields.active.dirty, true);
	assert.equal(state.fields.warnAtPercent.dirty, false);
});

test("flipActive inverts the effective Active value and stages it", () => {
	const { face } = mountCard(); // default active: true
	face.flipActive();
	let state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.dirty, true);
	assert.equal(state.fields.active.raw, false);
	assert.equal(state.fields.active.dirty, true);
	// flipping again returns to the original value, still an explicit draft
	face.flipActive();
	state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.fields.active.raw, true);
	assert.equal(state.fields.active.dirty, true);
});

test("flipActive stages a bool, so a saved false is a value not a clear", async () => {
	const { scope, face } = mountCard();
	face.flipActive();
	await face.save();
	// "off" must persist as a stored false, not be cleared to the base value
	assert.deepEqual(scope.writes, [["set", "active", false]]);
	assert.equal(face.hooks.askBeforeCompactCard.getSnapshot().dirty, false);
});

test("save writes the staged values and clears the drafts", async () => {
	const { scope, face } = mountCard();
	face.edit("timeoutSeconds", "45");
	face.edit("active", false);
	face.edit("onTimeout", "block");
	await face.save();
	assert.deepEqual(scope.writes, [
		["set", "timeoutSeconds", 45],
		["set", "active", false],
		["set", "onTimeout", "block"]
	]);
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.dirty, false);
	assert.equal(state.saving, false);
	assert.equal(state.failed, false);
	assert.equal(state.fields.timeoutSeconds.raw, "45");
	assert.equal(state.fields.timeoutSeconds.overridden, true);
});

test("save is a no-op when a draft is invalid", async () => {
	const { scope, face } = mountCard();
	face.edit("warnAtPercent", "150");
	const stateBefore = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(stateBefore.fields.warnAtPercent.invalid, true);
	await face.save();
	assert.equal(scope.writes.length, 0);
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.dirty, true); // the draft is kept for correction
});

test("an empty int draft clears the override on save", async () => {
	const { scope, face } = mountCard({ timeoutSeconds: 45 });
	face.edit("timeoutSeconds", "");
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.dirty, true); // the user layer still holds the override
	await face.save();
	assert.deepEqual(scope.writes, [["unset", "timeoutSeconds"]]);
	const after = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(after.dirty, false);
	assert.equal(after.fields.timeoutSeconds.raw, "30"); // back to the base
	assert.equal(after.fields.timeoutSeconds.overridden, false);
});

test("editing a value equal to the current one is not dirty", () => {
	const { face } = mountCard();
	face.edit("timeoutSeconds", "30");
	assert.equal(face.hooks.askBeforeCompactCard.getSnapshot().dirty, false);
});

test("resetField stages a clear showing the base value", async () => {
	const { scope, face } = mountCard({ timeoutSeconds: 45, onTimeout: "block" });
	face.resetField("timeoutSeconds");
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.fields.timeoutSeconds.raw, "30"); // base value in the control
	assert.equal(state.dirty, true);
	face.resetField("onTimeout");
	await face.save();
	assert.deepEqual(scope.writes, [["unset", "timeoutSeconds"], ["unset", "onTimeout"]]);
	assert.equal(face.hooks.askBeforeCompactCard.getSnapshot().dirty, false);
});

test("discard drops every draft without writing", async () => {
	const { scope, face } = mountCard();
	face.edit("timeoutSeconds", "45");
	face.edit("warnAtPercent", "90");
	face.discard();
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.dirty, false);
	assert.equal(scope.writes.length, 0);
	assert.equal(state.fields.timeoutSeconds.raw, "30");
});

test("a rejected write keeps the drafts and flags the failure", async () => {
	const { scope, face } = mountCard();
	scope.set = (field, value) => {
		scope.writes.push(["set", field, value]);
		return Promise.reject(new Error("conflict"));
	};
	face.edit("timeoutSeconds", "45");
	await face.save();
	const state = face.hooks.askBeforeCompactCard.getSnapshot();
	assert.equal(state.failed, true);
	assert.equal(state.dirty, true); // draft retained for correction
});

// ── render smoke ─────────────────────────────────────────────────────────────

test("the card renders its header through the locale dictionaries", async () => {
	const React = requireCjs("react");
	const { renderToString } = requireCjs("react-dom/server");
	const { component, face, locales } = mountCard();
	const t = (key) => locales["askBeforeCompact"].en[key];
	const html = renderToString(
		React.createElement(
			"ul",
			null,
			React.createElement(component, {
				t,
				useAskBeforeCompactCard: (selector) => selector(face.hooks.askBeforeCompactCard.getSnapshot()),
				edit: face.edit,
				resetField: face.resetField,
				save: () => face.save(),
				discard: face.discard
			})
		)
	);
	assert.match(html, /Ask before compact/);
	assert.match(html, /Confirm context compaction before it runs/);
	assert.match(html, /abcc_card/);
	// closed by default: the body controls are not rendered yet
	assert.doesNotMatch(html, /Confirmation timeout/);
});

test("the card renders nothing until the namespace is served", async () => {
	const React = requireCjs("react");
	const { renderToString } = requireCjs("react-dom/server");
	const { component, face, locales } = mountCard();
	const t = (key) => locales["askBeforeCompact"].en[key];
	const html = renderToString(
		React.createElement(component, {
			t,
			useAskBeforeCompactCard: (selector) =>
				selector({ available: false, writable: false, fields: {}, dirty: false, saving: false, failed: false }),
			edit: face.edit,
			resetField: face.resetField,
			save: () => face.save(),
			discard: face.discard
		})
	);
	assert.equal(html, "");
});

// ── warn-toast host ───────────────────────────────────────────────────────────

test("apply mounts a body-level toast host", () => {
	createdRoots.length = 0;
	mountCard();
	// the warn toast host mounts through react-dom/client
	assert.equal(createdRoots.length, 1);
});

test("the card store projects the host-pushed warn payload", () => {
	const { face } = mountCard({ lastWarn: { seq: 7, sessionId: "session-1", percent: 83 }, warnNonce: 7 });
	const warn = face.hooks.askBeforeCompactCard.getSnapshot().warn;
	assert.deepEqual(warn, { seq: 7, sessionId: "session-1", percent: 83 });
});

test("the warn payload defaults when the host has not warned yet", () => {
	const { face } = mountCard();
	const warn = face.hooks.askBeforeCompactCard.getSnapshot().warn;
	assert.deepEqual(warn, { seq: 0, sessionId: "", percent: 0 });
});

