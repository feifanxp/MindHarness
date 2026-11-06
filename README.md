# Mind Harness

> 一个让人类和 AI 队友平等讨论问题的开源 AI 聊天室。

Mind Harness 是一个面向问题探索、头脑风暴和方案讨论的多 Agent 聊天室。
人类用户和不同专业的 AI Agent 在同一个聊天室里平等交流，秘书 Agent 在后台整理讨论成果。
这里的“平等”指交流方式：Agent 可以追问、质疑和提出自己的判断，用户也可以随时补充背景、纠正或暂停讨论。

我们希望你可以带着一个还没有想清楚的念头进入聊天室，经过追问、补充、质疑和讨论，带着更清晰的问题、判断和下一步离开。

[快速开始](#快速开始) · [配置](#配置) · [文档导航](#文档导航) · [参与贡献](#参与贡献)

基于 MindRoom 二次开发 · 使用 Matrix 开放协议 · 支持本地或云端模型 · 可自托管

## 为什么要做这样的聊天室？

我们观察到，许多 Agent 应用采用“用户提出要求，Agent 执行任务”的上下级关系。
这种关系非常适合完成明确的工作，但当用户自己还没有想清楚问题时，Agent 往往会顺着最初的方向继续展开。

在需要探索问题而非直接执行时，这种交互可能带来两个问题：

- 用户更容易停留在自己熟悉的一条思维链路里。
- 用户提出一个假设后，Agent 更倾向于补全和执行，而不是帮助重新检查问题本身。

现实中的很多好讨论并不是一个人发布指令、其他人提交结果。
它通常由不同的人从不同角度追问、补充、质疑和举例，逐步把模糊的想法变成可以判断的问题。

Mind Harness 想把这种平行讨论带到 AI 场景中。
多个 Agent 可以拥有不同的角色、专业和表达方式，在同一个空间里提供彼此不同的视角。
这种方式也更贴近我们在交流中思考的习惯：想法不一定线性展开，可能在别人的追问和补充中逐渐清晰。
最终的判断仍然由人类用户做出，Agent 的作用是帮助用户把问题看得更完整、想得更深入。
这是我们正在验证的产品方向，并不意味着多个 Agent 的一致意见就一定正确。

## 它和其他 AI 聊天室有什么不同？

### 交互式聊天室创建

用户不需要先理解复杂的 Agent 配置。
创建流程以一到两个关键问题为起点，帮助用户初步梳理问题和诉求，推荐适合参与的 AI 队友。
信息不足时会继续澄清，已有明确背景时则可以直接推荐队友。
确认后，系统会创建一个独立的讨论空间，把相关 Agent 加入其中。

### 更接近真实聊天室的发言方式

在启用平行讨论的聊天室里，Agent 不必等到用户逐个点名。
它们会阅读最新的讨论内容，判断自己是否有具体且有价值的补充，再决定发言或保持安静。

Agent 可以回答其他 Agent 的问题、指出隐藏的假设、补充遗漏的角度，也可以在观点已经充分表达后停止发言。
系统会限制连续的自动发言，避免聊天室变成没有边界的 Agent 自言自语。

### 无感记录与自动整理

聊天室内可以配置一个秘书 Agent，在后台持续阅读讨论内容。
它会把有出处的事实、想法、决定、未决问题和下一步行动整理成结构化笔记，并随着消息编辑和新讨论持续更新。

用户不需要为了总结而中断讨论，也不需要在讨论结束后重新复制整段聊天记录。
新建讨论会自动加入秘书 Agent，界面中称为“整理员”。
打开“讨论成果”可查看分类笔记和原始消息出处，也可以点击“立即整理”手动触发更新。
讨论记录仍然保留在聊天室里，秘书笔记则帮助用户快速回顾已经明确的内容和仍待解决的问题。

## 我们做了什么

### 发言调度器

为平行讨论增加了独立的参与判断、发言槽位和对话边界。
每个 Agent 会基于自己的角色和最新上下文决定是否参与，多个 Agent 同时准备发言时由调度机制协调顺序。

### 引导式聊天室创建与队友匹配

把“我想聊一件事”变成“创建一个适合这件事的讨论环境”。
创建流程会先理解用户的目标，再匹配具有不同视角的 Agent，并自动加入负责记录讨论成果的秘书 Agent。

### 更接近真人的 Agent 发言

Agent 不再只围绕用户最后一句话独立生成答案。
它们会回应具体的上下文，承接其他参与者的观点，在需要时追问、反驳、补充或暂时不发言。
普通讨论以简短回应为主，需要展开或交付时再组织长文；角色差异体现在关注点、判断和措辞中，始终保持 AI 身份。

### 自动内容整理

实现了基于消息出处的增量整理机制。
整理结果区分事实、想法、决定、问题和行动，并保留对应的聊天消息来源，方便回到原始讨论核对上下文。

## 适合什么场景？

| 场景 | 可以怎样讨论 |
| --- | --- |
| 产品需求探索 | 从一个模糊想法出发，让产品、用户研究、设计和研发视角一起检查真正需要解决的问题 |
| 方案评审 | 围绕用户价值、可行性、成本和风险交叉检查方案，保留分歧与待验证假设 |
| 头脑风暴 | 鼓励不同方向的提问和联想，减少过早收敛到单一路径 |
| 研究与分析 | 对已有资料提出解释、反例和进一步核实的问题；需要查资料时，为相应 Agent 配置检索工具 |
| 持续项目讨论 | 接着已有背景继续聊，通过讨论成果回顾决定、未决问题和下一步行动 |

### 一次讨论如何开始？

1. 用一句话说出你想聊的事情，不必先写完整需求文档。
2. 和助理澄清目标、背景或关键约束，查看推荐的 AI 队友。
3. 在“挑选 AI 队友”中选择成员，点击“组队，开始聊”。
4. 进入聊天室，自由补充想法，回应队友的追问，或指定某位 Agent 发表意见。
5. 随时打开“讨论成果”，查看秘书整理的内容及原文出处。

例如，你可以从“我们想做一款更便宜的产品，但又不想只打价格战”开始。
讨论可以逐步澄清目标用户、成本约束和差异化方向，而不必一开始就要求 Agent 交付完整方案。
这只是使用方式示例，不是效果评测。

## 在 MindRoom 基础上保留的能力

Mind Harness 基于 [MindRoom](https://github.com/mindroom-ai/mindroom) 二次开发，保留其 Agent 运行时、配置体系和 Matrix 集成。
上面的引导创建、平行讨论、发言节奏和自动整理，是本项目重点扩展的部分。

<details>
<summary><b>模型、工具与运行时能力</b></summary>

- **模型选择**：可配置云端模型、本地模型和 OpenAI 兼容服务，并为不同 Agent 指定模型，详见[模型配置](docs/configuration/models.md)。
- **Agent 与团队**：通过配置文件或管理界面管理角色、指令、团队与房间，详见[Agent](docs/configuration/agents.md)和[团队](docs/configuration/teams.md)。
- **工具与 MCP**：按需配置检索、文件、外部服务和 MCP 工具，详见[工具目录](docs/tools/index.md)和[MCP](docs/mcp.md)。
- **记忆与知识库**：可为需要长期上下文的 Agent 配置记忆与知识库，详见[记忆](docs/memory.md)和[知识库](docs/knowledge.md)。
- **定时任务与工作流**：保留上游的任务调度和自动化能力，详见[Agent 编排](docs/tools/agent-orchestration.md)。
- **交互界面**：保留流式回复、工具状态、审批和交互式画布等基础能力，具体可用性取决于 Agent 和客户端配置。
- **配置热更新**：管理界面与配置文件使用同一配置体系，多数配置修改可在运行中生效。

这些是可配置的底层能力，并不代表新建讨论中的每位队友都默认启用了它们。
当前引导流程创建的队友默认专注讨论，不启用工具、技能或长期记忆；讨论成果由独立的秘书 Agent 整理。

</details>

## 技术基础与架构

| 层次 | 技术或开源基础 | 在本项目中的作用 |
| --- | --- | --- |
| 通信协议 | Matrix | 承载用户与 Agent 身份、房间、消息和聊天历史 |
| Agent 运行时 | MindRoom、Python、Agno、mindroom-nio | 模型调用、Agent 运行、消息处理及 Matrix 接入 |
| 本项目扩展 | 引导创建、平行讨论、聊天室秘书 | 队友匹配、参与判断、发言调度与讨论成果整理 |
| 聊天客户端 | MindRoom Chat，基于 Cinny | 面向用户的聊天室、队友选择和讨论成果界面 |
| 管理界面与 API | React、TypeScript、Vite、FastAPI | Agent、模型、工具与运行配置管理 |

### 为什么使用 Matrix？

Matrix 为人类用户和 Agent 提供同一套聊天身份与消息机制。
我们可以沿用成熟的房间、消息历史和客户端基础，把开发重点放在人与 AI 如何共同讨论上。

Matrix 也提供跨服务器通信、其他客户端接入与桥接能力，可按部署需求使用。
Mind Harness 的引导创建与讨论成果界面位于本仓库的定制客户端中，其他 Matrix 客户端不一定包含这些界面。

### 项目结构

```text
MindHarness/
├── src/mindroom/       # Agent 运行时、Matrix 集成及本项目后端扩展
├── mindroom-chat/      # 定制聊天客户端与 Mind Harness 讨论流程
├── frontend/           # 管理界面
├── config.yaml         # 仓库开发配置；首次使用请另建本地配置
├── skills/             # Agent 技能与角色定义
├── docs/               # 配置、部署和架构文档
├── local/              # 本地 Matrix 与开发环境辅助配置
└── saas-platform/      # 上游托管平台代码，普通自托管通常无需使用
```

代码中的 Python 包名和 CLI 命令沿用 mindroom。

## 快速开始

Mind Harness 目前处于持续开发阶段，建议从本仓库源码运行，以使用这里的聊天室扩展。
上游发布的安装包、托管服务和应用商店客户端不能直接视为本项目的发行版。

### 1. 准备环境并获取代码

- Python 3.12–3.14 和 [uv](https://docs.astral.sh/uv/)。
- Node.js 24、npm；管理界面首次自动构建还需要 Bun，或预先设置 `MINDROOM_FRONTEND_DIST` 指向已构建的管理界面目录。
- 可用的模型服务，以及一个 Matrix homeserver 和用户账号。
- 如需启动本地 Matrix 开发环境，还需 Docker。

```bash
git clone https://github.com/feifanxp/MindHarness.git
cd MindHarness
uv sync --all-extras
```

### 2. 创建本地配置

沿用原项目的源码运行方式，单独生成本地配置，避免直接使用仓库中的开发模型地址。
以下以 Anthropic 和自托管 Matrix 为例，其他模型提供商见[模型配置](docs/configuration/models.md)。

```bash
uv run mindroom config init --path ./config.local.yaml --matrix-server self-hosted --provider anthropic
```

编辑生成的 `config.local.yaml` 及旁边的 `.env`：

- 填写 Matrix 服务地址、所选模型提供商的凭据，以及 homeserver 所需的账号注册凭据。
- 将配置中的所有 `__MINDROOM_OWNER_USER_ID_FROM_PAIRING__` 替换为你自己的 Matrix 用户 ID，例如 "@alice:matrix.example.com"。
- 保留并检查生成的 `mindroom_user` 配置；引导式建群需要完整 Bot 运行服务及可登录的内部用户。
- 若配置管理界面 API 密钥，启动客户端后需完成对应登录。

详细设置见[入门与账号注册](docs/getting-started.md)及[环境变量](docs/configuration/index.md)。
已有可用 Matrix 服务时可以直接启动后端。
需要本地服务时，沿用上游的可选开发栈命令：

```bash
MINDROOM_CONFIG_PATH=./config.local.yaml uv run mindroom local-stack-setup --synapse-dir local/matrix
```

该命令启动本地 Synapse 和上游聊天客户端容器；体验 Mind Harness 的讨论界面请继续启动下面的本仓库客户端。

### 3. 启动后端与聊天客户端

在仓库根目录启动后端：

```bash
uv run mindroom run --config ./config.local.yaml --api-host 127.0.0.1
```

另开一个终端，在同一目录启动聊天客户端：

```bash
./run-frontend.sh
```

- 聊天界面：本机浏览器打开 http://localhost:3003。
- 管理界面：具备构建产物时访问 http://localhost:8765。
- 客户端开发代理默认连接 http://127.0.0.1:8765；后端地址不同，可在启动客户端时设置 `VITE_MINDROOM_API_PROXY_TARGET`。

登录所配置 homeserver 上的 Matrix 账号后，从讨论入口开始创建聊天室。
仅启动 Dashboard API 不足以创建和运行讨论中的 Bot，后端应保持完整运行。

## 配置

沿用 MindRoom 的配置体系：Agent、团队、模型、房间、记忆和权限集中在选定的 YAML 配置文件中，管理界面也编辑同一份配置。
模型密钥等环境变量放在该配置文件旁的 `.env` 中；修改 `.env` 后需重启后端。

通过 `--config` 或 `MINDROOM_CONFIG_PATH` 选择配置文件。
引导流程会为新讨论配置专用队友、聊天室和秘书，手动配置时可参考以下文档：

| 需要调整什么 | 文档 |
| --- | --- |
| Agent 的专业、指令、模型和工具 | [Agent 配置](docs/configuration/agents.md) |
| 平行讨论、自动发言上限与讨论成果 | [聊天室与空间](docs/rooms.md) |
| 团队协作方式 | [团队配置](docs/configuration/teams.md) |
| 模型提供商与本地模型 | [模型配置](docs/configuration/models.md) |
| 谁可以与 Agent 交互 | [访问控制](docs/authorization.md) |

### Agent 如何回应？

在启用平行讨论的房间中，每位队友独立判断是否有值得补充的内容，由共享发言机制安排顺序，轮到发言时再读取最新讨论。
主动参与也可以选择沉默；连续自动回复受房间配置限制，用户发来新信息后继续讨论。

普通房间继续使用 MindRoom 的响应规则，包括点名、路由和线程内跟进，具体见[线程配置](docs/configuration/threads.md)。
这两种方式可以按房间用途选用。

<details>
<summary><b>保留的 Matrix 聊天命令</b></summary>
<!-- CODE:START -->
<!-- import sys -->
<!-- sys.path.insert(0, 'src') -->
<!-- from mindroom.commands.parsing import _get_command_entries -->
<!-- for entry in _get_command_entries(format_code=True): -->
<!--     print(entry) -->
<!-- CODE:END -->
<!-- OUTPUT:START -->
<!-- ⚠️ This content is auto-generated by `markdown-code-runner`. -->
- `!help [topic]` - Get help
- `!reload-plugins` - Reload configured plugins (admin only)
- `!schedule <task>` - Schedule a task
- `!list_schedules` - List scheduled tasks
- `!cancel_schedule <id>` - Cancel a scheduled task
- `!edit_schedule <id> <task>` - Edit an existing scheduled task
- `!jobs` - List the background jobs running here
- `!cancel_job <id|all>` - Cancel a background job, or all of them here
- `!config <operation>` - Manage configuration
- `!desktop [setup|status|confirm|rotate|disconnect]` - Manage your Desktop target
- `!mode <agent> minimal|standard|show|reset` - Switch one agent between standard tools and a Bash-only interface
- `!model [name|list|reset]` - Show or switch the model used in the current thread
- `!room_model [name|list|reset]` - Show the room model default or switch it (set/reset require a room admin)
- `!thread_mode [room|thread|reset|show]` - Show or switch the thread mode used in the current room (room admin only)
- `!encrypt [confirm]` - Enable end-to-end encryption for this room (irreversible, room admin only)
- `!e2ee` - Show encryption diagnostics for this room
- `!hi` - Show welcome message

<!-- OUTPUT:END -->
</details>

## 部署与自托管

- **已有 Matrix 服务**：连接自己的 homeserver，按[手动部署说明](docs/getting-started.md)配置账号注册。
- **本地开发栈**：使用 local-stack-setup 启动本地 Matrix，再运行本仓库的后端与聊天客户端。
- **容器部署**：参考上游的 [Docker](docs/deployment/docker.md) 与 [Kubernetes](docs/deployment/kubernetes.md) 部署结构，并构建包含本项目修改的后端和客户端产物。
- **其他聊天平台**：有需要时参考 [Matrix 桥接](docs/deployment/bridges/index.md)。

普通自托管通常不需要 saas-platform 目录。
完整部署需分别配置聊天客户端、Agent 后端、Matrix 和模型服务；开发启动脚本不是完整的生产部署方案。

## 文档导航

- [配置总览](docs/configuration/index.md)
- [聊天室与讨论成果](docs/rooms.md)
- [CLI 参考](docs/cli.md)与[聊天命令](docs/chat-commands.md)
- [代码地图](docs/architecture/code-map.md)
- [聊天客户端及修改记录](mindroom-chat/FORK_CHANGES.md)

文档中仍有沿用 MindRoom 名称的上游说明，涉及本项目讨论流程时，以本仓库代码和相应功能文档为准。

## 当前状态与后续方向

当前已实现引导式创建、队友选择、平行讨论、发言调度和后台讨论成果整理。
我们会继续打磨问题澄清、角色匹配、发言节奏和成果整理，并通过真实使用案例检验它们是否帮助用户重新理解问题。

欢迎反馈具体的讨论片段：哪些追问有帮助、哪些发言重复，以及哪些关键信息没有被整理出来。
真实的使用反馈比单纯增加 Agent 数量更能帮助我们改进体验。

## 参与贡献

欢迎通过 Issue、Pull Request 或使用反馈参与项目。
贡献代码前，请阅读 [AGENTS.md](AGENTS.md) 中的开发约定与质量检查要求。

```bash
uv sync --all-extras
uv run pytest
uv run pre-commit run --all-files
```

## 许可证

本仓库包含采用不同许可证的组件：

| 范围 | 许可证文件 |
| --- | --- |
| 核心后端等采用根目录许可的代码 | [Apache License 2.0](LICENSE) |
| 聊天客户端 mindroom-chat/ | [GNU AGPL v3](mindroom-chat/LICENSE) |

各目录和第三方组件的具体条款以其许可证文件及声明为准。

## 致谢

Mind Harness 建立在以下开源项目之上，感谢原作者和社区的贡献：

- [MindRoom](https://github.com/mindroom-ai/mindroom)：本项目二次开发的核心基础。
- [Matrix](https://matrix.org/)：开放的通信协议。
- [MindRoom Chat](https://github.com/mindroom-ai/mindroom-chat) 与 [Cinny](https://github.com/cinnyapp/cinny)：聊天客户端基础。
- [Agno](https://github.com/agno-agi/agno)：Agent 与模型集成能力。
- [mindroom-nio](https://github.com/mindroom-ai/mindroom-nio)：Python Matrix 客户端。
