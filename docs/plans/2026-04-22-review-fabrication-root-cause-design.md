# v0.4.8 Review Fabrication 根因与 Clean-Room 改造设计 (v3)

```
Status: DRAFT
Approval: PENDING
Author: Sky + Claude (main session) + Codex Round 1/2 adversarial + user corrections
Date: 2026-04-22 (v3 supersedes v1/v2)
Scope: "review prompt contract + schema + deterministic filters + optional independent reflect model"
NOT in scope: fab-rate numeric targets, measurement-driven acceptance, PR #51/#52 changes
Prior versions: v2-archived.md (Codex Round 1/2 BLOCK verdicts captured), v1 (dropped)
```

## v2 → v3 关键修正（用户校准后）

| v2 问题 | v3 修正 |
|---|---|
| 建议 "完整 port PR-Agent 351 行 prompt" | **PR-Agent 是 AGPL-3.0**（`/tmp/pr-agent/LICENSE:1` 确认）。v3 = **clean-room adaptation** — 吸收结构和原则，**不复制 prompt 原文**。每条设计原则用自己的话重述 + 引用 donor 行号作 attribution |
| 说"PR-Agent 普遍检测 same-model self-reflect 并 warning" | **过度解读**。`pr_code_suggestions.py:408` 的 warning 仅在**窄 fallback 条件**触发（reasoning model == primary model 且 primary == fallbacks[0]）。v3 改述：**PR-Agent 支持 `model_reasoning` 独立 reasoning model 配置，并有 fallback 保护，但默认是注释提示而非启用** |
| 说 "PR-Agent `model_reasoning` 默认独立" | 错。`configuration.toml:9` 是**注释示例**（`#model_reasoning="o4-mini"`），不是默认启用。v3 据实陈述为 "可配置能力" |
| 依然承诺 "C1 fab% 从 31.7% 降到 ≤ 20%" 等量化目标 | **删除所有 fab-rate 数字目标**。测量工具（自写 fixture + 自标 ground truth + harness 跑 adversarial 非 review + anti-signature classifier overfits sample）不足以支撑量化 acceptance。v3 改为**过程性 acceptance** |
| Scope 含三 phase 全套（temperature + blacklist + reflect pass + verifier 等 12 条） | v3 scope 精简为 4 根支柱：**prompt contract / schema / deterministic filters / optional independent reflect model** |
| v3 混进 PR #51 / #52 | v3 **另起新 PR**，PR #51 的 P2 issues 应先独立修复后 push，与 v0.4.8 不交叉 |

---

## 1. 问题陈述（证据边界前置诚实）

v0.4.7 `/glm:adversarial-review`（**注意**：harness `run-experiment.mjs:178` 调用的是 adversarial 不是 review — 此纠错是 Codex Round 2 NEW-C1 发现）在 457-run 三 fixture sweep 下，**C1 小 diff 上出现值得担忧的 fabrication 模式**：

- GLM 虚构 `@anthropics/claude-code → @anthropic-ai/claude-code` rename（实际是 `@skylab/glm-plugin-cc → glm-plugin-cc`）
- 虚构 `process.mjs 67 lines entirely removed`（实际只删一函数）
- 虚构 `retry.mjs lacks jitter`（实际 `jitterRatio: 0.2` 明写）
- Failure mode 命名：**"same-file semantic overwrite by prior templates"** — file 引用对、line 范围大致对、body 的 quoted claim 来自 pretraining 通用模板，跟实际 diff 脱钩

### 测量工具已知不可靠（v3 据实记录）

以下 caveat **必须**前置，v3 不基于它们做量化决策：

