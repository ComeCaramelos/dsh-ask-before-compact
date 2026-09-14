/**
 * @comecaramelos/dsh-ask-before-compact/engine — compaction backend.
 *
 * `AskBeforeCompactEngine` extends the stock `BasicCompactionEngine` and is
 * mounted by the ask-before-compact agent preset in its place (same row id
 * slot inside the preset's isolated compaction realm). The stock automatic
 * machinery — the `agent/pre-step` pressure hook, the
 * `agent/request-error` overflow recovery, the log-recorded compaction lock
 * and the cache-reusing summarizer — is inherited untouched; only the two
 * decision points are wrapped:
 *
 *   compactIfNeeded  (automatic pressure / context-overflow)
 *   compactNow       (manual /compact)
 *
 * each consults the host-plane `askBeforeCompact` service (the Web
 * question with timeout) before the parent implementation runs. A "block"
 * decision skips the compaction: the pressure path returns null (the turn
 * continues), the overflow path returns null (the provider error surfaces),
 * and the manual path reports the stock "cancelled" outcome.
 *
 * The usage warning (warn-on-%) is NOT registered here: it is a
 * session-level feature, and the host half (`lib/index.js` `apply`) owns an
 * `agent/pre-step` listener on the host context that covers every agent of
 * every preset — including this one.
 *
 * Row:
 *   - id: compaction-ask-before-compact
 *     name: '@comecaramelos/dsh-ask-before-compact/engine'
 *
 * No row config beyond the stock backend defaults; the behavior settings
 * (active/timeout/onTimeout/warnAtPercent) live in the `ask-before-compact`
 * settings namespace the host half serves, so they stay editable at runtime.
 */
import { BasicCompactionEngine } from "@deepseek-ai/dsh-compaction-basic";
import { ManualCompactionError } from "@deepseek-ai/dsh-compaction";

/** Cordis plugin name used by loader diagnostics. */
const name = "ask-before-compact-engine";

/**
 * Stock compaction backend that asks the user first.
 *
 * `compactIfNeeded` stays dynamically dispatched by the inherited
 * automatic listeners, so overriding it here (as documented by
 * dsh-compaction-basic) is honored at event time.
 */
export class AskBeforeCompactEngine extends BasicCompactionEngine {
	/** Stock backend dependencies plus the host-plane confirmation service. */
	static inject = [...BasicCompactionEngine.inject, "askBeforeCompact"];

	/**
	 * @param ctx - plugin context (llm, tokenMeter, sessions, askBeforeCompact).
	 * @param config - stock BasicCompactionConfig row config.
	 */
	constructor(ctx, config = {}) {
		super(ctx, config);
	}

	/**
	 * Gate one automatic compaction decision behind the user confirmation.
	 * @param agent - agent whose session is compacted.
	 * @param trigger - "pressure" or "context-overflow".
	 * @param signal - live turn cancellation signal.
	 * @returns the parent's result, or null when the user (or the timeout
	 *   action) blocked the compaction.
	 */
	async compactIfNeeded(agent, trigger, signal) {
		const decision = await this.ctx.askBeforeCompact.confirm({ agent, trigger, signal });
		if (decision === "block") {
			this.ctx.logger.info(`ask-before-compact: ${trigger} compaction blocked before running`);
			return null;
		}
		return super.compactIfNeeded(agent, trigger, signal);
	}

	/**
	 * Gate one manual /compact behind the user confirmation.
	 * @param agent - idle agent owning the session.
	 * @param signal - compaction cancellation signal.
	 * @param sourceCommandId - optional initiating command identity.
	 * @throws {ManualCompactionError} code "cancelled" when blocked, which
	 *   the /compact command renders as "Compaction cancelled."
	 */
	async compactNow(agent, signal, sourceCommandId) {
		const decision = await this.ctx.askBeforeCompact.confirm({ agent, trigger: "manual", signal });
		if (decision === "block") {
			throw new ManualCompactionError("cancelled", "Compaction was blocked by the ask-before-compact confirmation.");
		}
		return super.compactNow(agent, signal, sourceCommandId);
	}
}

export default AskBeforeCompactEngine;
export { name };
