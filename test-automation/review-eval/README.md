# Review reliability evaluation harness

> **Purpose**: empirical characterization of GLM-5.1 behavior on `/glm:review` + `/glm:adversarial-review` under different sampling parameters. Tracks whether changing defaults (temperature / top_p / seed / thinking) materially improves schema compliance, citation accuracy, and self-consistency.
>
> Tracking: Gitea issue #7 (private instance — not linked from public repo).

## Principle

The maintainer's directive (issue #7 comment 2026-04-21):

> 模型也会更新的比较快 测了用了一堆 token 后 也是模型一更新就没啥用了

Keep experimental token spend SMALL. A 9-call sanity sweep is enough to separate "temperature matters a lot" from "temperature changes nothing observable" on this model version. If we ever want deeper data, spend it on the NEW model, not characterize the old one.

## Layout

```
review-eval/
├── README.md                       # this file
├── corpus/
│   └── C2-v046-aftercare/          # medium diff fixture
│       ├── meta.json               # diff provenance (repo, base, head, line count)
│       ├── diff.patch              # frozen diff content
│       └── ground-truth.json       # expected-bug / known-false-citation entries
├── scripts/
│   ├── run-experiment.mjs          # run N copies of one (diff, cell) combo, emit CSV
│   └── summarize.mjs               # read CSVs, compute metrics, print table
└── results/
    └── v0.4.7/
        └── sanity-sweep.csv        # 9-call output (temp ∈ {0.0, 0.5, 1.0} × N=3)
```

## Non-goals for v0.4.7 sanity sweep

- No top_p / thinking / seed parameter sweep (scope reduction per issue #7 comment).
- No C1 (small) / C3 (large) fixtures (single-diff sweep only).
- No context-packing variant comparison (P1-P4 deferred).
- No in-release default change unless sanity data shows strong signal.

## Metrics recorded per run

| Metric | Source | Meaning |
|---|---|---|
| `schema_compliance` | parse check | JSON parseable AND has verdict/summary/findings |
| `schema_echo` | `classifyReviewPayload` | returned the schema definition instead of findings |
| `invalid_shape` | `classifyReviewPayload` | parseable but missing required fields |
| `citation_accuracy` | grep-based | fraction of findings whose file:line range + distinctive tokens actually exist in cited file |
| `latency_ms` | wall-clock | single-attempt round-trip |
| `input_tokens`, `output_tokens` | response meta | BigModel-reported token usage |
| `errorCode` | companion result | one of SCHEMA_ECHO, INVALID_SHAPE, SERVICE_OVERLOADED, null, etc. |

`citation_accuracy` is computed by the harness, not by GLM:

1. For each `finding` with `file`, `line_start`, `line_end`:
2. `grep -n` in the cited file for up to 3 distinctive tokens from the finding's `body` (length > 4, not a stopword)
3. Accuracy = 1.0 if ≥ 1 token matches within the cited line range ± 20 lines; else 0.0

This is identical to the spot-check I ran manually against workflow-governor — now automated so we can score many runs quickly.

## Success criteria (from issue #7)

Before any default sampling change ships, the chosen combo must achieve on C2:

- `schema_compliance >= 0.95`
- `schema_echo = 0`
- `citation_accuracy >= 0.90`
- Latency/cost regression within 2× baseline

If no combo meets all four: DO NOT change defaults. Record the negative result in CHANGELOG + `results/v0.4.7/sanity-sweep.csv`.