1. **Fixture 是我们自己写的**（`test-automation/review-eval/corpus/{C1,C2,C3}-*/diff.patch`）— 选择偏差未控
2. **Ground truth (`allowed_files` / `known_false_files` / `expected_bugs`) 是我们自己标的** — 标注偏差未控
3. **Harness 调用 `/glm:adversarial-review`，不是 `/glm:review`** — `/glm:review` 从来没实证数据（`commands/review.md` 和 `prompts/review.md` 的 balanced variant 是本地原创；codex 原版 balanced review 烧在 `codex-cli` app-server binary，无可参照 donor）
4. **Anti-signature classifier 在 Codex n=65 sample 上训练，又在同 fixture 上评自己** — train==test 循环论证（Codex Round 1 C1 blocker）
5. **HIGH severity sample 偏置**导致 n=65 report 的 "C1 100% fabricated" 不代表全量（n=65 的 30/30 对应全量 227 findings 里 ~31.7% 硬错 — severity-sampled inflated）

---

## 2. 四大设计支柱（v3 scope）

v3 只落这四条，不做其他 v2 曾列的细项：

### 支柱 A: Review Prompt Contract（clean-room）

**原则**（自述；不复制 donor 原文）：

1. **Partial-context awareness**：prompt 必须明文告知 model — 它看到的是 diff hunks 不是完整 codebase；**缺失 entity 的定义/声明/导入/初始化不构成建议依据**（donor 模式参照 PR-Agent `pr_reviewer_prompts.toml:46`，重述，不 copy）
2. **Quote-derivable body 约束**：finding.body 内引用的 identifier / 字符串 / 路径必须能在 diff bytes 里 literal 找到。不能字面 quote 则 omit（donor：Factory DROID "Never speculate about code you have not opened"，Devin2 "NEVER assume that a given library is available"；重述）
3. **LGTM exit canonicalize**：`findings:[]` + `verdict:"approve"` 是合法输出（v0.4.7 下 GLM 在 C1 上已有 ~38% 自发 approve+[]；v3 把这个行为正式写进 contract）
4. **Severity calibration**：clear bugs/security thorough；low-severity 必须能描述具体触发场景方可 flag；stylistic/design-choice 非 defect 不 flag（donor 模式参照 PR-Agent L49-55，重述）
5. **Tone discipline**：matter-of-fact、禁 filler（"Great job", "Thanks for"）、禁 vague concern、issue 必须 discrete + actionable
6. **`/glm:review` vs `/glm:adversarial-review` 差异化**（Codex H7）：
   - `review`：LGTM exit 合法 + "saying no issues is a successful review"
   - `adversarial-review`：**不**加 LGTM exit + role 保持 skeptical even at zero obvious issues；但原则 1-5 共享

**AGPL 合规**：v3 的 prompt 改造**全部用自述语言**。Donor 引用仅作为**设计证据 attribution**，不进 prompt 文本。实现时（不在本 doc scope）由工程师独立实现，不开浏览器对照抄。

### 支柱 B: Schema-in-Prompt + machine-checkable 引用

**原则**：

1. **Finding schema 升级**：现有 `{file, lineStart, lineEnd, severity, body}` → 增补：
   - `confidence: number[0..1]` — model self-rated；post-process filter 配置化
   - `quoted_evidence: string` — optional，model 摘自 diff 的 literal 字节段落（若用，companion 可做 deterministic 存在性 check）
2. **Pydantic-style schema in prompt**（pattern 参照 PR-Agent，重写不 copy）：prompt 里显式列字段 + description + examples 设 bar；同时保留现有 `response_format: json_object` parser-hardening
3. **引用规范 option**：未来可考虑 Codex `【F:path†L12-L20】` 格式（machine-verifiable 字节锚定）— v0.4.8 不一定做，可放到 v0.4.9 / v0.5 scope。这份 doc 仅 note 方向

**Non-goal**：不切到 YAML output（PR-Agent 用 YAML 是因 `json_object` API 不稳；我们 BigModel 已支持 `json_object`，继续用 JSON）。

### 支柱 C: Deterministic Filters（companion 层，非 LLM）

**原则**：companion 接到 parsed findings 后运行 deterministic validators，**不调用 LLM**。验证失败 → finding 降级（score↓）或丢弃。

验证项：

