---
name: agents-md-compactor
description: Compacts AGENTS.md files in Git projects while preserving operational instructions, removing redundancy, and delegating historical or recoverable context to Git history when not required for day-to-day agent work.
---

# AGENTS.md Compactor

## Objective

Compact `AGENTS.md` files while preserving all information required for an AI agent to work correctly in the current state of the repository.

The result must contain the information the agent needs **at task execution time**, not exhaustive project documentation.

Because the repository uses Git, historical, obsolete, or exceptional information that is no longer required for normal agent operation can be removed from `AGENTS.md`, as it remains recoverable via Git history.

Compaction is not indiscriminate summarization. It maximizes the **operational information density** of the file.

## Non-negotiable Rules

- Do not change the operational semantics of any rule.
- Do not invent commands, paths, versions, commits, policies, or project behavior.
- Preserve constraints, security rules, validation steps, exceptions, and non-trivial commands.
- Do not delete a doubtful rule without verification.
- If a rule remains ambiguous after investigation, request confirmation before removing it.
- Do not edit files unless explicitly authorized.

## Classification

Classify each block of instructions into one of these categories:

- **Current operational** → preserve.
- **Critical constraint** → preserve.
- **Current exception** → preserve.
- **Derivable** → eliminate or condense.
- **Redundant** → eliminate.
- **Historical** → verify with Git; eliminate if not needed.
- **Obsolete** → eliminate.
- **Doubtful** → investigate or ask.

Do not use block length as a proxy for importance.

## Procedure

### 1. Inventory

Locate all relevant `AGENTS.md` files:

```bash
find . -name AGENTS.md -type f
```

For each file, determine:

- the directory it affects;
- the instructions it contains;
- possible inherited rules;
- overlaps with other documents.

### 2. Classify Each Block

Apply the classification above to every section or group of instructions.

### 3. Verify Doubtful Items

For each block marked as doubtful:

1. Inspect current code and configuration.
2. Check cross-references in the repository.
3. Review Git history for that section.
4. Determine whether the information is still required to execute tasks.
5. Decide whether to preserve, condense, or eliminate it.
6. If the historical context may still be useful, record a Git reference.

Use Git commands such as:

```bash
git log --all -- AGENTS.md
git log --all -p -- AGENTS.md
git blame AGENTS.md
git show <commit>:AGENTS.md
```

Do not assume something is obsolete just because it looks old. Verify whether:

- the rule is still reflected in code or configuration;
- a later change invalidates it;
- it was replaced by another policy;
- the historical context is still needed to interpret a current exception.

### 4. Rewrite

Produce a more compact `AGENTS.md`:

- Group related rules.
- Remove duplicates.
- Use imperative, precise sentences.
- Replace paragraphs with lists when it increases information density.
- Keep commands exact and verified.
- Do not introduce new sections solely to preserve non-operational context.

When two rules appear similar, do not merge them until you confirm they have exactly the same scope and effect.

### 5. Validate Semantics

After rewriting, verify that the following remain present:

- all critical constraints;
- all relevant validation instructions;
- all current exceptions;
- all scope conditions;
- all non-trivial commands the agent needs;
- all security and compatibility rules.

Compare the old and new content, but evaluate **operational semantics**, not textual correspondence.

### 6. Review the Result as an Agent

Read the new file without consulting the original and answer:

- Do I know what I must not do?
- Do I know what I must do before or after modifying code?
- Can I identify important exceptions?
- Can I quickly find validation commands?
- Is there any essential rule that now depends on an unnecessary inference?
- Is there text that remains only because "it has always been there"?

If any important answer is "no", the file is over-compacted.

## Validation of Commands and Paths

For each preserved command, verify that:

- the executable or script exists;
- the path is valid;
- the command appears in current scripts, configuration, or documentation;
- its preconditions are documented if they are not obvious.

This avoids preserving historical commands that look important but no longer work.

## Hierarchy and Scope

