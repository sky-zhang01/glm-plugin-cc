# GLM Review M3 Dogfood Packet

Generated: 2026-04-25T07:14:23.329Z
Candidate: fix/v048-m21-balanced-review-calibration@f093307
Inputs: test-automation/review-eval/results/v0.4.8/m21-review-calibration.csv

## Summary Cells

| mode | fixture | N | schema | rejected | tiers | latency_ms | validation_ms | pass |
|---|---|---:|---:|---:|---|---:|---:|---|
| review | C1-v044-setup-menu | 3 | 1.00 | 0 | P0/C0/D0/R0 | 14933 | 0 | yes |
| review | C2-v046-aftercare | 3 | 1.00 | 0 | P0/C0/D0/R0 | 16593 | 0 | yes |

## Sampled Findings

No sampled findings were available from sidecars.

## Human Spot-Check Notes

- [ ] Confirm every sampled file path exists in the candidate PR.
- [ ] Confirm every sampled line range still points at the cited code.
- [ ] Mark whether each sampled finding is actionable, weak, or fabricated.
- [ ] Record whether balanced review hid any useful low-tier finding that adversarial review kept.
