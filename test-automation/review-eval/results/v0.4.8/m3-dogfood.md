# GLM Review M3 Dogfood Packet

Generated: 2026-04-24T17:13:21.856Z
Candidate: fix/v048-m4-repo-checks@9868de7
Inputs: test-automation/review-eval/results/v0.4.8/m3-measurement.csv

Note: the CSV intentionally preserves one initial C2 adversarial pilot row with
unset sampling parameters, followed by the 18-row deterministic matrix
(`temperature=0`, `seed=42`) used for the M5 entry-condition read.

## Summary Cells

| mode | fixture | N | schema | rejected | tiers | latency_ms | validation_ms | pass |
|---|---|---:|---:|---:|---|---:|---:|---|
| adversarial-review | C2-v046-aftercare | 1 | 1.00 | 0 | P1/C0/D0/R0 | 109967 | 27 | no |
| review | C2-v046-aftercare | 3 | 1.00 | 0 | P0/C0/D0/R0 | 35154 | 0 | yes |
| adversarial-review | C2-v046-aftercare | 3 | 1.00 | 0 | P3/C1/D0/R0 | 93196 | 25 | no |
| review | C1-v044-setup-menu | 3 | 1.00 | 0 | P0/C0/D0/R0 | 41527 | 0 | yes |
| adversarial-review | C1-v044-setup-menu | 3 | 1.00 | 0 | P1/C0/D0/R0 | 67609 | 9 | no |
| review | C3-v04x-cumulative | 3 | 1.00 | 0 | P0/C0/D0/R0 | 40895 | 0 | yes |
| adversarial-review | C3-v04x-cumulative | 3 | 1.00 | 0 | P7/C1/D0/R0 | 129512 | 51 | no |

## Sampled Findings

- [adversarial-review] medium / proposed: Breaking change in review command contract (commands/review.md:1)
  - sidecar: test-automation/review-eval/results/v0.4.8/payloads/C2-v046-aftercare_adversarial-review_tunset_tpunset_sunset_r1_2026-04-24T16-51-49-585Z.json
- [adversarial-review] high / proposed: Fragile structural validators will likely block valid reviews on model output drift (scripts/lib/validators/review-structural.mjs:1)
  - sidecar: test-automation/review-eval/results/v0.4.8/payloads/C2-v046-aftercare_adversarial-review_t0_tpunset_s42_r2_2026-04-24T16-57-21-843Z.json
- [adversarial-review] medium / proposed: Repo checks risk CI hangs or memory exhaustion on large repositories (scripts/lib/repo-checks.mjs:1)
  - sidecar: test-automation/review-eval/results/v0.4.8/payloads/C2-v046-aftercare_adversarial-review_t0_tpunset_s42_r2_2026-04-24T16-57-21-843Z.json

## Human Spot-Check Notes

- [ ] Confirm every sampled file path exists in the candidate PR.
- [ ] Confirm every sampled line range still points at the cited code.
- [ ] Mark whether each sampled finding is actionable, weak, or fabricated.
- [ ] Record whether balanced review hid any useful low-tier finding that adversarial review kept.
