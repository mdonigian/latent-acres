# Lisa

This project uses Lisa for spec-driven development. Specs in `.specs/` are the source of truth for intended behavior.

## Workflow

```text
specs -> git diff -> structured deltas -> plan -> implementation -> tests/benchmarks -> verification -> reports
```

Typical loop:

1. Write or update a spec under `.specs/backend/` or `.specs/frontend/`.
2. Run `lisa spec diff` to see what changed and the derived plan.
3. Run `lisa spec implement` to apply code and test changes.
4. Run `lisa spec check --changed` to verify conformance.

## Commands

```text
lisa spec init                              Scaffold a .specs workspace
lisa spec status                            Show workspace and harness status
lisa spec config --harness <id>             Set local harness override
lisa spec guide [backend|frontend] [name]   Create a seed spec with guided next steps
lisa spec generate [backend|frontend] [name] Draft a spec with preview and approval
lisa spec diff                              Show changed spec deltas and plan
lisa spec implement                         Implement code changes from spec deltas
lisa spec check --changed                   Verify only changed specs
lisa spec check --all                       Verify all active specs
lisa spec import <path...>                  Draft specs from existing code
```

## Spec layout

```text
.specs/
  backend/
    <spec-name>.md
    <spec-name>.bench.<environment>.md
  frontend/
    <spec-name>.md
  environments/
    <environment>.yaml
  config.yaml
  config.local.yaml          (gitignored, local harness override)
```

## Spec format

Active base specs are markdown with YAML frontmatter:

```md
---
id: backend.example
status: active
code_paths:
  - src/example/**
test_paths:
  - tests/example/**
test_commands:
  - npm test -- example
---

# Summary
What this feature does.

## Use Cases
- Primary user or system flows.

## Invariants
- Behavior that must always remain true.

## Failure Modes
- Edge cases and error handling.

## Acceptance Criteria
- Observable outcomes that prove the behavior works.

## Out of Scope
- What this spec does not cover.
```

Required frontmatter: `id`, `status`, `code_paths`, and at least one of `test_paths` or `test_commands`.

Required sections for active specs: Summary, Use Cases, Invariants, Acceptance Criteria, Out of Scope.

Statuses: `draft` (not enforced), `active` (source of truth), `deprecated` (historical).

## Working with specs

- Review active specs before changing behavior in their `code_paths`.
- When changing behavior, update the spec, code, and tests together.
- Do not treat spec deletion as permission to silently remove code.
- Keep edits within the mapped `code_paths` unless a supporting change is clearly required.
- Use `lisa spec guide` to scaffold a new spec with placeholders, then fill it in before running implement.

## Verification

`lisa spec check` produces reports at `.lisa/spec-report.json` and `.lisa/spec-report.md`.

Verdicts per spec: `PASS`, `FAIL`, `UNSURE`, `SKIPPED`.
