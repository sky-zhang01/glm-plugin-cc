# GLM Review M3 Dogfood Packet

Generated: 2026-04-25T08:38:56.953Z
Candidate: codex/v048-m5-roi-evidence@e19bd58
Inputs: test-automation/review-eval/results/v0.4.8/m5-reflection-roi.csv

## Summary Cells

| mode | fixture | reflect | N | schema | rejected | tiers | rerank | latency_ms | validation_ms | pass |
|---|---|---|---:|---:|---:|---|---|---:|---:|---|
| adversarial-review | C1-v044-setup-menu | off | 3 | 1.00 | 0 | P3/C5/D0/R0 | off | 37706 | 59 | no |
| adversarial-review | C1-v044-setup-menu | on | 3 | 1.00 | 0 | P3/C3/D0/R0 | C3/F0/S0; 8->6; 18298 (±0) | 62318 | 37 | no |
| adversarial-review | C2-v046-aftercare | off | 3 | 1.00 | 0 | P0/C3/D0/R0 | off | 38603 | 21 | yes |
| adversarial-review | C2-v046-aftercare | on | 3 | 1.00 | 0 | P1/C4/D0/R0 | C3/F0/S0; 9->5; 18481 (±0) | 69241 | 36 | yes |

## Sampled Findings

- [adversarial-review] high / cross-checked: Release Marked as READY Despite Missing UAT and CI Evidence (release_card.md:1)
  - sidecar: test-automation/review-eval/results/v0.4.8/payloads/C1-v044-setup-menu_adversarial-review_reflect-off_t0_tpunset_s42_r1_2026-04-25T08-29-05-096Z.json
- [adversarial-review] medium / proposed: Lack of Error Handling Specification for Invalid User Input in Menu (commands/setup.md:29)
  - sidecar: test-automation/review-eval/results/v0.4.8/payloads/C1-v044-setup-menu_adversarial-review_reflect-off_t0_tpunset_s42_r1_2026-04-25T08-29-05-096Z.json
- [adversarial-review] high / cross-checked: Command Injection via Unsanitized User Input in Custom Endpoint (commands/setup.md:35)
  - sidecar: test-automation/review-eval/results/v0.4.8/payloads/C1-v044-setup-menu_adversarial-review_reflect-off_t0_tpunset_s42_r2_2026-04-25T08-29-48-533Z.json

## Human Spot-Check Notes

- [ ] Confirm every sampled file path exists in the candidate PR.
- [ ] Confirm every sampled line range still points at the cited code.
- [ ] Mark whether each sampled finding is actionable, weak, or fabricated.
- [ ] Record whether balanced review hid any useful low-tier finding that adversarial review kept.

## M5 ROI Decision

Verdict: keep reflection opt-in; do not make it default in v0.4.8.

Evidence:
- C1 adversarial review got worse under reflection: citation accuracy moved from 0.78 to 0.67, cross-checked findings moved from 5 to 3, and average latency moved from 37.7s to 62.3s.
- C2 adversarial review stayed citation-clean at 1.00 and cross-checked findings moved from 3 to 4, but proposed findings moved from 0 to 1 and average latency moved from 38.6s to 69.2s.
- Rerank completed in all reflected runs (6/6) and did not produce fallback failures, so the feature is operationally usable as an opt-in diagnostic lane.

Decision:
- Keep `/glm:review --reflect` and `/glm:adversarial-review --reflect` available for targeted dogfood and difficult reviews.
- Do not make reflection default-on in v0.4.8.
- Close issue #31 as evidence-backed opt-in, not as a promotion-to-default result.
