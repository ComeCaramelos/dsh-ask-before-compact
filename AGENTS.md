# AGENTS.md

Ask-before-compact plugin for DeepSeek Harness (DSH): confirmation before
context compaction + warn-on-%, configurable from a UI card.

## Layout

- `lib/index.js` — host half (ESM, `main`). Exports `name`, `inject`
  (`sessionProjections`, `userQuestions`), `Config`/`SettingsSchema`/
  `SectionSchema`/`LastWarnSchema` (schemastery), `apply(ctx, config)` (also
  registers the host `agent/pre-step` listener that drives the usage warning
  for every preset), `createController(ctx, configOf, publishWarn)` (pure —
  tests drive the decision table through it; the optional publisher records the
  crossing), and the constants `SETTINGS_NAMESPACE` / `SERVICE_NAME` /
  `PLUGIN_ID` / `WARN_ESCALATION_STEP`.

Usage percent comes from the `contextPressure` projection — **not**
`tokenMeter.measure()` (which read ~12 points above the GUI meter and quoted a
reading the user could not reconcile). Warnings are **published** (host→browser
toast), never injected as a message: `maybeWarn` decides the crossing,
`apply`'s publisher writes the base-layer `lastWarn` payload and bumps the
user-layer `warnNonce` to force the only live host→browser channel
(`settings/document-updated`). `Config`/`SectionSchema` include `lastWarn` and
`warnNonce`, both host-owned (never rendered by the card).
- `lib/engine.js` — `AskBeforeCompactEngine extends BasicCompactionEngine`
  (`./engine` export). Wraps `compactIfNeeded` + `compactNow` only; inherits
  all stock machinery; registers NO listeners of its own (warn-on-% lives on
  the host plane so it covers every preset). `static inject` = stock inject
  + `askBeforeCompact`. Carries **no row config** and no `Config` of its own —
  thresholds, `retainRatio`, retry caps and the summarizer all resolve through
  the stock `resolveConfig` exactly as `compaction-basic` does (behavior knobs
  live in the `ask-before-compact` settings namespace served by the host half,
  so they stay runtime-editable instead of preset-pinned).
- `lib/client.js` — browser half (CJS **factory bundle**, `./client`
  export). Hand-written, not built: `window.__ModuleLoader__.load({ id,
  factory: (require) => … })`; requires only baseline modules (`react`,
  `react/jsx-runtime`, `@deepseek-ai/dsh-client-store`,
  `@deepseek-ai/dsh-client-ui-primitives`, `react-dom/client`). No bundler
  step, no ESM imports from `lib/` — inline shared logic. Besides the Settings
  card it mounts a body-level **warning-toast host** through
  `react-dom/client` (so a crossing shows even when Settings is closed); it
  dedupes on the served `lastWarn.seq` and draws the toast only for the
  currently-open session. `inject` =
  `["slots", "locale", "settingsScope", "sessions"]`.
- `lib/skills.js` — bundled-skills provider (`./skills` export). Ships
  `skills/agents-md-compactor-skill.md` inside the bundle and registers it on
  `ctx.skills` as one host-plane provider (`ask-before-compact-skills`) from
  inside the host half's `apply` via `ctx.inject(["skills"], …)` — an
  **optional** dependency (never added to `inject`; a registry-less host
  simply never fires the callback). Self-contained loader: parses the
  frontmatter subset inline and inlines `BUNDLED_SKILL_RANK` (600) because
  `yaml` / `@deepseek-ai/dsh-skill` do not resolve from this package alone.
  Lazy cached load: `list()` catalogues, `get()` returns the body.
- `cordis.patch.yml` — host row (`ask-before-compact`) with the four
  defaults. Applied as a bundle patch via `dsh.bundle.patch` in
  `package.json`.
- `presets/ask-before-compact/` — `preset.yml` + `agent.cordis.yml` (a copy
  of stock `standard` with exactly one row swapped).
- `test/*.test.mjs` — `node --test`, plain `node:assert/strict`, fake ctx
  objects (no live composition).
