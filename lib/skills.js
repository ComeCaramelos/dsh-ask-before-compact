/**
 * @comecaramelos/dsh-ask-before-compact — bundled skills provider.
 *
 * The plugin ships one bundled skill (`agents-md-compactor`, a Git-aware
 * compactor for AGENTS.md files) alongside the compaction gate itself. The
 * skill file lives inside the published bundle at
 * `skills/agents-md-compactor-skill.md`; its YAML frontmatter is the single
 * source of truth for `name` / `description` / `whenToUse`, exactly like the
 * files the filesystem provider discovers.
 *
 * Registration is one host-plane provider on `ctx.skills`
 * ({@link BUNDLED_PROVIDER_NAME}), mounted from the host half's `apply`. It
 * needs no realm and no preset — the skill registry lives in the host
 * composition, so every agent of every preset sees the catalog entry.
 *
 * The loader is self-contained on purpose: `yaml` and `@deepseek-ai/dsh-skill`
 * are not resolvable from this package alone, so the frontmatter subset is
 * parsed here and the bundled rank is inlined ({@link BUNDLED_SKILL_RANK}).
 * A malformed or unreadable file is a provider DISCOVERY failure: the
 * registry logs it and keeps every other catalog entry; the plugin never
 * fails and compaction is never affected (fail-open).
 */
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** Provider name registered on the host skill registry. */
export const BUNDLED_PROVIDER_NAME = "ask-before-compact-skills";

/** Source label reported for every candidate contributed by this provider. */
export const BUNDLED_SOURCE = "bundled";

/**
 * Rank of bundled roots in the merged catalog. Kept equal to the value
 * `@deepseek-ai/dsh-skill` exports as `BUNDLED_SKILL_RANK` (and used by
 * `dsh-skill-filesystem` for `bundledSkillDir` and by `dsh-skill-badge`):
 * below every scanned root, so a local or user `agents-md-compactor` skill
 * wins over the bundled copy.
 */
export const BUNDLED_SKILL_RANK = 600;

/** The bundled skill file, resolved relative to the published package. */
export const SKILL_URL = new URL("../skills/agents-md-compactor-skill.md", import.meta.url);

/** Both invocation surfaces open, matching a plain `SKILL.md` file. */
const DEFAULT_INVOCATION = { modelInvocable: true, userInvocable: true };

/** One line of frontmatter: `key: value`, or a `key:` opener for a scalar block. */
const FRONTMATTER_LINE = /^(?<indent>[ ]*)(?<key>[A-Za-z][A-Za-z0-9_-]*)[ ]*:(?<rest>[ ]*(?<inline>.*?))?[ ]*$/;
/** Block-scalar openers on a frontmatter value: `|`, `>`, and chomping/-fold variants. */
const BLOCK_SCALAR = /^[|>][-+]?[0-9]*$/;

/**
 * Parse the YAML subset a skill frontmatter needs: plain `key: value` pairs
 * (quotes optional), block scalars (`key: |` / `key: >` indented blocks,
 * including the folded-`>` line joins a folded description relies on), and
 * `#` comments. Throws on anything else — a duplicate key, a non-scalar
 * value, or an unquoted value spanning more than a line.
 *
 * @param text - the raw frontmatter block (no `---` fences).
 * @returns a plain object mapping each key to its string value.
 */
export function parseFrontmatter(text) {
	const lines = text.split(/\r?\n/);
	const data = Object.create(null);
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().length === 0 || line.trim().startsWith("#")) continue;
		const match = FRONTMATTER_LINE.exec(line);
		if (match === null || match.groups.indent.length > 0) throw new Error(`unsupported frontmatter line: ${line}`);
		const key = match.groups.key;
		if (key in data) throw new Error(`duplicate frontmatter key: ${key}`);
		const inline = match.groups.rest?.trim() ?? "";
		if (inline.length > 0 && !BLOCK_SCALAR.test(inline)) {
			data[key] = unquoteScalar(inline, key);
			continue;
		}
		const blockIndent = inline.startsWith("|") ? "literal" : inline.startsWith(">") ? "folded" : null;
		if (blockIndent === null) throw new Error(`frontmatter key "${key}" requires a scalar value`);
		const block = readBlock(lines, i + 1, blockIndent === "folded");
		i = block.next;
		data[key] = block.value;
	}
	return data;
}

