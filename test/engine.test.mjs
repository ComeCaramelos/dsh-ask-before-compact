/**
 * Engine tests: AskBeforeCompactEngine gates the stock backend's decision
 * points behind the host askBeforeCompact service.
 *
 * The parent implementation is spied on by temporarily replacing
 * BasicCompactionEngine.prototype.compactIfNeeded / compactNow, so no live
 * composition (no summarizer, no session log) is needed.
 */
import test from "node:test";
import assert from "node:assert/strict";
import def, { AskBeforeCompactEngine, name } from "../lib/engine.js";
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { ManualCompactionError } from "@deepseek-ai/dsh-compaction";

const agent = { id: "agent-1", session: { id: "session-1" } };

/** Run the prototype method on a fake instance, spying on the stock parent. */
async function callWithSpy(method, decision, args) {
	const calls = [];
	const parentProto = BasicCompactionEngine.prototype;
	const original = parentProto[method];
	parentProto[method] = async (...callArgs) => {
		calls.push(callArgs);
		return "PARENT-RESULT";
	};
	try {
		const fake = {
			ctx: {
				// confirm spy records the request the engine forwarded
				askBeforeCompact: {
					confirm: async (req) => {
						calls.push({ __confirm: req });
						return decision;
					}
				},
				logger: { info() {}, warn() {}, error() {} }
			}
		};
		try {
			const result = await AskBeforeCompactEngine.prototype[method].call(fake, ...args);
			return { result, error: void 0, calls };
		} catch (error) {
			return { result: void 0, error, calls };
		}
	} finally {
		parentProto[method] = original;
	}
}

test("the default export is the engine class", () => {
	assert.equal(def, AskBeforeCompactEngine);
	assert.equal(name, "ask-before-compact-engine");
});

test("the engine extends the stock BasicCompactionEngine", () => {
	assert.ok(AskBeforeCompactEngine.prototype instanceof BasicCompactionEngine);
});

test("static inject adds askBeforeCompact to the stock dependencies", () => {
	assert.deepEqual(
		AskBeforeCompactEngine.inject,
		[...BasicCompactionEngine.inject, "askBeforeCompact"]
	);
});

test("compactIfNeeded: block skips the stock backend entirely", async () => {
	const { result, calls } = await callWithSpy("compactIfNeeded", "block", [agent, "pressure", new AbortController().signal]);
	assert.equal(result, null);
	assert.equal(calls.length, 1); // only the confirm call; the parent never ran
	assert.deepEqual(calls[0].__confirm, { agent, trigger: "pressure", signal: calls[0].__confirm.signal });
});

test("compactIfNeeded: permit runs the stock backend with the same arguments", async () => {
	const signal = new AbortController().signal;
	const { result, calls } = await callWithSpy("compactIfNeeded", "permit", [agent, "context-overflow", signal]);
	assert.equal(result, "PARENT-RESULT");
	const parentCall = calls.find((call) => !("__confirm" in call));
	assert.deepEqual(parentCall, [agent, "context-overflow", signal]);
});

test("compactNow: block throws the stock cancelled failure", async () => {
	const { error } = await callWithSpy("compactNow", "block", [agent, new AbortController().signal, "command-1"]);
	assert.ok(error instanceof ManualCompactionError);
	assert.equal(error.code, "cancelled");
});

test("compactNow: permit runs the stock backend with the same arguments", async () => {
	const signal = new AbortController().signal;
	const { result, calls } = await callWithSpy("compactNow", "permit", [agent, signal, "command-1"]);
	assert.equal(result, "PARENT-RESULT");
	const parentCall = calls.find((call) => !("__confirm" in call));
	assert.deepEqual(parentCall, [agent, signal, "command-1"]);
	const confirmCall = calls.find((call) => "__confirm" in call);
	assert.equal(confirmCall.__confirm.trigger, "manual");
});

test("the engine registers no listeners of its own (warn-on-% lives on the host)", () => {
	const listeners = [];
	// The stock parent registers its automatic-compaction listeners only when
	// config.auto is set; the fake ctx captures every registration.
	const fakeCtx = {
		on(eventName) {
			listeners.push(eventName);
		},
		reflect: { provide() {} } // the Service base registers itself here
	};
	// Instantiate through the class so the stock parent runs first, with the
	// automatic machinery disabled so the only registrations in play are the
	// ones this subclass adds.
	new AskBeforeCompactEngine(fakeCtx, { auto: false });
	assert.equal(listeners.length, 0);
});
