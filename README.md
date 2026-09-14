# @comecaramelos/dsh-ask-before-compact

DSH plugin that **asks the user before the context of a session is
compacted**, with an optional warning when context usage crosses a threshold.

- Before every compaction — automatic (pressure / context-overflow) or manual
  (`/compact`) — the Web GUI asks what you want to do:
  *Context is at 84% of the model window. What do you want to do?* with
  **Compact** (continue) / **Cancel** (skip this compaction). The options come
  from the `CONFIRM_OPTIONS` table in `lib/index.js`, so more can be offered
  later by appending one row there — the payload and the answer mapping both
  follow the table.
- If nobody answers before the configured timeout, the configured action
  applies (default **Compact**, or **Cancel**).
- Optionally, a **toast** appears (`Context usage is at 75% of the model
  window.`) once usage crosses a configured percent — re-warned at most every
  10 points, re-armed when usage drops back below the threshold. The toast
  quotes the **same percent the context meter shows** (the live
  `contextPressure` projection), so it never disagrees with the number on
  screen.
- Everything is configurable from a card in *Settings → Plugins → Plugin
  configuration*:

  | Field | Type | Default | Meaning |
  | --- | --- | --- | --- |
  | **Active** | switch | on | ask before every compaction |
  | **Confirmation timeout (seconds)** | int 1–3600 | 30 | wait before the timeout action applies |
  | **Action after timeout** | Compact / Cancel | Compact | what happens when nobody answers (`onTimeout`: `permit` / `block`) |
  | **Warn on usage (%)** | int 0–100 | 70 | usage % that raises the warning toast (0 = off) |

## How it works

- The **host half** (`lib/index.js`, one profile row) serves the
  `ask-before-compact` settings namespace, publishes the `askBeforeCompact`
  service, and registers the `agent/pre-step` listener that drives the
  **usage warning**. It is mounted by the profile bundle in every surface
  (web or TUI); on its own it warns but never blocks.
- The **browser half** (`lib/client.js`) renders the Settings card and a
  body-level **warning toast host**: the host pushes each usage crossing into
  the settings namespace (the only live host→browser channel), and the toast
  host — mounted so it shows even when Settings is closed — draws the toast for
  the session you have open.
- The **engine half** (`lib/engine.js`) extends the stock
  `@deepseek-ai/dsh-compaction-basic` backend and wraps only the two decision
  points (`compactIfNeeded`, `compactNow`); the stock machinery — pressure
  detection, overflow recovery, compaction lock, cache-reusing summarizer —
  is inherited untouched.
- The **usage warning works in every session** of the profile: it lives on
  the host plane and sees every agent of every preset.
- The **confirmation gate** is preset-bound: because compaction is mounted
  **per agent preset** (an isolated realm in the stock `standard` preset),
  the engine activates only for sessions that use the
  **`ask-before-compact` agent preset** (shipped with the plugin): a copy of
  `standard` with exactly one row swapped. Select the preset when creating a
  session (or set it as default). Sessions on other presets still get the
  warning, but compact without asking.
- **Fail-open policy**: when the question cannot be asked (headless surface,
  browser disconnected, dead agent), the compaction **proceeds** and the
  event is logged — a session must never wedge on a confirmation it cannot
  get. Only answering **Cancel** — or a custom/empty answer that names none of
  the offered options — (or your `onTimeout: block` choice) stops compaction.
- The package also **ships one bundled skill** — `agents-md-compactor` (a
  Git-aware compactor for `AGENTS.md` files). It is registered as the
  `ask-before-compact-skills` provider whenever the host carries a skill
  registry (every standard composition does), so it appears in the skill
  catalog of every agent of every preset with no config and no install step.
  Registration is inert on a host without a registry (and a broken bundle
  file only degrades discovery) — like the rest of the plugin it never
  touches compaction.

## Bundled skill: `agents-md-compactor`

The plugin carries the skill file inside the published bundle
(`skills/agents-md-compactor-skill.md`) and publishes it through the host
skill registry (`lib/skills.js`) rather than the user's skill roots, so the
skill travels with the plugin. Its frontmatter is the source of truth for
name/description, parsed with the same YAML shape the filesystem provider
accepts; loading is lazy (catalogued without reading the body until the
skill is invoked).

