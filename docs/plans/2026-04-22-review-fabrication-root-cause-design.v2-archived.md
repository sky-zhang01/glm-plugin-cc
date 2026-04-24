# v0.4.8 Review Fabrication 根因分析与改造设计 (v2, post-Round-1)

```
Status: DRAFT (Round 2, after Codex Round 1 BLOCK verdict)
Approval: PENDING
Author: Sky + Claude (main session)
Date: 2026-04-22
Round 1 BLOCK: 4 CRITICAL (C1/C2/C3/C4) + 7 HIGH + 3 MEDIUM
Supersedes: docs/anti-hallucination-roadmap.md + v1 of this file
```

## Round 1 → Round 2 变更摘要

Codex Round 1 以 **BLOCK** verdict 返回。本版本对每条 critical / high 做 structural 响应，不是措辞级修补。

| Round 1 critical | Round 2 响应 |
|---|---|
| **C1** classifier train==test 循环论证 | **§5.1 引入 held-out evaluation protocol** — 100 条人工标注 gold set + 独立 second LLM pass；acceptance 永不用 classifier 自己评自己 |
| **C2** "C1 LGTM rate 0%" 事实错误（实际 29-53%） | **§1 / §2.2 基线重写** + **§4 A.3 LGTM 目标降级**（已达成，不是要追求的目标） |
| **C3** A.5 blacklist 过拟合 fixture | **§4 A.5 删除** fixture-local 条目；只留 2 条跨 fixture 普适负例 |
| **C4** Phase B token-grep verifier 循环 | **§4 Phase B.2 删除**；只保留 LLM reflect pass（B.1），其 score 过滤是 LLM self-score 驱动，不是 token-grep 重用 |
| **H1** 数字 framing 切换 | **§2.2 声明主口径** = classifier 硬错 103/1430 = 7.2%（±bracketed upper 12.8%） |
| **H2** 30/30 HIGH severity inflated | **§1 不再前置 "100% fabricated"**；改用 C1 has-findings subset fab rate |
| **H3** "100% Claude 自称" 无 code-review 证据 | **§3.3 删除此句**；保留仅作 weak generic mechanism hypothesis |
| **H4** Temperature 0.0 ROI#1 证据不足 | **§4 A.1 降级到 ROI #5**；作 "no-cost try" 而非优先项 |
| **H5** "≤15%" 用户可接受性论证缺 | **§5.2 加 UX threshold 讨论** + 多档目标（激进 / 保守） |
| **H6** Phase B 缺 wall-clock 估算 | **§5.3 加 per-fixture latency 表**（从 457-run 数据算） |
| **H7** `/glm:review` vs `/glm:adversarial-review` 未区分 | **§4.A.3 / A.6 分开** — adversarial 保留 "skeptical even at zero-findings" posture |
| **M1** D0 `json_object` 保留论证弱 | **§8 D0 补引证** parser-hardening 证据链 |
| **M2** 缺 minimal-viable ablation | **§6 先跑 A.2+A.4 only 组** |
| **M3** Phase C 过快排除 | **§4 Phase C 降级为"Phase B 不达标时的待备选"**，不是永久弃 |

---

## 1. 问题陈述（Round 1 事实错误已修正）

v0.4.7 `/glm:review` 在 457-run harness (C1 small 440 lines / C2 medium 1550 / C3 large 8336) 下呈现 **fixture-size-dependent** fabrication pattern：

**关键事实（Round 1 错版改正）**：
- C1 已有 **29-53% 的 payload 返回 `verdict:"approve" + findings:[]`**（t=0: 53.3% / t=0.5: 31.1% / t=1: 29.5%，24+14+13=51/134 runs）。即 **"LGTM 合法出口" 在 de facto 层面已存在**
- C2/C3 上 `verdict="approve"` 仅出现 1 次（C3 t=1 r=?）；C2/C3 的 0-findings payload 里 verdict 字段基本缺失（=`?`），schema 行为不一致
- 真正的问题是 C1 **有 findings 的 subset（49/134 = 37%）**里 fab 集中

**failure mode 刻画**：在 Codex n=65 audit + 主 session 全量 1430 classifier 联合下，硬错 (anti-signature 命中) = 103 / 1430 = 7.2%，跨 fixture 分布：

