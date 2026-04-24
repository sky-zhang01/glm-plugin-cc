# Repo-Owned Review Checks

`/glm:review` and `/glm:adversarial-review` can optionally run a small,
local-only check set from `.glm/checks/`.

This is deliberately not a policy engine. v0.1 supports only literal grep-style
checks over files already in the reviewed target set.

## Location

Place one JSON, YAML, or YML file per check under:

```text
.glm/checks/
```

Each file may contain a single check object. JSON files may also contain an
array of check objects.

## Supported Kinds

- `grep-exists`: passes when the literal `pattern` appears in at least one
  reviewed file matching `path_globs`.
- `grep-notpresent`: passes when the literal `pattern` does not appear in any
  reviewed file matching `path_globs`.

No shell commands run. `test-passes`, arbitrary scripts, and free-form markdown
contracts are intentionally out of scope.

## Shape

```yaml
id: no-workflow-governor-leak
kind: grep-notpresent
path_globs:
  - "src/**/*.ts"
pattern: "workflow_governor"
message: "Review findings must not reference unrelated cross-project paths."
```

`path_globs` are repo-relative and matched against the reviewed target files,
not the entire repository. This keeps repo checks scoped to the same review
surface as model findings.

## Output

Repo-owned checks are stored separately from model findings:

```json
{
  "repo_checks": {
    "status": "completed",
    "checks": [
      {
        "id": "no-workflow-governor-leak",
        "kind": "grep-notpresent",
        "result": "fail",
        "violations": [
          {
            "file": "src/review.ts",
            "line": 81,
            "match": "workflow_governor"
          }
        ]
      }
    ]
  }
}
```

The renderer prints a separate `Repo checks` section. It does not merge these
results into `findings`, does not rerank model findings, and does not change the
review verdict by itself.