Before compacting, identify all relevant `AGENTS.md` files and their scope.

Consider:

- `AGENTS.md` in the root;
- `AGENTS.md` in subdirectories;
- more specific rules that override or complement general rules;
- duplications caused by inheritance;
- contradictory instructions between levels.

Do not move a rule from one `AGENTS.md` to another solely to reduce lines. Do it only if the new scope level is correct.

An incorrect compaction by scope is a functional error even if the line count decreases.

When a rule is duplicated across levels:

- If it is global and present in the root, remove the duplicate in descendant files.
- If it applies only to a subdirectory, keep it in the descendant file.
- If a descendant file needs to emphasize it due to operational risk, justify the duplication explicitly.

## Historical References

When eliminated context deserves to remain recoverable, use a brief, stable reference.

Recommended format:

```text
Historical: <verified short SHA>, `<verified path>`, <section or subject>
```

Example:

```text
Historical: `a1b2c3d`, `docs/architecture.md`, "migration to v2"
```

The reference must allow another agent to find the material without having to reconstruct what was removed.

### When to Reference

Add a reference when the eliminated material:

- documents an architectural decision whose motivation might be needed again;
- explains a non-obvious exception;
- contains context about an incomplete migration or legacy compatibility;
- could be useful for investigating regressions or future decisions;
- provides information that is hard to reconstruct from the current repository state.

### When Not to Reference

Do not add a reference when you have only eliminated:

- a redundant explanation;
- an obvious description;
- purely narrative text;
- a list that Git or the repository itself allows to reconstruct trivially;
- information already fully represented in another current document;
- historical details with no foreseeable practical utility.

The absence of a reference is also a deliberate decision: the goal is to avoid polluting `AGENTS.md` with unnecessary historical pointers.

## Compaction Heuristic

For each fragment, apply this decision tree:

```text
Does it change agent behavior?
├─ Yes → preserve.
└─ No
   ├─ Prevents a hard-to-detect error → preserve or condense.
   ├─ Is a current exception → preserve.
   ├─ Is needed to understand a current rule → condense.
   ├─ Is potentially useful historical context → eliminate + selective Git reference.
   ├─ Is trivially derivable → eliminate.
   └─ Is redundant → eliminate.
```

## Stopping Criterion

The task is complete when:

1. `AGENTS.md` contains the necessary operational information.
2. Rules are not needlessly duplicated.
3. Unnecessary historical content has been removed.
4. Important exceptions remain explicit.
5. Existing Git references justify their presence by practical utility.
6. No prose remains that can be eliminated without increasing risk or ambiguity.
7. The file is smaller **without losing operational capability**.

Do not chase a target line count or a fixed reduction percentage.

## Output Standard (Analysis and Application Modes)

The skill must always produce a structured report with the following sections. In **analysis mode**, it only proposes changes. In **application mode**, it applies the changes and reports what was done.

### Definition of "Rule"

A **rule** includes any instruction, constraint, exception, command, validation step, or security/compatibility requirement that can affect agent behavior.

### 1. Files Analyzed

List each `AGENTS.md` file considered, with:

- repo-relative path (avoid host-absolute paths);
- scope (root or subdirectory);
- brief note on overlaps or inheritance with other `AGENTS.md` files, if detected.

Example:

```text
Files analyzed:
- ./AGENTS.md (root, global scope)
- ./services/llm/AGENTS.md (subdirectory, overrides root for services/llm)
```

### 2. Changes Summary

Describe the changes performed or proposed for each file:

- file path;
- type of changes (rewrite, merge, split, move, delete);
- high-level rationale (remove redundancy, resolve overlaps, eliminate obsolete content, etc.).

In **analysis mode**, this section describes proposed changes. In **application mode**, it describes the changes actually applied.

If deviations from the original plan occurred (e.g., due to newly detected risk), they must be explicitly noted here.

Example:

