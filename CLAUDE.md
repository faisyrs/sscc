# SSCC Engine

State, Sequence, Condition, Choice — a game-agnostic rules engine.

## Requirements Traceability

This project uses elspais for requirements traceability.
Read `AGENT-ONBOARDING.md` (at `~/anspar-org/elspais-worktrees/use4proj/AGENT-ONBOARDING.md`) for the full guide and assertion style guide.

- **Requirements are the sole source of truth** for what the system must
  do. Do not duplicate obligations in wikis, tickets, or inline comments.
  If it is normative, it belongs in a REQ file in `spec/`.
- **Non-normative content belongs inside requirements too.** Requirements
  can contain Rationale sections, examples, diagrams, and other
  explanatory prose outside `## Assertions`. Only assertions (using SHALL)
  are normative.
- **Before writing requirements**: call `agent_instructions()` via MCP
- **To search requirements**: use MCP tools (`search`, `get_requirement`,
  `get_hierarchy`), not grep
- Requirement files live in `spec/` (PRD, OPS, DEV levels)
- Namespace: `SSCC` (IDs look like `SSCC-p00001`, `SSCC-d00001`)
- Code links: `# Implements: SSCC-xxx-A` in source files
- Test links: `# Verifies: SSCC-xxx-A` in test files
- After changes: run `elspais fix` then `elspais checks`