| fixture | 硬错 fab 数 | findings 数 | 硬错 fab / findings | has-findings runs |
|---|---:|---:|---:|---:|
| C1 | 72 | 227 | **31.7%** | 83 / 134 (62%) |
| C2 | 5 | 183 | 2.7% | 43 / 44 (98%) |
| C3 | 114 | ~1020 | 11.2% | 实测 ~82% |

**主口径声明（H1 fix）**：之后 "C1 fab rate" 默认指 has-findings subset 的 **31.7%** 硬错比例，不是 27-37% 全 run 比例，也不是 HIGH severity 偏置下的 100%。

**典型 fabrication 例**（Codex n=65 验证过的 HIGH severity 案例）：
- 虚构 `@anthropics/claude-code → @anthropic-ai/claude-code` rename（实际 `@skylab/glm-plugin-cc → glm-plugin-cc`）
- 虚构 `process.mjs 67 lines entirely removed`（实际只删一函数）
- 虚构 `retry.mjs lacks jitter`（实际 `jitterRatio: 0.2` 明写）

**失败模式命名**：`same-file semantic overwrite by prior templates` —— file 引用对、line 大致对，但 body claim 来自 pretraining 通用模板，跟实际 diff 无关。

## 2. 证据基础

### 2.1 外部证据（5 路独立调查）

已在 v1 列出，摘要：

| 路 | 关键结论 | 文件 |
|---|---|---|
| 1 | GLM-5.1 专项 code-review 第三方证据 **N=0**；SWE-rebench 5.1 vs 5 近乎持平 | `/tmp/glm51-strict-third-party-audit.md` |
| 2 | **5 条 GPT-5 假设 GLM 全不满足**；schema 从解码层 bit-level 降级为 prompt-text；我们 balanced review prompt 是本地原创，codex 原版烧在 binary | `/tmp/prompt-comparison-analysis.md` |
| 3 | PR-Agent 2 条 partial-context 直击 C1；CodeRabbit `LGTM!` 正面出口；Anthropic 5×Sonnet+Haiku | `/tmp/oss-review-prompts-analysis.md` |
| 4 | **CL4R1T4S 67 文件深挖**：跨 vendor 4 共识（未看不推断 / 3-try 上限 / partial-view warning / tool name 保密）；Devin "Truthful & Transparent" + OpenAI Codex `F:path†Lxx-Lyy` + Factory DROID Diagnostic/Implementation 模式 | `/tmp/cl4r1t4s-deep-dive.md` |
| 5 | **16 个 ≥2k star repo 深读代码**：主流不靠 `response_format`，用 **低温度默认(10/13) + partial-context + empty exit + reflect + score filter** 组合拳；PR-Agent `pr_code_suggestions.py:402-415` 有 score-0 reflect pass | `/tmp/oss-review-2k-star-antihallucination.md` |

### 2.2 实证数据（H1 主口径声明 + C2 事实校正）

- 总 payload **457** / 总 findings **1430**
- 硬错 (anti-signature 命中) = **103 / 1430 = 7.2%**（主口径）
- 扩口径 (含 idempotency 等争议类) = 183 / 1430 = 12.8%（附录指标）
- KNOWN_FALSE 跨项目幻觉 **0 / 1430** ✓
- 真 FILE_WRONG = 18（24 里 6 条 C2 verify-release.yml 是 legitimate meta）
- **C1 de facto LGTM rate = (24+14+13)/134 = 38.1%**（非 0%，Round 1 错误已改）
- Wall-clock latency (p50 / mean / p90 / max, seconds)：
  - C1: **30 / 38 / 83 / 111**
  - C2: **56 / 53 / 72 / 87**
  - C3: **75 / 88 / 170 / 353**

### 2.3 Codex 撞 limit 前 insight

> "`idempotency template` (55) + `duplicate-job` (21) 并非全部 fabrication — 对 stateless POST 自动重试'会不会重复计费'的质疑，在 reviewer 不知道 'stateless HTTP' 前提下是合理 code review"

这直接要求 A.5 **删掉** fixture-specific blacklist 条目。

## 3. 根因分层归因（H3 fix）

### 3.1 层 1：Prompt — **证据最硬**

- 第二路：5 条 GPT-5 假设 GLM 不满足
- 第四路：跨 vendor 4 共识我们全无
- 第五路：Top 10 共识我们 10 条缺 8.5 条
- 直接后果：body 字段无 "quote-level derivable from diff bytes" 约束