- `docs/SPEC.md` — service contract, realm analysis, failure philosophy.

## What the preset overrides (and what it does not)

The preset changes **which** compaction backend is mounted, never **how**
compaction runs. Against stock `standard` the diff is exactly the two lines of
the swap (verify: strip comments, `diff` → one hunk):

```diff
-    - id: compaction-basic
-      name: '@deepseek-ai/dsh-compaction-basic'
+    - id: compaction-ask-before-compact
+      name: '@comecaramelos/dsh-ask-before-compact/engine'
```

Everything else holds: the `command-compact` and `tool-result-pruner` rows, the
`isolate: { compaction, toolResultPruner }` group, and the other 30 rows of the
composition (`grep -cE "^\s*- id: " standard/agent.cordis.yml` → 31). Nothing is
disabled or added.

Because the stock automatic machinery lives in the **parent** constructor
(`_registerAutomaticCompaction()`, registered when `config.auto` holds) and its
listeners re-dispatch onto `this.compactIfNeeded` — the one hook
`dsh-compaction-basic` documents as overridable — the gate is honored at event
time without registering anything. Two consequences worth knowing before
touching this file:

- **The engine adds zero listeners.** If a future change registers its own
  `agent/pre-step` here, automatic compaction runs twice: once through the
  stock listener (gated) and once through yours.
- **Only two public entry points exist.** `compactIfNeeded`/`compactNow` (plus
  `summarize`) are the documented hooks; this engine overrides the first two as
  *method* overrides, not config. If upstream renames or re-signatures them the
  subclass drifts silently — re-read the installed
  `dsh-compaction-basic/lib/index.js` after any harness bump.

Per trigger, what a `block` decision actually costs:

| Trigger | Blocked path | Visible outcome |
| --- | --- | --- |
| `pressure` | `compactIfNeeded` returns `null` | turn continues, as if no pressure was found |
| `context-overflow` | returns `null`; `replaceGeneration` does not advance, so the stock listener returns `next()` | the original provider `CONTEXT_WINDOW_EXCEEDED` error surfaces |
| `manual` (`/compact`) | throws `ManualCompactionError("cancelled", …)` | the command renders "Compaction cancelled." |

The overflow path is the subtle one: because no compaction moved the surface
generation, the stock recovery listener declines to retry rather than looping —
blocking does **not** burn `maxOverflowRetries`, it just hands the provider
error back. Keep this table aligned with the `engine.test.mjs` decision
assertions and `docs/SPEC.md`.

## Hard constraints (do not break)

- **The engine must stay preset-mounted.** Compaction is agent-plane: the
  stock `standard` preset mounts `compaction-basic` inside a `cordis:group`
  with `isolate: { compaction: true, toolResultPruner: true }`. A host row
  cannot replace a realm-isolated service; the swap happens in the preset.
  The host row must NOT disable `compaction-basic` (double-compaction on
  web).
- **`askBeforeCompact` is a single host-plane registration**
  (`ctx.provide` from the unisolated host row). The preset realm resolves it
  the same way stock rows resolve host-plane `tokenMeter`/`llm`/`sessions`
  (unisolated names inherit the host-root symbol). A second provider throws
  at boot.
- **Fail-open.** Every "cannot ask" path (no answerer, `CALLER_NOT_LIVE`,
  aborted caller signal, measurement failure) must `permit` and log — never
  wedge a session. Only an answer naming the table entry whose `decision` is
  `block` (today `Cancel`), or the user's `onTimeout: block` choice, stops
  compaction. Keep the decision table in `confirm()` in lockstep with
  `docs/SPEC.md` and `test/host.test.mjs`.
- **The question's options live in `CONFIRM_OPTIONS`** (`lib/index.js`) —
  `{ label, description, decision }` rows drawn in order as the ask payload;
  the answer maps through the table, and a selection naming none of the labels
  is a `block`. The internal `permit`/`block` vocabulary stays host-side (it is
  what the service returns and what `onTimeout` stores), never a GUI label. Do
  NOT declare a presentation `intent`: the live `userQuestions` surface claims
  only the binary `plan-review` intent (at most two options), so a claim would
  stop working the moment a third option is appended; the generic option list
  keeps rendering every entry.