/**
 * Read one indented block scalar starting at `index`, returning its joined
 * value and the first line index past the block.
 */
function readBlock(lines, index, folded) {
	const parts = [];
	let i = index;
	for (; i < lines.length; i++) {
		const line = lines[i];
		if (line.trim().length === 0) {
			parts.push("");
			continue;
		}
		if (!/^[ \t]/.test(line)) break;
		parts.push(line.replace(/^ +/, ""));
	}
	// Trailing blank lines inside the block carry no value.
	while (parts.length > 0 && parts[parts.length - 1] === "") parts.pop();
	if (folded) for (let j = 1; j < parts.length; j++) if (parts[j] !== "" && parts[j - 1] !== "") parts[j] = " " + parts[j];
	else if (parts[j - 1] === "") parts[j - 1] = "\n";
	return { value: folded ? parts.join("") : parts.join("\n"), next: i - 1 };
}

/** Strip surrounding quotes from an inline scalar value. */
function unquoteScalar(value, key) {
	const first = value[0];
	if ((first === '"' || first === "'") && value[value.length - 1] === first && value.length > 1) {
		return value.slice(1, -1);
	}
	if (first === "#" || first === "{") throw new Error(`frontmatter key "${key}" value must be a plain string`);
	return value;
}

/**
 * Split one skill file into `{ data, body }`. Throws when the file has no
 * leading frontmatter block or its fields do not parse.
 * @param text - raw file content.
 * @returns the parsed frontmatter object and the trimmed body.
 */
export function parseSkillFile(text) {
	const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(text);
	if (match === null) throw new Error("missing YAML frontmatter");
	return { data: parseFrontmatter(match[1]), body: text.slice(match.index + match[0].length).trim() };
}

/**
 * Load and parse one bundled skill file.
 * @param url - file URL of the skill file.
 * @returns the full definition: name, description, whenToUse?, invocation,
 *   provider, source, rank, path, content.
 */
export async function loadBundledSkill(url = SKILL_URL) {
	const { data, body } = parseSkillFile(await readFile(url, "utf8"));
	const name = data.name;
	if (typeof name !== "string" || name.length === 0) throw new Error("frontmatter requires a name");
	if (typeof data.description !== "string" || data.description.length === 0) throw new Error(`skill "${name}" requires a description`);
	if (data.whenToUse !== undefined && typeof data.whenToUse !== "string") throw new Error(`skill "${name}" whenToUse must be a string`);
	return {
		name,
		description: data.description,
		...data.whenToUse !== undefined ? { whenToUse: data.whenToUse } : {},
		invocation: DEFAULT_INVOCATION,
		provider: BUNDLED_PROVIDER_NAME,
		source: BUNDLED_SOURCE,
		rank: BUNDLED_SKILL_RANK,
		path: fileURLToPath(url),
		content: body
	};
}

/**
 * Build the provider registered on `ctx.skills`. The load is cached per
 * provider instance; a failed load is cleared so a transient read error
 * cannot strand the catalog.
 * @param url - override the skill file URL (tests).
 * @returns a `{ name, list(), get() }` provider.
 */
export function createBundledSkillProvider(url = SKILL_URL) {
	let cached;
	const load = () => {
		cached ??= loadBundledSkill(url).catch((error) => {
			cached = void 0;
			throw error;
		});
		return cached;
	};
	return {
		name: BUNDLED_PROVIDER_NAME,
		async list() {
			const skill = await load();
			return [
				{
					name: skill.name,
					description: skill.description,
					...(skill.whenToUse !== void 0 ? { whenToUse: skill.whenToUse } : {}),
					invocation: skill.invocation,
					provider: skill.provider,
					source: skill.source,
					rank: skill.rank,
					path: skill.path,
					locator: url
				}
			];
		},
		async get() {
			return await load();
		}
	};
}