### 3.2 层 2：调用路径 — **证据中强**

- 第二路：schema 从 codex 的解码层 bit-level 约束降级为我们的 prompt 文本 + `response_format: json_object` object 级约束
- 第五路：主流工具用 **reflect pass + confidence filter + low-temperature** 组合拳；我们 3 者全无
- 直接后果：schema 约束下降 + 无 post-processing + 无 sampling 防护

### 3.3 层 3：模型 — **机制假设，仅弱间接证据**（H3 修订）

- 第一路：GLM-5.1 专项 code-review 证据 N=0；跨版本外推不安全
- 机制假设：GLM 系 SFT 可能有 "通用助手模板" prior（**但第一路未给 code-review 专项 5.1 证据**，此假设不作定论）
- 我们 457 runs 是**最具体的 5.1 code-review 一手证据**，但属 single-source，**generalizability 未证**
- 直接后果：在 prompt 和 call-path 修复之前，**无法独立诊断模型上限**

### 3.4 归因结论

修复优先级 = **Prompt > Call-path > Model**。前两层修完若 C1 硬错 fab 仍 > 15%，再谈模型替换或 fallback。

## 4. v0.4.8 改造方案（Round 2 修订版）

### Phase A — Low-cost Prompt 改造（删掉 Round 1 C3 过拟合条目）

#### A.1 Temperature 默认 0.0（**H4 降级为 ROI #5**，no-cost 尝试）