```text
File: ./AGENTS.md
- Rewrote "Procedure → Inventory" paragraph as a bullet list. Rationale: Increases information density without losing operational content.
- Merged two overlapping rules about command validation. Rationale: Same operational semantics, different wording.
- Eliminated historical narrative about v1→v2 migration. Rationale: Current rule already summarizes required behavior; details in Git.
```

### 3. Rules Eliminated

For each eliminated rule or fragment, report:

- file and section;
- short description of the rule;
- classification used (redundant, obsolete, derivable, historical, doubtful);
- brief justification for elimination.

Group eliminations when they share the same classification and rationale (e.g., "three paragraphs of historical narrative about v1→v2 migration").

If a section has no items, state "None".

Example:

```text
File: ./AGENTS.md
Section: "Historical References"
Rule: Paragraph explaining motivation of v1→v2 migration in detail.
Classification: Historical
Justification: Motivation recoverable via Git; current rule already summarizes required behavior.
```

### 4. Rules Preserved Due to Risk

For each rule kept explicitly due to operational risk:

- file and section;
- short description of the rule;
- type of risk avoided (hard-to-detect error, security, compatibility, non-obvious exception);
- why it is not condensed further.

If, during application, a rule initially planned for elimination is retained due to newly detected risk, mark it here and explain the new risk.

If a section has no items, state "None".

Example:

```text
File: ./services/llm/AGENTS.md
Section: "Non-negotiable Rules"
Rule: "Do not restart inference service without draining active requests."
Risk: Hard-to-detect error; can cause silent request loss.
Reason for preservation: Concrete operational constraint; not derivable from code alone.
```

### 5. Historical References Added

For each added historical reference:

- file and section where the reference is inserted;
- the reference itself (commit SHA, path, subject);
- brief explanation of why this context is worth keeping recoverable.

If a section has no items, state "None".

Example:

```text
File: ./AGENTS.md
Section: "Historical References"
Reference: `a1b2c3d`, `docs/architecture.md`, "migration to v2"
Reason: Documents non-obvious exception in current behavior; may be needed for future regressions.
```

### 6. Pending Doubts or Ambiguities

List any items that remain doubtful or ambiguous after investigation:

- file and section;
- description of the ambiguity;
- what additional information or confirmation is needed (from user, from code, from Git, from other docs).

If a section has no items, state "None".

Example:

```text
File: ./services/llm/AGENTS.md
Section: "Validation of Commands and Paths"
Ambiguity: Unclear whether `./scripts/validate-config.sh` is still used in CI.
Needed: Confirmation from CI configuration or maintainer.
```

### 7. Summary Metrics (Optional)

Optionally, include lightweight metrics to aid review:

- approximate line count before and after (per file);
- number of rules eliminated, preserved due to risk, and flagged as doubtful;
- number of historical references added.

These metrics are informative only; they must not drive decisions.

---

**Mode semantics:**

- **Analysis mode**:
  - No file is modified.
  - Sections 2–6 describe *proposed* changes and findings.
- **Application mode**:
  - Files are modified according to the proposed plan.
  - Sections 2–6 describe *applied* changes and final state.
  - If deviations from the original plan occurred (e.g., due to newly detected risk), they must be explicitly noted in Section 2.

## Constraints

- Do not delete critical instructions just to make the file shorter.
- Do not replace concrete commands with vague descriptions.
- Do not invent commits, paths, historical causes, or project behavior.
- Do not use Git references to externalize rules that the agent needs during normal work.
- Do not turn `AGENTS.md` into an index of historical commits.
- Do not automatically copy information from `README.md` or other documents just because it is available.
- Do not modify project code unless the task explicitly requires it.
- Do not rephrase an instruction in a way that changes its scope.
- Do not perform purely textual compaction: always evaluate the operational value of each fragment.

## Expected Result

The result should be an `AGENTS.md` that acts as a **compact operational memory for the agent**:

- small;
- precise;
- actionable;
- free of unnecessary duplication;
- focused on the current state of the project;
- with history delegated to Git only when a concrete reference is truly useful.