1. **file-in-allowed-set**：`finding.file ∈ diff 涉及的 file 列表`（harness-time 可靠；runtime 要从 `git diff --name-only` 派生）
2. **line-range 合法性**：`lineStart ≥ 1`、`lineEnd ≥ lineStart`、若 > diff 文件总行数 → invalid
3. **known-false file grep**：对 review runtime 场景，如果我们 ship fixed known_false list（跨 project hallucination pattern 如 `workflow_governor`、`reference_runtime.py`）→ deterministic scan；命中即丢
4. **optional quoted_evidence literal check**：若 model 在 schema 里 return `quoted_evidence`，companion grep 那段字节是否在 `diff --hunk` 范围内

**明确 non-goal**：**不做** Phase B v2 的 "body 里 tokens ≥ 2 在 diff grep" — Codex Round 1 C4 正确指出这跟现有 `scoreCitation` 同构，是已承认的缺陷启发式；v3 放弃此路径。

### 支柱 D: Optional Independent Reflect Model（非 mandatory）

**原则**：

1. 提供 `--reflect-model <name>` CLI 选项（schema 参照 PR-Agent `model_reasoning` **可配置能力**，但默认是 **注释示例**，`configuration.toml:9`；我们 v0.4.8 也 **默认不启用** reflect pass）
2. 若 caller 提供 reflect model name（可以是另一个 GLM 型号、Claude Opus via API、或 Codex via local plugin），companion 做 **second pass** 校验 first-pass findings；参照 PR-Agent reflect prompt 原则（score-based filter + 具体 score=0 条件），**clean-room 重写**我们自己的 reflect prompt
3. 若 caller 不提供，默认 **skip reflect** — 保持 v0.4.7 延迟不变（C1 38s mean / C3 88s mean）
4. 实现 note：reflect pass 用同一 GLM model 做 self-eval 是**降级模式**（not independent），doc 里明示 limitation；建议配置别 model 才真正 independent

**对 Codex Round 2 C4 的正面回应**：
- 不再把 deterministic token-grep 当 "independent" verifier（C4 正确指出循环）
- LLM reflect pass 作 **optional**，并明示 same-model self-eval 是 fallback 不是 true independent
- 真正 independent 需 caller 配置不同 model；v0.4.8 提供**能力**，不强推**默认**

---

## 3. Acceptance（过程性，非量化）

v3 **不承诺**：
- ❌ "C1 fab% ≤ 20%"
- ❌ "LGTM rate ≥ 35%"
- ❌ "Fisher exact contrast 收敛"
- ❌ "reflect pass gain ≥ X%"

v3 **承诺**：

| 指标 | v0.4.7 现状 | v0.4.8 实现判据（非量化） |
|---|---|---|
| Prompt contract 6 原则 | 0 / 6 明文 | **6 / 6 明文**（prompts/review.md + prompts/adversarial-review.md 文本 review 通过） |
| Finding schema | `file/lineStart/lineEnd/severity/body` | 加 `confidence` + optional `quoted_evidence`；JSON schema 测试通过 |
| Deterministic filters | `scoreCitation` only (harness-eval) | runtime **4 个 structural check**（file-in-diff / line-range / known-false grep / optional quote existence） |
| Independent reflect | 无 | **能力存在**（`--reflect-model` flag） + doc 明示 same-model fallback 是 degraded 模式 |
| v0.4.7 测量工具 caveat | 不见文字 | **CHANGELOG + docs/plans/ 明文记录**（fixture 自写 / ground truth 自标 / harness 对象错 / classifier train==test） |
| `/glm:review` vs `/glm:adversarial-review` 差异 | prompt 文本几乎相同 | **文本 diff ≥ role + LGTM exit + example finding 风格** |
| Gold-set human-review（**可选但推荐**） | 无 | 50 条 sampled findings from v0.4.7 runs，**非 Sky 独标**（Codex Round 2 指出 self-annotation bias），用 Codex 或 Claude 独立 annotator，**只作 future baseline**，不作 v0.4.8 acceptance |