It compacts `AGENTS.md` files in Git repositories while keeping only the
operational instructions an agent needs, delegating historical or
recoverable context to Git. Analysis mode proposes, application mode edits.

An `agents-md-compactor` skill you install in a scanned root (project or user
directories) **wins over the bundled copy** — same merge rule as the
filesystem provider's bundled roots.

## Install (web surface)

The live deployment in this workspace is a WSL pnpm profile — the two
hard rules apply (see `AGENTS.md`): never `npm/pnpm install` inside the live
profile, and no `dsh web` restart from here.

1. Add the plugin as a `file:` dependency of the profile and add it to
   `dsh.profile.bundles` in `~/.dsh/profiles/web/package.json`:

   ```json
   "dependencies": {
     "@comecaramelos/dsh-ask-before-compact": "file:/home/roberto/dev/dsh/dsh-ask-before-compact"
   },
   "dsh": { "profile": { "bundles": [ "...", "@comecaramelos/dsh-ask-before-compact" ] } }
   ```

2. Symlink it into the profile (no install step):

   ```sh
   ln -s /home/roberto/dev/dsh/dsh-ask-before-compact \
     ~/.dsh/profiles/web/node_modules/@comecaramelos/dsh-ask-before-compact
   ```

3. Install the agent preset (one-time copy; edit the source dir in the repo,
   re-copy to update):

   ```sh
   mkdir -p ~/.dsh/.agent-presets
   cp -r presets/ask-before-compact ~/.dsh/.agent-presets/
   ```

4. Restart the Web GUI yourself (the running process keeps its old bundle
   until then).

The card appears in *Settings → Plugins → Plugin configuration* as soon as
the new process serves it; existing sessions keep their preset, new ones can
select **Ask before compact**.

### Non-web surfaces (TUI / headless)

No UI means no answerer, so the plugin stays fail-open there — useful only
as a no-op. If you run a surface with a live answerer and want the gate
without switching presets, copy the stock `standard` preset to your user
preset dir and swap the two lines of the `compaction` group:

```yaml
    - id: compaction-basic
      name: '@deepseek-ai/dsh-compaction-basic'
```

→

```yaml
    - id: compaction-ask-before-compact
      name: '@comecaramelos/dsh-ask-before-compact/engine'
```

(do not also disable `compaction-basic` in the same composition — two
compaction backends double-compact).

## Develop

```sh
npm install        # in this directory
npm test           # node --test: host decision table, engine gating, client card
```

- `test/host.test.mjs` — the `confirm` decision table, `usagePercent`,
  `maybeWarn` thresholds, `apply` wiring (settings namespace, provided
  service, host `agent/pre-step` warning listener), schema validation.
- `test/engine.test.mjs` — gating of the stock backend (spied parent),
  `ManualCompactionError` on manual block, and that the engine registers no
  listeners of its own.
- `test/client.test.mjs` — the factory bundle via a `window.__ModuleLoader__`
  stub: controller staging/save/reset/discard and a render smoke test.
- `test/skills.test.mjs` — the bundled-skill frontmatter parser, the shipped
  file, provider `list`/`get` over a scratch file, broken-file failure; the
  host tests additionally cover apply-side registration (with and without a
  skill registry).
- `docs/SPEC.md` — full design: service contract, realm analysis, failure
  philosophy.

Isolated boot check (no live profile involved):

```sh
rm -rf /tmp/dsh-abc-home
mkdir -p /tmp/dsh-abc-home/profiles/verify/node_modules/@comecaramelos
ln -s $PWD /tmp/dsh-abc-home/profiles/verify/node_modules/@comecaramelos/dsh-ask-before-compact
printf '%s\n' '{' '  "name": "dsh-profile-verify", "private": true,' \
  '  "dependencies": { "@comecaramelos/dsh-ask-before-compact": "file:'$PWD'" },' \
  '  "dsh": { "profile": { "bundles": [' \
  '    "@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app",' \
  '    "@comecaramelos/dsh-ask-before-compact" ] } }' '}' \
  > /tmp/dsh-abc-home/profiles/verify/package.json
echo '[]' > /tmp/dsh-abc-home/profiles/verify/cordis.yml
echo '[]' > /tmp/dsh-abc-home/profiles/verify/cordis.patch.yml
DSH_HOME=/tmp/dsh-abc-home dsh --profile verify --dump-config | grep -A5 ask-before-compact
```