- **Fixed identifiers**: namespace/slot key `ask-before-compact`, service
  `askBeforeCompact`, locale ns `askBeforeCompact`, hook prop
  `useAskBeforeCompactCard`, plugin id tag `ask-before-compact`, bundled
  skill provider name `ask-before-compact-skills`.
- **schemastery has no `z.enum`/`.optional`** — closed unions are unions of
  `z.const`; every field carries a `.default` so the resolved snapshot is
  always complete.
- The `preset/agent.cordis.yml` diff vs stock `standard` must remain exactly
  the two-line compaction swap (verify: `diff` after stripping comments; see
  *What the preset overrides* for what the swap does and does not change).

## Client-bundle gotchas (cost real debugging time)

- The factory bundle is CJS-flavored with `var` everywhere — **closures that
  escape the loop must bind per-iteration**: `plan()`'s `run` closures
  capture `field`/`parsed`, and `save()`'s promise chain captures the write
  function. `var` loop variables late-bind; use `const`/`let` inside the
  loop body (all three bugs were found by `test/client.test.mjs`).
- The snapshot store is `this.store` (instance property) — do NOT name a
  method `store` on the same class; the property shadows the prototype
  method and the plan's `run` closures explode with "not a function".
  Writers are `writeField` / `clearField`.
- `save()` returns the (catch-tail) promise — the slot face must return it
  (`save: () => this.save()`) or callers await `undefined`.
- React 18 `reactJsx.jsx(type, props)` needs the props object even for
  prop-less elements; children go inside `props.children`.
- Card renders only when its slot key matches a served settings namespace;
  registration is unconditional, rendering is keyed. Closed by default
  (stock pattern) — the render smoke test can only assert the header.

## Test conventions

- Host tests use a fake ctx (`sessionProjections.snapshot`, `userQuestions.ask`,
  `logger`, `settings.installSection` + `mutate`, `provide`, `inject`, `on`).
  Usage comes from a fake `contextPressure` projection (window/tokens drive it);
  sentinel `makeCtx({ window: null })` = no projection yet (usage reads null).
  Warnings are captured through `createController(ctx, source, publishWarn)`'s
  third argument — never through `agent.inject`.
- Engine tests spy the parent by temporarily swapping
  `BasicCompactionEngine.prototype.compactIfNeeded`/`compactNow` (restored
  in `finally`) — no live composition needed. One test instantiates the
  engine with a capturing fake ctx (`auto: false` disables the stock
  listeners; `reflect.provide` satisfies the Service base) to prove the
  subclass registers nothing of its own.
- Client test materializes the factory through a `window.__ModuleLoader__`
  stub + dynamic `import()` (set `globalThis.window` before the import),
  stubs `@deepseek-ai/dsh-client-store`, `@deepseek-ai/dsh-client-ui-primitives`,
  and `react-dom/client` (a `createRoot` that records mounts) plus a
  `globalThis.document` stub, drives the card through the injected slot face,
  and renders with `react-dom/server`.
- The `abortingAskImpl` fake mirrors the real Web answerer: it rejects with
  `code: "ASK_ABORTED"` only when the ask signal aborts.

## Deployment (live web profile — WSL)

- The live profile `~/.dsh/profiles/web` is a **pnpm tree on a Windows
  mount**: never `npm`/`pnpm install` inside it (breaks node_modules,
  triggers a 10–30 min re-link). Add a `file:` dependency to its
  `package.json` + `dsh.profile.bundles`, then **symlink** the repo into
  `node_modules/@comecaramelos/`.
- Presets: copy `presets/ask-before-compact/` into `~/.dsh/.agent-presets/`
  (the user preset root). Re-copy after editing the source.
- **Never restart the running `dsh web`** — deploy by file edit + symlink
  and let the user restart the GUI.
- Verify without touching the live profile: the isolated `DSH_HOME`
  fixture recipe in `README.md` (`--dump-config` + a `--port 0` boot).