**Dogfood sanity**：在 v0.4.8 候选 PR 上跑 `/glm:adversarial-review` 自审，Sky 手动 spot-check 10 条 finding，记录"对比 v0.4.7 主观感受"（无量化 claim）。

---

## 4. 证据基础 + Donor 清单（AGPL 合规版）

所有 donor 仅作**设计证据 attribution**，不在 prompt 文本中复制。

| Donor | License | 引用方式 | 引用位置 |
|---|---|---|---|
| PR-Agent (Qodo Merge) | **AGPL-3.0** | **仅作 pattern 参照**，clean-room 重写；引用行号作 attribution，不复制文本 | `pr_reviewer_prompts.toml:46` partial-context；`:49-55` what-to-flag 原则；`:132` LGTM exit；`:134` security short-circuit；`configuration.toml:47` temperature=0.2；`pr_code_suggestions.py:402-454` reflect 实现 |
| Codex CLI Sep-15 leaked prompt | CL4R1T4S leaked (unclear license) | **仅作 schema concept 参照** | `OPENAI_Codex_Sep-15-2025.md:33-46` — citations schema `【F:path†L12-L20】` |
| Devin 2.0 leaked | CL4R1T4S leaked | **设计原则 attribution**，不抄 | `DEVIN_Devin2_09-08-2025.md:22-26` Truthful & Transparent；`:31` NEVER assume library |
| Factory DROID leaked | CL4R1T4S leaked | 设计原则 attribution | `FACTORY/DROID.txt` "Never speculate" |
| Cursor 2.0 leaked | CL4R1T4S leaked | 设计原则 attribution | `:45` 3-try limit / no uneducated guesses |
| Cline leaked | CL4R1T4S leaked | thinking tag 模式 attribution | `:574` mandatory thinking + no-filler rule |
| Claude Opus 4.7 leaked | CL4R1T4S leaked | abstention 原则 attribution | `:671` NEVER invents attributions |
| Aider | Apache-2.0（已确认） | **可复用实现模式**，非 prompt 文本 | `aider/models.py:424-576` per-model temperature strategy |

**Licensing stance**：
- **Apache-2.0 / MIT donor** → 可实现模式直接借用（加 NOTICE）
- **AGPL donor (PR-Agent)** → **只当 pattern**，clean-room 重写；禁止复制 prompt 文本到我们 repo；不 ship 派生代码
- **Leaked prompts (CL4R1T4S)** → 法律地位不清；只作**设计思想 attribution**，不直接 copy

---

## 5. Rollout（缩 scope，不堆 phase）

```
v0.4.7 HEAD (98c4ca0 beta1, 本地已回滚，final 不发布)
   ↓
v0.4.8-alpha1: 支柱 A + B（prompt contract + schema-in-prompt + confidence 字段）
   ↓ dogfood sanity + Sky spot-check
v0.4.8-alpha2: + 支柱 C (deterministic filters at companion layer)
   ↓ dogfood sanity
v0.4.8-alpha3 (optional): + 支柱 D (--reflect-model flag)
   ↓ dogfood sanity
v0.4.8 final: CHANGELOG 记录 measurement caveat + 引用本 doc；无 fab-rate claim
```

**每 alpha 都独立 PR**（不混进 PR #51/#52）。

**PR #51/#52 的 P2 issues** 独立排查 + 独立 push，不拖到 v0.4.8；v3 明文**不承接** PR #51/#52 的 scope。

---

## 6. Risks & Open Questions

### Risks

- **R1**: Clean-room 重写 prompt 可能 under-perform AGPL 原文（PR-Agent 351 行是长期 tuning 产物）。Mitigation：接受 under-perform 风险换合规；dogfood 验证
- **R2**: `--reflect-model` 若 caller 没配，同 model self-reflect 可能 reinforce first-pass bias。Mitigation：doc 明示；鼓励用户配异模型
- **R3**: 支柱 C 的 deterministic filter 可能丢真 finding（e.g. 合法 meta-discussion of deleted file）。Mitigation：threshold configurable，alpha 期对比记录
- **R4**: Schema 加 `confidence` 字段可能让 GLM "learn to always confidence=0.5"。Mitigation：prompt 指南明确 calibration instructions（0.9+ quote-able only / 0.6-0.8 interpretive / <0.5 omit）
- **R5**: v0.4.8 没量化 acceptance → 外部难以信服改进。Mitigation：文档坦陈 measurement caveat + dogfood + 未来 v0.4.9 可再建 measurement infra