- `scripts/lib/glm-client.mjs.buildChatRequestBody`：caller 未传 → 默认填 0.0
- 依据：10/13 star-2k+ repo 用 0-0.2；**但我们 457-run 数据显示温度差异小**（fab% 11-13% 三温度持平）；不是 ROI#1
- 回退：`--temperature 1.0` 仍支持；seed 默认 42 (ROI #8) 确保同温下可复现

#### A.2 Partial-context warning（**ROI #1，证据最硬**）

在 `prompts/review.md` + `prompts/adversarial-review.md` 头部加：

> You only see the diff hunks in a PR, not the entire codebase. The **absence** of a definition, declaration, import, or initialization for any entity in the PR code is **NEVER** a basis for a suggestion. Partial file views may miss critical dependencies, imports, or functionality defined elsewhere. If you cannot verify a claim from the diff content itself, omit the claim — **do not speculate**.

- 来源：PR-Agent `pr_reviewer_prompts.toml:L46` + Cursor Tools / Same Dev 逐字一致
- 直接对抗 C1 "npm rename breaks users" 模式

#### A.3 LGTM exit — `/glm:review` only（**H7 分路**）

- `/glm:review` schema: `verdict` enum 加 `APPROVED_NO_FINDINGS`
- `/glm:review` prompt: 明确 `findings:[]` 合法，无需硬挤
- `/glm:adversarial-review` **不加**此出口（adversarial 意图是 skeptical even at zero issues；保持"必须出 challenge"语义）
- 来源：CodeRabbit `LGTM!` + H7 区分
- **Baseline 校正**（C2 fix）：C1 `verdict:"approve" + findings:[]` rate 已 29-53%（平均 ~38%）；A.3 **不是为了 raise rate**，而是**把已发生的行为正式 canonicalize**；acceptance criteria 从 "提升 ≥20%" 改为 "维持 ≥35% on C1 + 在 C2/C3 上出现非零 approve+[] 样本"

#### A.4 No-speculation 负约束（**ROI #2**）

Prompt 加：

> Every finding's `body` must quote specific tokens, function names, or strings that **literally appear in the diff**. If you cannot quote from the diff, the finding is unverifiable — omit it. Never assume a library, API, or identifier exists unless it's in the visible diff content. Ground every diagnosis in actual code you have opened.

- 来源：Factory DROID L18 / L328-329 + Devin 2.0 L25 "NEVER assume that a given library is available"

#### A.5 ~~负例 blacklist~~ → **删除 fixture-specific，仅保留 2 条跨 fixture 普适**（**C3 fix**）

保留：
- "Do NOT flag missing tests as an issue if the diff does not include test-layer changes" (跨 fixture)
- "Do NOT flag style preferences not backed by project convention" (跨 fixture)

**删除**（Round 1 C3 原文）：package rename when `"private":true` / idempotency keys in stateless HTTP / entire-file-removal 等 —— 这些是 fixture-local，塞进 global prompt 会压掉真实质疑。

如需 fixture-specific 语境（future work），改为 `--context "<hint>"` CLI flag 由 caller 传入，不烧进 global prompt。

#### A.6 Role framing（**H7 分路**）

- `/glm:review`: "senior staff engineer doing skeptical code review … saying 'no issues' is a successful review, not a failure"
- `/glm:adversarial-review`: "adversarial reviewer actively hunting for subtle flaws … even zero-obvious-issue diffs deserve challenge" （**不同 role**）

来源：PR-Agent + Factory DROID diagnostic mode + H7 差异化

#### A.7 + `confidence_score` 字段

- Schema: 每 finding 加 `confidence: 0.0-1.0`
- Prompt: *"confidence=0.9+ only if body quotes literal diff code; 0.6-0.8 for interpretive; <0.5 → omit"*
- Post-processing: companion default filter `confidence < 0.5`（flag 可 override）

#### A.8 Seed 默认 42（debug reproducibility）

temperature ≤ 0.2 时 default seed=42，允许 A/B 实验。

### Phase B — LLM Reflect Pass only（**C4 删除 token-grep verifier**）

#### B.1 LLM reflect pass（保留，PR-Agent 模式）

独立 second LLM call 校验 first-pass findings：

```
Pass 1: 生产 findings (现机制)
  ↓
Pass 2 (new): 给 first-pass findings + 原 diff → LLM 判
  "对每个 finding: body 里 quoted identifier/string 是否真的在 diff 字节中?
   claim 是否 quote-derivable?"
   → 返回 score 0-10 per finding + short reasoning
  ↓
Companion: filter score < 5 out (threshold configurable)
```

- 来源：PR-Agent `pr_code_suggestions.py:402-415` + `pr_code_suggestions_reflect_prompts.toml`
- **score 过滤是 LLM self-score 驱动**，不是 Round 1 C4 批评的 token-grep 重用
- 实现成本：~150-200 LOC 新增 `reflect.mjs` + prompt 文件

#### B.2 ~~Token-grep external verifier~~ **删除**（**C4 fix**）

Round 1 C4 正确指出：grep ≥ 2 tokens 跟 `scoreCitation` 同构，那是已承认的缺陷启发式，不能再当 Phase B bottomline。

**替代**：仅做 **structural check** —
- `finding.file ∈ allowed_files` (已有)
- `finding.lineStart` valid 行号范围
- 不做 body-token grep

若需要 semantic layer，**走 B.1 LLM reflect pass**（LLM 自己判是否 quote-derivable）。

### Phase C — 备选（不是 "选做"，是 "B 不达标再议"）

- **C.1 Self-consistency n=3** + majority vote — 成本 3x；来源 SWE-agent `BinaryTrajectoryComparison`。**Phase B 反馈不够时才上**
- **C.2 Claim-level decomposition** (DeepEval) — 把 body 拆 atomic claim 逐条 verify；复杂度高

## 5. Acceptance Criteria（Round 2 关键重写）

### 5.1 评估方法论（**C1 fix — held-out + gold labels**）

**禁止循环论证**：anti-signature classifier 只用于初筛，**acceptance criteria 禁用 classifier 作为 Phase A 成功判据**。

**实际做法**（3 层 gold 真值）：

1. **人工 gold set**：从 1430 findings **随机抽 150 条**（stratified: 25 每 cell × 6 cells），Sky 或独立 annotator **人工标注** `{VERIFIED / LEGITIMATE_META / FABRICATED / AMBIGUOUS}`，存 `test-automation/review-eval/gold-labels-v1.csv`
2. **Held-out sweep**：Phase A 落地后**重跑 457-run sweep**（同 fixture 同 seed 条件）生成 v0.4.8 payloads；Phase A 的 acceptance 数字 **必须**在 v0.4.8 sweep 上对照 gold set 重判
3. **Independent LLM classifier**：可选的二次 check — 用 Claude Opus 或 Codex（非 GLM）做一次独立 classifier pass；如与 gold set 一致率 > 85%，作 Phase B 评估的 scale-up bridge

### 5.2 用户可接受 threshold（**H5 fix**）

**UX threshold 分档（非单一 15%）**：

| fab rate (C1 has-findings) | UX 等级 | 判定 |
|---|---|---|
| > 25% | 红 | 用户无法信任；必须 Phase A+B 联动推 |
| 15-25% | 黄 | 可接受但需 UX 提示 "some findings may be speculative" |
| 5-15% | 绿 | 主流 code-review 工具水平；可作默认 |
| < 5% | 蓝 | 行业领先；超出 ROI |

当前 C1 = **31.7%**（红）。Phase A 目标降到 **黄 (20% 以内)**；Phase B 目标降到 **绿 (15% 以内)**。

### 5.3 Per-phase 指标表

| 指标 | v0.4.7 baseline | Phase A 目标 | Phase B 目标 |
|---|---|---|---|
| C1 硬错 fab (has-findings subset) | **31.7%** | ≤ 20% (黄) | ≤ 15% (绿) |
| C2 硬错 fab | 2.7% | ≤ 3% (保持) | ≤ 3% (保持) |
| C3 硬错 fab | 11.2% | ≤ 10% | ≤ 8% |
| KNOWN_FALSE hits | 0 / 1430 | 0 / N | 0 / N |
| C1 approve+[] rate | **38.1%** (C2 fix) | ≥ 35% (不降) | ≥ 35% |
| C2/C3 schema-valid verdict 字段非空率 | ~3% | ≥ 90%（schema fix）| ≥ 95% |
| **Latency (C1 mean)** | 38s | ≤ 40s (+5%) | ≤ 80s (+2x，reflect pass) |
| **Latency (C3 mean)** | 88s | ≤ 90s | ≤ 180s (+2x) |
| **Latency (C3 p90)** | 170s | ≤ 180s | ≤ 360s (+2x) |
| Local test count | 170 | 178+ (A) | 195+ (A+B) |

**Human-gold-set 验证**（**必经门**）：v0.4.8 sweep 的 classifier 结果与 gold set **一致率 ≥ 80%**（防止 classifier drift）。不达标 → 标注再补充 / classifier 修订 → 重评估。

### 5.4 Acceptance criteria 独立性证明

Round 1 C1 blocker 正面回应：
- **Phase A 的 "C1 fab ≤ 20%" 用 gold set 判定**，不用 classifier
- Classifier 仅用来 Phase A 开发过程中做快速迭代信号，**不是 acceptance 判据**
- Gold set 由 Sky 人工标注 + 独立 LLM classifier 交叉验证

## 6. Rollout Strategy（**M2 fix — minimal ablation 先行**）

```
v0.4.7 HEAD (98c4ca0 beta1，final 不发布)
   ↓
v0.4.8-alpha0: Gold set 150 条标注 (§5.1 step 1) — 1 人-day
   ↓
v0.4.8-alpha1a: ABLATION MINIMAL — 仅 A.2 + A.4 落地，100-run sweep 测
   ↓ (gold set 评估 C1 fab↓ 多少)
v0.4.8-alpha1b: A.2+A.4 + A.3 (LGTM exit for /glm:review) — 100-run sweep
   ↓
v0.4.8-alpha1c: + A.1 (temp=0.0) + A.7 (confidence) + A.6 (role) — 完整 Phase A，457-run sweep
   ↓ (gold set 判 Phase A acceptance)
v0.4.8-alpha2: + Phase B.1 reflect pass，457-run sweep (cost 2x，latency ~2x)
   ↓ (gold set 判 Phase B acceptance)
v0.4.8 final: 正式 release，CHANGELOG 引用本 doc + 前后对比数据
```

**每 phase 都 gold-set 评估后再推**。A.2+A.4 minimal 组若已到 "黄 20%"，可考虑直接跳到 Phase B（跳过 A.3/A.1/A.7 等）。

## 7. Risks & Open Questions

### 7.1 Risks

- **R1 (was R1)**: Phase A 单独可能 under-deliver。Mitigation: minimal ablation 先行，失败直接推 A+B
- **R2**: Reflect pass 延迟风险 — C3 review 从 88s mean → 176s mean，超过多数 IDE superuser 容忍。Mitigation: `--no-reflect` flag；async/background mode；B.1 配 `--reflect-cell c1` 支持按 fixture-size 选择性开
- **R3**: Confidence filter 丢真 finding。Mitigation: threshold configurable；alpha 期间同时记录 filtered-out findings + gold-set 比对真假
- **R4**: A.5 reduced blacklist 可能不够。Mitigation: 观察；如 Phase A 未达 20%，考虑 `--context "<domain>"` CLI 注入 fixture 语境
- **R5**: Temperature 0.0 deterministic 可能让输出一成不变固定错。Mitigation: seed A/B + 保留 flag override

### 7.2 Model drift detection（**O2 fix**）

GLM API 静默 post-training 更新是真实风险（5.1 发布 26 天，已更新过 2 次 per 智谱 changelog）。Phase A/B rebaseline 必须**同一 model snapshot**。

**Actionable 机制**：
- 每次 sweep 起点记录 `model` 字段 + **BigModel 的 `id` 字段**（BigModel response metadata 有 `created`、`id`、`model` 三个）
- 保存每次 sweep 的"元 ping" — 对 `glm-5.1` 问 `what is 2+2` 拿 response `fingerprint` 字段（如有；没有则用 `id` 前缀作代理）
- 不同 sweep 的 fingerprint 变化 → 标 "model drift，跨 sweep 对比结果需 double-check"

写 `scripts/ci/check-model-fingerprint.mjs` 在 sweep 起点跑。

### 7.3 Open questions

- **Q1**: BigModel `response_format: json_schema`（非 object）是否支持？如是，可增强 schema enforcement，部分替代 B.1 reflect pass。**需查官方 docs 最新版**。
- **Q2**: gold set 150 条够吗？Wilson 95% CI 在 N=150 / p=30% 附近约 ±7.5%；够判"从 30% 到 20%"这种量级变化，不够判"从 5% 到 3%"精细调整。Phase B 若要精度到 ±2% 需扩到 N≥500。
- **Q3**: `/glm:task` 命令（非 review）是否受 A.1 temperature=0.0 影响？task 可能需要更 creative。Phase A 落地时 task 走另一份 default（temp unset）。
- **Q4**: Codex n=65 sampling 跟全量 classifier 的 fab rate 差距（100% HIGH vs 31.7% overall）提示 severity distribution 很不均。是否按 severity 加权评估？

## 8. Alternatives Considered + Rejected（**M1 补 D0 引证；M3 放回 Phase C**）

| 方案 | Reject 理由 |
|---|---|
| **A0** model switch to Claude Sonnet for small diff | 违反 plugin GLM-only 原则；v0.5+ scope |
| **A0b** auto-fallback on small diff | 同 A0 |
| **B0** self-consistency n=5 as phase 1 | 成本 5x；对 template projection 效果不如 reflect（多个 sample 都会 project 同一个 template）；降级为 Phase C.1 |
| **C0** fine-tune GLM-5.1 | 超出 plugin 能力边界；BigModel 不开放 FT API |
| **D0** drop `response_format: json_object`（第五路发现非主流） | **保留**。依据：(a) glm-client.mjs:630-641 已落地零 retention cost；(b) anti-hallucination-roadmap.md:31-43 其定位 = parser-hardening，防 markdown fence 泄漏 / 空 content (EMPTY_RESPONSE) 等 syntax-layer 失败，对**这部分**有效；(c) 第五路说"不是主流"不等于"有害"，只是说它不是**核心对抗 content fabrication** 的武器 |
| **E0** retire C1 fixture | 砍掉测量手段只是自欺；C1 是 real-world 小 diff 的下限代表 |
| **F0** 请求智谱加 outputSchema 解码层约束 (codex 同款) | BigModel 目前不支持；是否做 feature request 是 v0.5 产品事宜，不是 plugin 工程可控 |

## 9. Review flow (for Round 2+ gate)

此版是 Round 2 DRAFT。提交 Codex 再 review。若：
- **Round 2 ACCEPT / ACCEPT_WITH_COMMENTS**: Status → READY_FOR_APPROVAL，等 Sky final approval → 实施
- **Round 2 REQUEST_CHANGES / BLOCK**: 再 iterate Round 3
- **Round 3 仍 BLOCK**: Redesign，缩小 scope 到 minimal ablation only（A.2 + A.4 + B.1），重写

---

## References

（v1 references 保留，新增）

- `test-automation/review-eval/results/v0.4.7/expanded-sweep.csv` — 457 rows, 含 latency_ms
- Round 1 Codex review 原文（上一轮对话输出）
- Wilson score interval 计算 — 用 150 gold set N 估算 CI
- BigModel API fingerprint 机制 — 待查官方 docs
