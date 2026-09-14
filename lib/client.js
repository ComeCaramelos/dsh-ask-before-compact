window.__ModuleLoader__.load({
	id: "@comecaramelos/dsh-ask-before-compact",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		var react = require("react");
		var reactJsx = require("react/jsx-runtime");
		var clientStore = require("@deepseek-ai/dsh-client-store");
		// Shell-provided UI primitive (the shared Toast) + the createRoot used to
		// mount the toast host outside the Settings view, matching the
		// docker-desktop/chrome plugin failure-toast host.
		var primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		var reactDomClient = require("react-dom/client");

		/**
		 * Ask before compact — browser half.
		 *
		 * Registers one card into the shared `settings.plugin.item` slot
		 * (Settings → Plugins → Plugin configuration), keyed by the
		 * `ask-before-compact` settings namespace the host half serves.
		 * The card edits the four behavior values — Active, confirmation
		 * timeout (seconds), action after timeout, and warn-on-% — staging
		 * local drafts until Save, with per-field reset to the composed
		 * base. Collapsible like the stock plugin cards.
		 */

		/** Settings namespace served by the host half; also the slot key. */
		var NS = "ask-before-compact";
		/** Locale dictionary namespace. */
		var LOCALE_NS = "askBeforeCompact";
		/** Required services (cordis fiber inject). */
		var inject = ["slots", "locale", "settingsScope", "sessions"];

		// ── card styles ────────────────────────────────────────────────────
		var CSS = {
			card: "abcc_card",
			cardOpen: "abcc_cardOpen",
			header: "abcc_header",
			headText: "abcc_headText",
			nameRow: "abcc_nameRow",
			name: "abcc_name",
			badge: "abcc_badge",
			desc: "abcc_desc",
			chevron: "abcc_chevron",
			chevronOpen: "abcc_chevronOpen",
			body: "abcc_body",
			field: "abcc_field",
			fieldHead: "abcc_fieldHead",
			label: "abcc_label",
			badges: "abcc_badges",
			reset: "abcc_reset",
			input: "abcc_input",
			inputInvalid: "abcc_inputInvalid",
			selector: "abcc_selector",
			selectorInvalid: "abcc_selectorInvalid",
			invalid: "abcc_invalid",
			hint: "abcc_hint",
			toggleRow: "abcc_toggleRow",
			row: "abcc_row",
			button: "abcc_button",
			readOnly: "abcc_readOnly",
			error: "abcc_error"
		};
		var css =
			"." + CSS.card + "{border:.5px solid var(--dsw-alias-border-l4);background:var(--dsw-alias-bg-layer-3);border-radius:16px;list-style:none;transition:border-color .16s,background .16s}" +
			"." + CSS.card + ":hover{border-color:var(--dsw-alias-label-dimmed)}" +
			"." + CSS.cardOpen + "{background:var(--dsw-alias-bg-layer-2);border-color:var(--dsw-alias-label-dimmed)}" +
			"." + CSS.header + "{appearance:none;width:100%;font:inherit;color:inherit;text-align:left;cursor:pointer;background:0 0;border:0;border-radius:12px;align-items:center;gap:12px;padding:14px 16px;display:flex}" +
			"." + CSS.header + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:-2px}" +
			"." + CSS.headText + "{flex-direction:column;flex:1;gap:4px;min-width:0;display:flex}" +
			"." + CSS.nameRow + "{align-items:center;gap:8px;min-width:0;display:flex}" +
			"." + CSS.name + "{color:var(--dsw-alias-label-primary);font-size:15px;font-weight:600;line-height:1.4}" +
			"." + CSS.badge + "{color:var(--dsw-alias-label-secondary);border:.5px solid var(--dsw-alias-border-l4);border-radius:999px;font-size:11px;padding:1px 8px}" +
			"." + CSS.desc + "{color:var(--dsw-alias-label-tertiary);font-size:13px;line-height:1.5}" +
			"." + CSS.chevron + "{color:var(--dsw-alias-label-tertiary);flex:none;transition:transform .16s}" +
			"." + CSS.chevronOpen + "{transform:rotate(180deg)}" +
			"." + CSS.body + "{border-top:.5px solid var(--dsw-alias-border-l2);flex-direction:column;gap:12px;margin:0 16px;padding:12px 0;display:flex}" +
			"." + CSS.field + "{display:grid;gap:5px;max-width:420px}" +
			"." + CSS.fieldHead + "{align-items:center;gap:8px;display:flex}" +
			"." + CSS.label + "{color:var(--dsw-alias-label-secondary);font-size:12px;flex:1;min-width:0}" +
			"." + CSS.badges + "{align-items:center;gap:8px;display:inline-flex}" +
			"." + CSS.reset + "{font:inherit;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:0;font-size:12px;padding:0}" +
			"." + CSS.reset + ":hover:not(:disabled){color:var(--dsw-alias-label-primary)}" +
			"." + CSS.input +
			"{color:var(--dsw-alias-label-primary);border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;" +
			"background:var(--dsw-alias-bg-l2,transparent);font:inherit;font-size:13px;padding:5px 8px;max-width:140px}" +
			"." + CSS.input + ":disabled{cursor:default;opacity:.5}" +
			"." + CSS.input + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}" +
			"." + CSS.inputInvalid + "{border-color:var(--dsw-alias-label-error);}" +
			// Pill trigger for the primitives.Menu dropdown (the list itself is
			// styled by the primitive — only the trigger carries tokens here).
			"." + CSS.selector +
			"{color:var(--dsw-alias-label-primary);cursor:pointer;text-align:left;" +
			"border:.5px solid var(--dsw-alias-border-l4);border-radius:6px;" +
			"background:var(--dsw-alias-bg-l2,transparent);font:inherit;font-size:13px;" +
			"align-items:center;justify-content:space-between;gap:6px;min-width:120px;padding:5px 8px;display:inline-flex}" +
			"." + CSS.selector + ":hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}" +
			"." + CSS.selector + ":disabled{cursor:default;opacity:.5}" +
			"." + CSS.selector + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}" +
			"." + CSS.selectorInvalid + "{border-color:var(--dsw-alias-label-error)}" +
			"." + CSS.invalid + "{color:var(--dsw-alias-label-error);margin:0;font-size:12px}" +
			"." + CSS.hint + "{color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:1.5}" +
			"." + CSS.toggleRow + "{align-items:center;gap:8px;max-width:420px;display:flex}" +
			"." + CSS.row + "{display:flex;gap:10px;align-items:center}" +
			"." + CSS.button +
			"{color:var(--dsw-alias-brand-primary);cursor:pointer;background:0 0;border:.5px solid var(--dsw-alias-border-l4);" +
			"border-radius:6px;font:inherit;font-size:12px;padding:4px 12px}" +
			"." + CSS.button + ":disabled{cursor:default;opacity:.5}" +
			"." + CSS.button + ":focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:1px}" +
			"." + CSS.readOnly + "{color:var(--dsw-alias-label-tertiary);margin:0;font-size:12px}" +
			"." + CSS.error + "{color:var(--dsw-alias-label-error);margin:0;font-size:12px;line-height:1.5}";
		var TAG_ID = "@comecaramelos/dsh-ask-before-compact/AskBeforeCompactCard.module.css";
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="' + TAG_ID + '"]') === null) {
			var tag = document.createElement("style");
			tag.dataset.plugin = "@comecaramelos/dsh-ask-before-compact";
			tag.dataset.pluginCss = TAG_ID;
			tag.textContent = css;
			document.head.appendChild(tag);
		}

		// ── locale dictionaries ────────────────────────────────────────────
		var en = {
			title: "Ask before compact",
			description: "Confirm context compaction before it runs; warn at a usage threshold.",
			active: "Active",
			activeHint: "Ask the user before every compaction. Off disables the plugin.",
			timeout: "Confirmation timeout (seconds)",
			timeoutHint: "How long to wait for an answer before the timeout action applies.",
			timeoutInvalid: "Enter a whole number between 1 and 3600.",
			onTimeout: "Action after timeout",
			onTimeoutHint: "Applied when nobody answers before the timeout.",
			onTimeoutCompact: "Compact",
			onTimeoutCancel: "Cancel",
			warnAt: "Warn on usage (%)",
			warnAtHint: "Raise a toast when context usage reaches this percent. 0 disables the warning.",
			warnAtInvalid: "Enter a whole number between 0 and 100.",
			warnAtToast: "Context usage is at {percent}% of the model window.",
			overridden: "Overridden",
			reset: "Reset to default",
			readOnly: "Settings are read-only in this deployment.",
			save: "Save",
			saving: "Saving…",
			discard: "Discard",
			unsaved: "Unsaved",
			saveFailed: "The deployment did not accept these values; they were left for you to correct.",
			expand: "Expand",
			collapse: "Collapse"
		};
		var zh = {
			title: "压缩前询问",
			description: "上下文压缩前征求确认；使用量达到阈值时发出警告。",
			active: "启用",
			activeHint: "每次压缩前询问用户。关闭后插件不生效。",
			timeout: "确认超时（秒）",
			timeoutHint: "等待回答的时长，超时后应用所选动作。",
			timeoutInvalid: "请输入 1 到 3600 之间的整数。",
			onTimeout: "超时后的动作",
			onTimeoutHint: "在超时前无人回答时应用。",
			onTimeoutCompact: "压缩",
			onTimeoutCancel: "取消",
			warnAt: "使用量警告阈值（%）",
			warnAtHint: "上下文使用率达到该百分比时发出提示。0 表示关闭警告。",
			warnAtInvalid: "请输入 0 到 100 之间的整数。",
			warnAtToast: "上下文已使用模型窗口的 {percent}%。",
			overridden: "已覆盖",
			reset: "恢复默认",
			readOnly: "本部署的设置为只读。",
			save: "保存",
			saving: "保存中…",
			discard: "放弃修改",
			unsaved: "未保存",
			saveFailed: "本部署没有接受这些值，已保留供你修改。",
			expand: "展开",
			collapse: "收起"
		};

		// ── field specs ────────────────────────────────────────────────────
		/**
		 * The four section fields. The namespace section is fixed, so the
		 * spec list is the card's whole schema knowledge.
		 */
		var FIELDS = {
			active: { kind: "bool" },
			timeoutSeconds: { kind: "int", min: 1, max: 3600 },
			onTimeout: { kind: "select", options: ["permit", "block"] },
			warnAtPercent: { kind: "int", min: 0, max: 100 }
		};
		var FIELD_ORDER = ["active", "timeoutSeconds", "onTimeout", "warnAtPercent"];

		/**
		 * Parse one integer draft against the field range.
		 * @param text - the staged text.
		 * @param spec - the int field spec.
		 * @returns the value, or null when the draft is not an in-range integer.
		 */
		function parseIntDraft(text, spec) {
			var trimmed = String(text).trim();
			if (trimmed === "") return null; // empty draft is a clear, handled by the caller
			var parsed = Number(trimmed);
			if (!Number.isInteger(parsed) || parsed < spec.min || parsed > spec.max) return null;
			return parsed;
		}

		// ── card controller ────────────────────────────────────────────────
		/**
		 * Stages edits over the `ask-before-compact` settings scope and
		 * writes them on save. Mirrors the stock plugin cards: drafts stay
		 * local, every write is revision-fenced by the scope, and a save
		 * that did not land keeps its drafts.
		 */
		var AskBeforeCompactCardController = class {
			/** @param scope - the bound settings scope for the namespace. */
			constructor(scope) {
				this.scope = scope;
				this.staged = new Map();
				this.saving = false;
				this.failed = false;
				this.disposed = false;
				this.store = clientStore.createSnapshotStore(this.projection());
				this.unsubscribe = scope.subscribe(() => {
					if (!this.disposed) this.publish();
				});
			}
			/** The current section value, or undefined while the scope is not ready. */
			sectionValue() {
				var snapshot = this.scope.getSnapshot();
				return snapshot.status === "ready" ? snapshot.value : void 0;
			}
			/** Whether the user layer currently overrides one field. */
			storedIn(snapshot, field) {
				return snapshot.user != null && Object.prototype.hasOwnProperty.call(snapshot.user, field);
			}
			/** The control display value for one field (staged draft over the section). */
			fieldProjection(field, snapshot) {
				var spec = FIELDS[field];
				var value = snapshot.value != null ? snapshot.value[field] : void 0;
				var staged = this.staged.get(field);
				var invalid = false;
				var raw;
				if (staged !== void 0) {
					raw = staged.raw;
					if (staged.mode === "edit") {
						if (spec.kind === "int") {
							var t = String(raw).trim();
							invalid = t !== "" && parseIntDraft(t, spec) === null;
						} else if (spec.kind === "select") {
							invalid = spec.options.indexOf(raw) === -1;
						}
					}
				} else if (spec.kind === "bool") {
					raw = value === true;
				} else if (spec.kind === "select") {
					raw = typeof value === "string" && spec.options.indexOf(value) !== -1 ? value : spec.options[0];
				} else {
					raw = typeof value === "number" ? String(value) : "";
				}
				return {
					value: value,
					overridden: this.storedIn(snapshot, field),
					raw: raw,
					invalid: invalid,
					dirty: staged !== void 0
				};
			}
			/** Build the card state from scope + drafts. */
			projection() {
				var snapshot = this.scope.getSnapshot();
				var fields = {};
				for (var i = 0; i < FIELD_ORDER.length; i++) {
					fields[FIELD_ORDER[i]] = this.fieldProjection(FIELD_ORDER[i], snapshot);
				}
				return {
					available: snapshot.status === "ready" && snapshot.value !== void 0,
					writable: snapshot.writable === true,
					fields: fields,
					dirty: this.plan().length > 0,
					saving: this.saving,
					failed: this.failed,
					warn: this.warnFrom(snapshot)
				};
			}
			/**
			 * The live warning the host pushes as a toast signal: the served
			 * `lastWarn` payload `{ seq, sessionId, percent }`. `seq` is the
			 * dedupe key — the toast host re-shows only when it advances. When the
			 * host has not warned yet (or the scope is not ready) it is
			 * `{ seq: 0, sessionId: "", percent: 0 }`.
			 */
			warnFrom(snapshot) {
				var served = snapshot.status === "ready" ? snapshot.value : void 0;
				var warn = served != null ? served.lastWarn : void 0;
				if (warn == null || typeof warn.seq !== "number") return { seq: 0, sessionId: "", percent: 0 };
				return {
					seq: warn.seq,
					sessionId: typeof warn.sessionId === "string" ? warn.sessionId : "",
					percent: typeof warn.percent === "number" ? warn.percent : 0
				};
			}
			publish() {
				if (this.disposed) return;
				this.store.set(this.projection());
			}
			/** Stage one control's draft. */
			edit(field, raw) {
				this.staged.set(field, { mode: "edit", raw: raw });
				this.failed = false;
				this.publish();
			}
			/**
			 * Invert the effective Active state and stage it as an explicit draft.
			 * The flip lives here (not in the Switch) so the primitive stays a pure
			 * presentation control; `false` is written as a value, never cleared,
			 * because "off" is a deliberate setting, not "unset".
			 */
			flipActive() {
				var projected = this.fieldProjection("active", this.scope.getSnapshot());
				this.edit("active", projected.raw !== true);
			}
			/** Stage a reset: clear the override on save, showing the base value. */
			resetField(field) {
				var spec = FIELDS[field];
				var baseValue = this.scope.getSnapshot().base != null ? this.scope.getSnapshot().base[field] : void 0;
				var raw;
				if (spec.kind === "bool") raw = baseValue === true;
				else if (spec.kind === "select") raw = typeof baseValue === "string" && spec.options.indexOf(baseValue) !== -1 ? baseValue : spec.options[0];
				else raw = typeof baseValue === "number" ? String(baseValue) : "";
				this.staged.set(field, { mode: "clear", raw: raw });
				this.failed = false;
				this.publish();
			}
			/** Drop every draft. */
			discard() {
				this.staged.clear();
				this.failed = false;
				this.publish();
			}
			/**
			 * Every staged edit a save would write. An entry whose draft the
			 * field does not accept carries no write: the save refuses rather
			 * than dropping the edit.
			 */
			plan() {
				var snapshot = this.scope.getSnapshot();
				var value = snapshot.status === "ready" ? snapshot.value : void 0;
				var plan = [];
				for (var entry of this.staged) {
					const field = entry[0];
					const staged = entry[1];
					const spec = FIELDS[field];
					const current = value != null ? value[field] : void 0;
					if (staged.mode === "clear") {
						if (this.storedIn(snapshot, field)) plan.push({ field: field, run: () => this.clearField(field) });
						continue;
					}
					if (spec.kind === "int") {
						const parsed = parseIntDraft(staged.raw, spec);
						if (parsed === null) {
							if (String(staged.raw).trim() === "") {
								// empty int draft is a clear
								if (this.storedIn(snapshot, field)) plan.push({ field: field, run: () => this.clearField(field) });
								continue;
							}
							plan.push({ field: field, run: void 0 });
							continue;
						}
						if (parsed === current) continue;
						plan.push({ field: field, run: () => this.writeField(field, parsed) });
						continue;
					}
					if (staged.raw === current) continue;
					plan.push({ field: field, run: () => this.writeField(field, staged.raw) });
				}
				return plan;
			}
			/** Clear one field's user-layer override. */
			clearField(field) {
				return this.scope.unset(field).then(() => !this.storedIn(this.scope.getSnapshot(), field));
			}
			/** Write one field, reading the landing back from the user layer. */
			writeField(field, val) {
				return this.scope.set(field, val).then(() => {
					var snapshot = this.scope.getSnapshot();
					return snapshot.user != null && snapshot.user[field] === val;
				});
			}
			/** Write every staged edit; keep drafts when a write did not land. */
			save() {
				var plan = this.plan();
				var writes = plan.flatMap((item) => (item.run === void 0 ? [] : [item.run]));
				if (plan.length === 0 || this.saving || writes.length !== plan.length) return;
				this.saving = true;
				this.failed = false;
				this.publish();
				var chain = Promise.resolve(true);
				for (let i = 0; i < writes.length; i++) {
					const write = writes[i];
					chain = chain.then((landed) => write().then((ok) => landed && ok));
				}
				chain
					.then((landed) => {
						if (landed) this.staged.clear();
						this.saving = false;
						this.failed = !landed;
						this.publish();
					})
					.catch(() => {
						this.saving = false;
						this.failed = true;
						this.publish();
					});
				return chain.catch(() => false);
			}
			/** The face the card's slot registration injects. */
			inject() {
				return {
					hooks: { askBeforeCompactCard: this.store },
					edit: (field, raw) => {
						this.edit(field, raw);
					},
					flipActive: () => {
						this.flipActive();
					},
					resetField: (field) => {
						this.resetField(field);
					},
					discard: () => {
						this.discard();
					},
					save: () => this.save()
				};
			}
			dispose() {
				this.disposed = true;
				this.unsubscribe();
			}
		};

		// ── card component ─────────────────────────────────────────────────
		/** Chevron matching the shell's IconChevronDownOutline14 primitive. */
		var CHEVRON_PATH =
			"M11.8486 5.5L11.4238 5.92383L8.69727 8.65137C8.44157 8.90706 8.21562 9.13382 8.01172 9.29785C7.79912 9.46883 7.55595 9.61756 7.25 9.66602C7.08435 9.69222 6.91565 9.69222 6.75 9.66602C6.44405 9.61756 6.20088 9.46883 5.98828 9.29785C5.78438 9.13382 5.55843 8.90706 5.30273 8.65137L2.57617 5.92383L2.15137 5.5L3 4.65137L3.42383 5.07617L6.15137 7.80273C6.42595 8.07732 6.59876 8.24849 6.74023 8.3623C6.87291 8.46904 6.92272 8.47813 6.9375 8.48047C6.97895 8.48703 7.02105 8.48703 7.0625 8.48047C7.07728 8.47813 7.12709 8.3623 7.35977 8.13383L10.5762 5.07617L11 4.65137L11.8486 5.5Z";

		/**
		 * One numeric field: label, staged text input, hint, invalid state,
		 * and the reset that stages a clear back to the composition base.
		 */
		function IntField(props) {
			var field = props.field;
			var state = props.state;
			var id = "abcc-" + field;
			var invalidKey = field === "timeoutSeconds" ? "timeoutInvalid" : "warnAtInvalid";
			return (0, reactJsx.jsxs)("div", {
				className: CSS.field,
				children: [
					(0, reactJsx.jsxs)("div", {
						className: CSS.fieldHead,
						children: [
							(0, reactJsx.jsx)("label", { className: CSS.label, htmlFor: id, children: props.label }),
							(0, reactJsx.jsxs)("span", {
								className: CSS.badges,
								children: [
									state.overridden
										? (0, reactJsx.jsx)("span", { className: CSS.badge, children: props.t("overridden") })
										: null,
									state.overridden
										? (0, reactJsx.jsx)("button", {
												type: "button",
												className: CSS.reset,
												disabled: !props.writable,
												onClick: () => {
													props.resetField(field);
												},
												children: props.t("reset")
											})
										: null
								]
							})
						]
					}),
					(0, reactJsx.jsx)("input", {
						id: id,
						className: CSS.input + (state.invalid ? " " + CSS.inputInvalid : ""),
						type: "text",
						inputMode: "numeric",
						value: state.raw,
						disabled: !props.writable,
						onChange: (event) => {
							props.edit(field, event.target.value);
						}
					}),
					state.invalid
						? (0, reactJsx.jsx)("p", { className: CSS.invalid, children: props.t(invalidKey) })
						: (0, reactJsx.jsx)("span", { className: CSS.hint, children: props.hint })
				]
			});
		}

		/**
		 * One closed-choice field: label, the shell's `primitives.Menu`
		 * dropdown, hint — plus the reset staging a clear back to the
		 * composition base. Never hand-roll the list: the primitive already
		 * carries the portal, viewport-aware positioning, keyboard handling
		 * and outside-close. The pill trigger is ours; the list is styled by
		 * the primitive.
		 */
		function SelectorField(props) {
			var field = props.field;
			var state = props.state;
			var menuState = react.useState(false);
			var menuOpen = menuState[0];
			var setMenuOpen = menuState[1];
			var disabled = !props.writable;
			return (0, reactJsx.jsxs)("div", {
				className: CSS.field,
				children: [
					(0, reactJsx.jsxs)("div", {
						className: CSS.fieldHead,
						children: [
							(0, reactJsx.jsx)("label", { className: CSS.label, children: props.label }),
							(0, reactJsx.jsxs)("span", {
								className: CSS.badges,
								children: [
									state.overridden
										? (0, reactJsx.jsx)("span", { className: CSS.badge, children: props.t("overridden") })
										: null,
									state.overridden
										? (0, reactJsx.jsx)("button", {
												type: "button",
												className: CSS.reset,
												disabled: disabled,
												onClick: () => {
													props.resetField(field);
												},
												children: props.t("reset")
											})
										: null
								]
							})
						]
					}),
					(0, reactJsx.jsx)(primitives.Menu, {
						open: menuOpen,
						onClose: () => {
							setMenuOpen(false);
						},
						items: props.options,
						selectedId: state.raw,
						onSelect: (id) => {
							// The primitive never closes on its own — the select closes here.
							setMenuOpen(false);
							if (id === state.raw) return;
							props.edit(field, id);
						},
						align: "start",
						portal: true,
						autoFocus: true,
						className: CSS.selectorWrap,
						anchor: (0, reactJsx.jsxs)("button", {
							type: "button",
							className: CSS.selector + (state.invalid ? " " + CSS.selectorInvalid : ""),
							"aria-haspopup": "menu",
							"aria-expanded": menuOpen,
							disabled: disabled,
							onClick: () => {
								setMenuOpen(!menuOpen);
							},
							children: [
								(0, reactJsx.jsx)("span", {
									className: CSS.selectorText,
									children: state.raw
								}),
								(0, reactJsx.jsx)("svg", {
									width: 14,
									height: 14,
									viewBox: "0 0 14 14",
									fill: "none",
									xmlns: "http://www.w3.org/2000/svg",
									children: (0, reactJsx.jsx)("path", { d: CHEVRON_PATH, fill: "currentColor" })
								})
							]
						})
					}),
					(0, reactJsx.jsx)("span", { className: CSS.hint, children: props.hint })
				]
			});
		}

		/**
		 * Render the Ask before compact card. Collapsible like the stock
		 * plugin cards: the header is a disclosure button (closed by
		 * default) and the four controls live in the body.
		 * @param props - locale copy, the card snapshot hook, and its form actions.
		 * @returns the card, or nothing until the namespace is served.
		 */
		function AskBeforeCompactCard(props) {
			var t = props.t;
			var state = props.useAskBeforeCompactCard((snapshot) => snapshot);
			var openState = react.useState(false);
			var open = openState[0];
			var setOpen = openState[1];
			var bodyId = react.useId();
			if (!state.available) return null;
			var disabled = !state.writable;
			var f = state.fields;
			return (0, reactJsx.jsx)("li", {
				className: CSS.card + (open ? " " + CSS.cardOpen : ""),
				children: [
					(0, reactJsx.jsxs)("button", {
						type: "button",
						className: CSS.header,
						"aria-expanded": open,
						"aria-label": t(open ? "collapse" : "expand") + ": " + t("title"),
						"aria-controls": bodyId,
						onClick: () => {
							setOpen(!open);
						},
						children: [
							(0, reactJsx.jsxs)("span", {
								className: CSS.headText,
								children: [
									(0, reactJsx.jsxs)("div", {
										className: CSS.nameRow,
										children: [
											(0, reactJsx.jsx)("span", { className: CSS.name, children: t("title") }),
											state.dirty
												? (0, reactJsx.jsx)("span", { className: CSS.badge, children: t("unsaved") })
												: null
										]
									}),
									(0, reactJsx.jsx)("span", { className: CSS.desc, children: t("description") })
								]
							}),
							(0, reactJsx.jsx)("svg", {
								width: 14,
								height: 14,
								className: CSS.chevron + (open ? " " + CSS.chevronOpen : ""),
								viewBox: "0 0 14 14",
								fill: "none",
								xmlns: "http://www.w3.org/2000/svg",
								children: (0, reactJsx.jsx)("path", { d: CHEVRON_PATH, fill: "currentColor" })
							})
						]
					}),
					open
						? (0, reactJsx.jsxs)("div", {
								id: bodyId,
								className: CSS.body,
								children: [
									!state.writable
										? (0, reactJsx.jsx)("p", { className: CSS.readOnly, role: "status", children: t("readOnly") })
										: null,
									(0, reactJsx.jsxs)("div", {
										className: CSS.toggleRow,
										children: [
											(0, reactJsx.jsx)(primitives.Switch, {
												checked: f.active.raw === true,
												label: t("active"),
												disabled: disabled,
												onChange: () => {
													props.flipActive();
												}
											}),
											f.active.overridden
												? (0, reactJsx.jsx)("span", { className: CSS.badge, children: t("overridden") })
												: null,
											f.active.overridden
												? (0, reactJsx.jsx)("button", {
														type: "button",
														className: CSS.reset,
														disabled: disabled,
														onClick: () => {
															props.resetField("active");
														},
														children: t("reset")
													})
												: null
										]
									}),
									(0, reactJsx.jsx)("span", { className: CSS.hint, children: t("activeHint") }),
									(0, reactJsx.jsx)(IntField, {
										field: "timeoutSeconds",
										state: f.timeoutSeconds,
										label: t("timeout"),
										hint: t("timeoutHint"),
										writable: state.writable,
										t: t,
										edit: props.edit,
										resetField: props.resetField
									}),
									(0, reactJsx.jsxs)("div", {
										className: CSS.field,
										children: [
											(0, reactJsx.jsxs)("div", {
												className: CSS.fieldHead,
												children: [
													(0, reactJsx.jsx)("label", { className: CSS.label, children: t("onTimeout") }),
													(0, reactJsx.jsxs)("span", {
														className: CSS.badges,
														children: [
															f.onTimeout.overridden
																? (0, reactJsx.jsx)("span", { className: CSS.badge, children: t("overridden") })
																: null,
															f.onTimeout.overridden
																? (0, reactJsx.jsx)("button", {
																		type: "button",
																		className: CSS.reset,
																		disabled: disabled,
																		onClick: () => {
																			props.resetField("onTimeout");
																		},
																		children: t("reset")
																	})
																: null
														]
													})
												]
											}),
											(0, reactJsx.jsx)(SelectorField, {
												field: "onTimeout",
												state: f.onTimeout,
												options: [
													{ id: "permit", label: t("onTimeoutCompact") },
													{ id: "block", label: t("onTimeoutCancel") }
												],
												writable: state.writable,
												t: t,
												edit: props.edit,
												resetField: props.resetField
											}),
											(0, reactJsx.jsx)("span", { className: CSS.hint, children: t("onTimeoutHint") })
										]
									}),
									(0, reactJsx.jsx)(IntField, {
										field: "warnAtPercent",
										state: f.warnAtPercent,
										label: t("warnAt"),
										hint: t("warnAtHint"),
										writable: state.writable,
										t: t,
										edit: props.edit,
										resetField: props.resetField
									}),
									(0, reactJsx.jsxs)("div", {
										className: CSS.row,
										children: [
											(0, reactJsx.jsx)("button", {
												type: "button",
												className: CSS.button,
												disabled: disabled || !state.dirty || state.saving,
												onClick: () => {
													props.save();
												},
												children: state.saving ? t("saving") : t("save")
											}),
											(0, reactJsx.jsx)("button", {
												type: "button",
												className: CSS.button,
												disabled: !state.dirty,
												onClick: () => {
													props.discard();
												},
												children: t("discard")
											}),
											state.failed
												? (0, reactJsx.jsx)("p", { className: CSS.error, role: "status", children: t("saveFailed") })
												: null
										]
									})
								]
							})
						: null
				]
			});
		}

		// ── plugin body ────────────────────────────────────────────────────
		/**
		 * The id of the session currently open in the GUI, or "" when the
		 * sessions store is not ready yet (treated as "no filter" below).
		 * @param sessions - the browser sessions service.
		 * @returns the active session id.
		 */
		function useCurrentSessionId(sessions) {
			return react.useSyncExternalStore(
				function (subscribe) {
					if (!sessions || !sessions.list || typeof sessions.list.subscribe !== "function") return function () {};
					return sessions.list.subscribe(function () {
						subscribe();
					});
				},
				function () {
					if (!sessions || !sessions.list || typeof sessions.list.getSnapshot !== "function") return "";
					try {
						var value = sessions.list.getSnapshot().current;
						return value == null ? "" : String(value);
					} catch (error) {
						return "";
					}
				},
				function () {
					return "";
				}
			);
		}

		/**
		 * Warning-toast host. It subscribes to the card controller's store (for
		 * the live warn signal) and to `sessions` (for the open session id) and
		 * mounts through `react-dom/client` in its own body-level root, because
		 * the card slot only renders while Settings is open — a usage crossing
		 * while the user is anywhere else in the app must be announced at once.
		 * The Toast primitive portals itself to the document body and dismisses
		 * on its own timer.
		 *
		 * A toast appears only when the served `seq` advances past the baseline
		 * first observed on mount, so opening the GUI never replays a warning
		 * the host pushed earlier. The host pushes crossings for every session;
		 * the toast shows only for the one currently open.
		 */
		function AskBeforeCompactToastHost(props) {
			var t = props.t;
			var sessions = props.sessions;
			var snapshot = react.useSyncExternalStore(props.store.subscribe, props.store.getSnapshot);
			var warn = snapshot && snapshot.warn ? snapshot.warn : { seq: 0, sessionId: "", percent: 0 };
			var current = useCurrentSessionId(sessions);
			var shown = react.useRef(void 0);
			var noticeState = react.useState(null);
			var notice = noticeState[0];
			var setNotice = noticeState[1];
			react.useEffect(function () {
				if (warn.seq <= 0) return;
				// First sighting records the baseline: a warning the host pushed
				// before this view opened must not fire.
				if (shown.current === void 0) {
					shown.current = warn.seq;
					return;
				}
				if (warn.seq <= shown.current) return;
				shown.current = warn.seq;
				var matchesCurrent =
					current === "" ||
					current === warn.sessionId ||
					(current.length > 0 && String(current) === String(warn.sessionId));
				if (matchesCurrent) setNotice({ seq: warn.seq, percent: warn.percent });
			}, [warn.seq, warn.sessionId, current]);
			if (notice === null) return null;
			return (0, reactJsx.jsx)(primitives.Toast, {
				text: t("warnAtToast", { percent: notice.percent }),
				icon: (0, reactJsx.jsx)(primitives.IconWarningOutline16, {}),
				onDone: function () {
					setNotice(null);
				}
			}, notice.seq);
		}

		/**
		 * Mount the configuration card.
		 * @param ctx - the browser plugin context.
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(LOCALE_NS, { en, zh }), "ask-before-compact: dictionaries");
			var scope = ctx.settingsScope.bind({ namespace: NS });
			var controller = new AskBeforeCompactCardController(scope);
			ctx.effect(
				() => () => controller.dispose(),
				"ask-before-compact: card controller"
			);
			// Warn-toast host: an always-mounted body root, so a usage crossing
			// that lands while the user is anywhere else in the app is announced
			// immediately, not only after they open Settings.
			var translate = ctx.locale.bind(LOCALE_NS);
			ctx.effect(
				() => {
					var toastHost = document.createElement("div");
					toastHost.dataset.plugin = "@comecaramelos/dsh-ask-before-compact";
					toastHost.dataset.pluginToasts = "1";
					document.body.appendChild(toastHost);
					var toastRoot = reactDomClient.createRoot(toastHost);
					toastRoot.render(
						react.createElement(AskBeforeCompactToastHost, {
							store: controller.store,
							sessions: ctx.sessions,
							t: translate
						})
					);
					return () => {
						toastRoot.unmount();
						toastHost.remove();
					};
				},
				"ask-before-compact: warn-toast host"
			);
			ctx.slots.inject("settings.plugin.item", () =>
				ctx.slots.register(
					{
						name: "settings.plugin.item",
						key: NS,
						locale: LOCALE_NS,
						inject: () => controller.inject()
					},
					AskBeforeCompactCard
				)
			);
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
