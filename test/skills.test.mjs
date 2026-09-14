/**
 * Bundled-skills provider tests: the self-contained frontmatter parser, the
 * shipped agents-md-compactor file, the provider catalog/get shapes, and the
 * fail-open behaviour of a broken or missing bundle file.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { join } from "node:path";
import {
	parseFrontmatter,
	parseSkillFile,
	loadBundledSkill,
	createBundledSkillProvider,
	BUNDLED_PROVIDER_NAME,
	BUNDLED_SOURCE,
	BUNDLED_SKILL_RANK,
	SKILL_URL
} from "../lib/skills.js";

/** Write one throwaway skill file inside a scratch dir under test/. */
async function tempSkillFile(content) {
	const dir = await mkdtemp(join(fileURLToPath(new URL("./", import.meta.url)), "tmp-skills-"));
	const url = pathToFileURL(join(dir, "skill.md"));
	await writeFile(url, content, "utf8");
	return { url, dir };
}

test("parseFrontmatter: inline scalars, quotes, and comments", () => {
	const data = parseFrontmatter(
		[
			"# comment",
			"name: agents-md-compactor",
			'description: "A quoted description"',
			"whenToUse: use this when compacting"
		].join("\n")
	);
	assert.equal(data.name, "agents-md-compactor");
	assert.equal(data.description, "A quoted description");
	assert.equal(data.whenToUse, "use this when compacting");
});

test("parseFrontmatter: folded block scalar joins lines", () => {
	const data = parseFrontmatter(
		[
			"name: x",
			"description: >",
			"  Ultra-compressed communication mode that cuts output tokens",
			"  while keeping technical accuracy.",
			"  Levels: lite and full."
		].join("\n")
	);
	assert.equal(data.name, "x");
	assert.equal(
		data.description,
		"Ultra-compressed communication mode that cuts output tokens while keeping technical accuracy. Levels: lite and full."
	);
});

test("parseFrontmatter: literal block scalar keeps line breaks", () => {
	const data = parseFrontmatter(["name: x", "description: |", "  first line", "  second line"].join("\n"));
	assert.equal(data.description, "first line\nsecond line");
});

test("parseFrontmatter: rejects duplicates and unparseable values", () => {
	assert.throws(() => parseFrontmatter("name: a\nname: b"), /duplicate/);
	assert.throws(() => parseFrontmatter("name: {a: b}"), /plain string/);
	assert.throws(() => parseFrontmatter("- item"), /unsupported/);
});

test("parseSkillFile: splits fences from the body; rejects a missing fence", () => {
	const { data, body } = parseSkillFile("---\nname: x\ndescription: y\n---\n\n# Title\n\ntext\n");
	assert.equal(data.name, "x");
	assert.equal(body, "# Title\n\ntext");
	assert.throws(() => parseSkillFile("# no fence\n"), /missing YAML frontmatter/);
});

test("loadBundledSkill: the shipped file parses into a valid definition", async () => {
	const skill = await loadBundledSkill();
	assert.equal(skill.name, "agents-md-compactor");
	assert.ok(skill.description.length > 50);
	assert.equal(skill.provider, BUNDLED_PROVIDER_NAME);
	assert.equal(skill.source, BUNDLED_SOURCE);
	assert.equal(skill.rank, BUNDLED_SKILL_RANK);
	assert.deepEqual(skill.invocation, { modelInvocable: true, userInvocable: true });
	assert.equal(skill.path, fileURLToPath(SKILL_URL));
	assert.ok(!("whenToUse" in skill));
	assert.ok(skill.content.startsWith("# AGENTS.md Compactor"));
});

test("createBundledSkillProvider: list catalogues the file, get loads the body", async () => {
	const { url, dir } = await tempSkillFile("---\nname: t-skill\ndescription: >\n  folded\n  description\n---\n\n# Body\n");
	try {
		const provider = createBundledSkillProvider(url);
		const candidates = await provider.list();
		assert.equal(provider.name, BUNDLED_PROVIDER_NAME);
		assert.equal(candidates.length, 1);
		assert.equal(candidates[0].name, "t-skill");
		assert.equal(candidates[0].description, "folded description");
		assert.equal(candidates[0].provider, BUNDLED_PROVIDER_NAME);
		assert.equal(candidates[0].source, BUNDLED_SOURCE);
		assert.equal(candidates[0].rank, BUNDLED_SKILL_RANK);
		assert.deepEqual(candidates[0].invocation, { modelInvocable: true, userInvocable: true });
		assert.equal(candidates[0].locator, url);

		const skill = await provider.get();
		assert.equal(skill.name, "t-skill");
		assert.equal(skill.content, "# Body");
		// cached: the second call returns the identical definition object
		assert.equal((await provider.list())[0].description, "folded description");
		assert.equal((await provider.get()).content, "# Body");
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("createBundledSkillProvider: a broken file fails list() and get() alike", async () => {
	const { url, dir } = await tempSkillFile("no frontmatter here\n");
	try {
		const provider = createBundledSkillProvider(url);
		await assert.rejects(() => provider.list(), /missing YAML frontmatter/);
		await assert.rejects(() => provider.get(), /missing YAML frontmatter/);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});