### Open Questions

- **Q1**: 是否真要在 v0.4.8 引入 `--reflect-model`？或放 v0.4.9 避免 scope creep？**待 Sky 决定**
- **Q2**: `/glm:review` 的 prompt 本地原创，无 donor — 是否让它沿用 `/glm:adversarial-review` prompt base + LGTM 加成，还是独立重写？
- **Q3**: BigModel `response_format: json_schema`（非 object）是否 available？若 available，可部分替代支柱 C 的 line-range check
- **Q4**: CHANGELOG v0.4.7 的 "properly-powered null" 语言需要 retroactive correction 吗？（那个 claim 基于现在已知不可靠的测量）**倾向 yes**，单独 patch 版

---

## 7. Codex Round 1 + Round 2 blocker 回应一览

| Round | Blocker | v2 响应 | v3 响应 |
|---|---|---|---|
| **R1-C1** classifier train=test | v2 加 gold set N=150 | v3 **不作量化 acceptance**；classifier 仅保留 harness-dev 内部信号；gold set 仅 future baseline |
| **R1-C2** LGTM 0% 事实错 | v2 改 ≥35% 维持 | v3 **不作数字目标**；仅 canonicalize 已有行为；`/glm:review` 加 exit，`/glm:adversarial-review` 不加 |
| **R1-C3** blacklist overfit | v2 砍到 2 条 | v3 **完全不用 noise blacklist**；改 PR-Agent 模式的 6 原则 clean-room 自述 |
| **R1-C4** reflect pass circular | v2 删 token-grep，留 LLM reflect | v3 确认删 token-grep；LLM reflect 作 **optional**，同 model self-eval 明示 degraded；真·independent 需 caller 配不同 model |
| **R2-NEW-C1** 基线对象混淆 | — | v3 **doc §1 明文** harness 跑 adversarial 非 review；`/glm:review` 从未测过 |
| **R2-NEW-C2** gold set 多 phase 复用 = 流程 train=test | — | v3 **gold set 不作 acceptance**；仅 future baseline；无 phase-by-phase 评估流程 |
| **R2-H7** review vs adversarial 未分 | — | v3 **支柱 A.6 明确拆开**：LGTM 只加 review；role framing 差异化 |
| **R1-H6** wall-clock latency | v2 加表 | v3 支柱 D 设 optional，默认不上 reflect pass → **无 latency regression** |

---

## 8. v3 是 DRAFT；下一步

- Codex Round 3 adversarial review（若需）
- Sky approval
- 实施分 alpha1/2/3，每 alpha 独立 PR
- v3 **不** 触及 PR #51/#52

---

## References

- 本 repo 下：
  - `docs/plans/2026-04-22-review-fabrication-root-cause-design.v2-archived.md`（Round 1/2 历史）
  - `docs/anti-hallucination-roadmap.md`（v0.4.7 老 roadmap；将由 v0.4.8 CHANGELOG 标 superseded）
  - `test-automation/review-eval/results/v0.4.7/expanded-sweep.csv`（457-run baseline，附 measurement caveat）
- Donor:
  - PR-Agent (AGPL-3.0): `/tmp/pr-agent/` — pattern-only
  - Aider (Apache-2.0): `/tmp/aider/`
  - CL4R1T4S leaked: `/tmp/cl4r1t4s-raw/` (15 files fetched)
  - Continue (Apache-2.0): `/tmp/continue/` (narrow use, dependency-security agent)
- External:
  - Wallat et al. 2024, arXiv 2412.18004 — "Correctness is not Faithfulness in RAG Attributions"
