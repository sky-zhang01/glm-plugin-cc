# glm-plugin-cc

Claude Code 插件：在 Claude Code session 内通过 **OpenAI 兼容 HTTP** 调用
z.ai 的 GLM 模型，用作外部 reviewer 或 rescue backend。

英文版见 [README.md](./README.md)。

## 用途

面向想在 Claude Code 中获得 GLM 第二意见、但不替换主 Claude 工作流的团队。

它**不是**把 Claude Code CLI 的 provider 替换成 GLM —— 它是一个插件，在
Claude session 内通过 OpenAI 兼容 HTTP 调用 GLM，Claude 仍然是主模型，GLM
只提供第二意见。

设计约束：

- **无状态 HTTP**：没有持久 session，没有 broker 子进程。
- **无 Stop hook**：review 编排保持显式，不安装隐藏的 stop-gate 行为。
- **现代 Node 基线**：运行时命令要求 Node.js `>=24.14.1`；开发 / CI 脚本使用
  npm `>=11.0.0`。运行时仍然零 npm 依赖。
- **OpenAI 兼容协议**：开箱即用 z.ai 的
  `https://open.bigmodel.cn/api/.../chat/completions`；任何其他 OpenAI 兼容
  endpoint（z.ai 或自部署）通过 `custom` preset 接入。

## 安装

加入 Claude Code plugin marketplace：

```
/plugin marketplace add https://github.com/sky-zhang01/glm-plugin-cc
/plugin install glm@glm-plugin-cc
```

## 认证 —— 无需 CLI、无 OAuth

GLM 走 API key 模式。没有 `glm login` OAuth，也不需要外部 CLI ——
插件本身就是运行时。endpoint preset 和 API key 都持久化到
`~/.config/glm-plugin-cc/config.json`（目录 0700 / 文件 0600）。

1. **Endpoint preset**（全部 OpenAI 兼容）：
   - `coding-plan` —— `https://open.bigmodel.cn/api/coding/paas/v4`
     （z.ai 订阅定价，**推荐**）
   - `pay-as-you-go` —— `https://open.bigmodel.cn/api/paas/v4`
     （z.ai 按量计费）
   - `custom` —— 自带 OpenAI 兼容 URL（例如
     `https://api.z.ai/api/paas/v4`，或自部署 endpoint）
2. **API key** —— 持久化到同一 config 文件（字段 `api_key`，文件权限
   0600）。通过 `/glm:setup --api-key <key>` 设置或轮换，或走交互粘贴流。
   不支持环境变量 fallback（`/glm:setup` 是单一入口，与插件本地
   config-file 模型一致）。

### 首次配置

在 Claude Code 中执行：

```
/glm:setup
```

`AskUserQuestion` 会先让你选 preset，然后让你在下一条消息里粘贴 API key。
key 存到 `~/.config/glm-plugin-cc/config.json`，文件权限 0600。

也可以一次性全传：

```
/glm:setup --preset coding-plan --api-key sk-...
```

或者直接在终端跑（让 key 不进 Claude session log）：

```bash
node "$CLAUDE_PLUGIN_ROOT/scripts/glm-companion.mjs" setup --preset coding-plan --api-key "YOUR_KEY"
```

用最小网络探活验证：

```
/glm:setup --ping
```

### 轮换 / 删除 key

- 轮换：`/glm:setup --api-key <new-key>`（preset 保留）。
- 删除：删 `~/.config/glm-plugin-cc/config.json`，重新 setup。

### 可选环境变量覆盖

| 环境变量 | 作用 |
|---|---|
| `GLM_TIMEOUT_MS` | 单次请求超时（默认 900000 = 15 分钟） |

模型 + endpoint 优先级：CLI flag > config 文件 > 内建默认值
（`https://open.bigmodel.cn/api/paas/v4`、`glm-5.1`）。

## 命令

| 命令 | 用途 |
|---|---|
| `/glm:setup [--preset ...] [--base-url ...] [--default-model ...] [--ping]` | 选 endpoint preset，可选连通性探活。 |
| `/glm:review [--base <ref>] [--scope auto\|working-tree\|branch] [--model <name>] [--thinking on\|off] [--reflect]` | 平衡型 git diff review，返回 `schemas/review-output.schema.json` 结构 JSON。`/glm:review` 不接收 trailing focus 文本 —— 自定义 framing 用 `/glm:adversarial-review`。 |
| `/glm:adversarial-review [same flags] [--reflect] [focus text]` | 对抗型 review，优先关注缺陷 + 设计挑战。`--reflect` 启用一次额外 reflection / rerank pass。 |
| `/glm:task [--system <prompt>] [--model <name>] [--thinking on\|off] [prompt]` | 自由 GLM 调用。 |
| `/glm:rescue [same flags]` | 委派给 `glm-rescue` subagent 处理卡住的工作。 |
| `/glm:status [job-id] [--all]` | 列本地 job 历史（无服务端轮询 —— GLM 是无状态的）。 |
| `/glm:result <job-id>` | 重放某 job 的最终输出。 |
| `/glm:cancel <job-id>` | 标记 job 为 cancelled（仅本地 bookkeeping；无服务端中止）。 |

## 模型配置

默认模型 **`glm-5.1`** —— z.ai 当前旗舰 tier。完整模型列表与 benchmark
表格见 [README.md](./README.md#model-configuration)。

插件刻意只用一个默认模型。单次调用用 `--model <name>` 覆盖；项目级用
config 文件的 `default_model`。模型名见 z.ai 的文本模型目录。

视觉模型（`glm-4v`、`glm-4.5v`、`glm-4.6v`、`glm-4.1v-thinking` 等）会被
**拒绝** —— 本插件只发文本消息。

### Thinking / 推理

所有命令**默认开启**思考。任一命令传 `--thinking off` 可以关闭，便于轻量
调用。GLM 通过请求字段 `thinking: {"type": "enabled" | "disabled"}` 路由
这个开关。

## 架构

```
Claude Code session
   │
   ├─ /glm:adversarial-review  (command frontmatter: Bash(node:*))
   │       │
   │       └─ node scripts/glm-companion.mjs adversarial-review ...
   │               │
   │               ├─ lib/git.mjs          (collect diff)
   │               ├─ lib/glm-client.mjs   (HTTP POST to /chat/completions)
   │               ├─ lib/model-catalog.mjs (vision deny-list)
   │               ├─ lib/preset-config.mjs (XDG config)
   │               └─ lib/render.mjs       (schema-validated output)
   │
   └─ 可选的外部 orchestration / review workflow
```

## License

Apache-2.0。见 [LICENSE](./LICENSE) 和 [NOTICE](./NOTICE)。

## 变更日志

见 [CHANGELOG.md](./CHANGELOG.md)（仅源仓提供）。

## 分发

见 [docs/distribution.md](./docs/distribution.md)。
