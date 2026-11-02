import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  Lightbulb,
  MessageCircle,
  Network,
  RotateCcw,
  Users,
} from 'lucide-react';

type SectionKey =
  | 'resonance'
  | 'fragments'
  | 'perspective'
  | 'problem'
  | 'inspiration'
  | 'product'
  | 'evidence'
  | 'value';
type AgentColor = 'coral' | 'blue' | 'violet' | 'lime';
type Section = {
  key: SectionKey;
  kicker: string;
  label: string;
  title: string;
  summary: string;
  notes: string;
  transition: string;
};

const sections: Section[] = [
  {
    key: 'resonance',
    kicker: '01 / A FAMILIAR MOMENT',
    label: '买不买平板',
    title: '我说买，你说对；我说不买，你也说对。',
    summary: '我正因为拿不定主意，才来问你。\n怎么最后，还是我说什么都对？',
    notes:
      '大家有没有这种经历：想买个东西，又有点犹豫，就去问 AI。\n我觉得买了能提高效率，它帮我论证为什么值得买。\n我又觉得没必要，它马上帮我论证为什么不买更好。\n我的使用场景和预算都没变，只是态度摇摆了一下。\n可它每次都很支持我。\n我本来想找个人帮我拿拿主意，结果像是找了个人帮我把两边的话都说漂亮。',
    transition: '这是我们自己拿不定主意的时候。\n还有些时候，我们连自己的想法都还没说完整。',
  },
  {
    key: 'fragments',
    kicker: '02 / THINKING OUT LOUD',
    label: '血压计需求',
    title: '我也得聊到这儿，才知道自己到底想要什么。',
    summary:
      '一开始，我只想到“屏幕大一点”。\n聊着聊着，才想起摆放角度、信息位置和爸妈看结果的习惯。',
    notes:
      '比如我们想做一款给爸妈用的血压计。\n最开始能说出来的，可能就是“屏幕大一点，方便看”。\n看到 AI 的方案，我才想起：机器放在桌上，坐着看，角度是不是也有影响？\n接着又想起，他们找的是这次的结果，不一定想看那么多历史数据。\n这时候我才慢慢意识到，要讨论的可能是整个“量完以后怎么看结果”的过程。\n这些想法不是我故意没说，也不是提前藏好了等着补充。\n是聊到这里，我才把它们连起来。\n如果每冒出一点想法就立刻追加一项功能，清单越来越长，问题却未必越来越清楚。',
    transition: '有些想法，是聊着聊着才想起来的。\n还有一些角度，可能我们聊了半天也没想到。',
  },
  {
    key: 'perspective',
    kicker: '03 / ANOTHER PERSPECTIVE',
    label: '客户流失',
    title: '折扣、优惠券、积分……我们换过角度吗？',
    summary: '方案换了好几版。\n但我们一直在回答同一个问题：怎么让它更便宜？',
    notes:
      '比如老客户最近不怎么买了。\n如果我习惯从促销的角度想，就会先问：要不要打折？\nAI 给了打折方案，我嫌利润太低，它就改成优惠券。\n我再说不想让客户总等促销，它又给了会员积分。\n你看，我们确实讨论了好几轮，方案也越来越细。\n但仔细想想，这些是不是都还在讨论价格优惠？\n如果换个做客服的同事，他可能会问：客户上次遇到的问题解决了吗？\n做产品的同事可能会问：他们用起来是不是还有什么不方便？\n做客户研究的人还可能问：这些客户现在还有没有购买需求？\n这些都只是需要确认的方向，但我们刚才一条也没聊到。',
    transition: '现在回头看，这三个例子，分别卡在了三个不同的地方。',
  },
  {
    key: 'problem',
    kicker: '04 / THREE QUESTIONS',
    label: '三个问题',
    title: '它顺着我说，我边说边想，我们还可能一起漏掉一个角度。',
    summary:
      '- 关系：我像领导，它忙着配合。\n- 过程：我的想法，本来就是一边聊一边长出来的。\n- 视角：我没想到的方向，对话里也可能一直没人提。',
    notes:
      '第一个，是我们和 AI 的关系。\n很多时候，我们给方向，它负责回应和完成，有点像领导和下属。\n我们希望有人帮忙判断，它却可能更忙着顺着我们的意思说。\n\n第二个，是我们的想法怎么形成。\n我们并不是一开始就有一份完整需求，只等着输入给 AI。\n很多时候，先想到一块，聊一聊又想起另一块，最后才慢慢拼起来。\n所以不能把“你先全部想清楚”当作交流的前提。\n\n第三个，是我们从哪些角度看问题。\n我们容易先从自己熟悉的工作和经验出发。\n如果 AI 也一直沿着这个方向回答，对话可以很深入，却仍然漏掉其他重要的角度。\n\n所以我们想尝试的，是一种能容纳这三件事的交流方式：有人不急着认同我，能跟着我把零散想法聊清楚，也会带来我没有想到的角度。',
    transition:
      '现实里遇到这种事，我们会不会找几个背景不同的同事或朋友，一起聊一聊？\n如果把这样的交流方式带到人与 AI 的协作里，会是什么样？',
  },
  {
    key: 'inspiration',
    kicker: '05 / THINK TOGETHER',
    label: '找队友聊聊',
    title: '没想清楚的事，找几个背景不同的人聊聊。',
    summary:
      '不用先把想法整理成一份完整方案。\n把想到的先说出来，大家帮着问、帮着补，再一起往下想。',
    notes:
      '现实中碰到这种事，我们会找谁？\n可能是一个做设计的同事，一个懂用户的人，再加一个懂技术的朋友。\n我们不一定一上来就有完整方案，可能只是说：“我有个想法，你们帮我看看。”\n有人会问一句，把我们还没说出来的场景带出来。\n有人会接着别人的话补充，也有人提醒一个我们没想到的问题。\n这里不需要每个人都反对我，也不需要每个人轮流汇报。\n我们想要的是，大家能带着各自的判断，一起把事情聊清楚。\n那么，能不能把这样的几位 AI 队友放进一个聊天室里？\n这就是我们想用 Mind Harness 尝试的事情。',
    transition: '',
  },
  {
    key: 'product',
    kicker: '06 / MEET MIND HARNESS',
    label: 'Mind Harness',
    title: '让人与 AI 组成一个真正能够交流的团队。',
    summary:
      'Mind Harness 把不同角色、背景和职责的 Agent 放进同一个聊天室，让开放讨论和任务执行都拥有合适的协作方式。',
    notes:
      'Mind Harness 把不同角色、背景和职责的 Agent 放进同一个聊天室，让开放讨论和任务执行都拥有合适的协作方式。',
    transition: '',
  },
  {
    key: 'evidence',
    kicker: '07 / SEE THE DIFFERENCE',
    label: '效果对比',
    title: '同一个问题，不同的协作方式。',
    summary:
      '我们用相同的问题条件，观察单 Agent 和多 Agent 平行讨论分别带来了什么。\n结论交给真实案例。',
    notes:
      '我们用相同的问题条件，观察单 Agent 和多 Agent 平行讨论分别带来了什么。\n结论交给真实案例。',
    transition: '',
  },
  {
    key: 'value',
    kicker: '08 / FOR PRODUCT MANAGERS',
    label: '价值与定位',
    title: '产品经理，不只是向 AI 寻求答案。',
    summary: '而是与一支 AI 团队共同探索问题、碰撞想法、形成方案。',
    notes: '而是与一支 AI 团队共同探索问题、碰撞想法、形成方案。',
    transition: '',
  },
];

function AgentAvatar({ color, label }: { color: AgentColor; label: string }) {
  return (
    <span className={`mh-avatar mh-avatar--${color}`} aria-hidden="true">
      {label}
    </span>
  );
}

function CardTop({ title, badge = '模拟对话' }: { title: string; badge?: string }) {
  return (
    <div className="mh-proof-card__topline">
      <span>{title}</span>
      <span className="mh-sample-label">{badge}</span>
    </div>
  );
}

function ChatBubble({
  name,
  avatar,
  color,
  children,
}: {
  name: string;
  avatar: string;
  color: AgentColor;
  children: ReactNode;
}) {
  return (
    <div className={`mh-chat-row ${name === '我' ? 'mh-chat-row--human' : ''}`}>
      <AgentAvatar color={color} label={avatar} />
      <div className="mh-chat-content">
        <div className="mh-chat-meta">{name}</div>
        <div className="mh-chat-bubble">{children}</div>
      </div>
    </div>
  );
}

type Message = { name: string; text: string; color?: AgentColor; highlight?: string };
type Conversation = {
  title: string;
  heading: string;
  steps: Message[][];
  labels: string[];
  takeaway: string;
  fragments?: string[];
};

const conversations: Record<
  'resonance' | 'fragments' | 'perspective' | 'inspiration',
  Conversation
> = {
  resonance: {
    title: '01 / SHOULD I BUY IT?',
    heading: '买不买平板这件小事',
    labels: ['我想买', '我又不想买了', '所以，你的判断呢？'],
    steps: [
      [
        {
          name: '我',
          text: '手机和电脑都有了，买平板也在预算内，主要想用来学英语。我觉得买个新设备，会更有动力，你觉得呢？',
        },
        {
          name: 'AI',
          text: '很有道理！新设备能带来新鲜感，平板看课、做笔记也方便，值得投入。',
          highlight: '值得投入',
        },
      ],
      [
        { name: '我', text: '但我又觉得，学英语还是靠自觉，买设备可能只是给自己找个花钱的理由。' },
        {
          name: 'AI',
          text: '你说得很对！既然已有手机和电脑，就没必要再买平板，把精力放在学习习惯上更明智。',
          highlight: '没必要再买',
        },
      ],
      [],
    ],
    takeaway: '我还没拿定主意，你倒是每次都很支持我。',
  },
  fragments: {
    title: '02 / A THOUGHT TAKES SHAPE',
    heading: '血压计的需求，一点点浮现',
    labels: ['先想到大屏', '又想起角度', '还有信息位置', '问题开始成形'],
    steps: [
      [
        { name: '我', text: '下一款血压计，我想把屏幕做大一点，方便爸妈看。' },
        { name: 'AI', text: '好的，需求可以设为加大屏幕，同时放大测量数字。' },
      ],
      [
        { name: '我', text: '对了，机器一般放在餐桌上，他们坐着看，可能还跟屏幕角度有关。' },
        { name: 'AI', text: '明白，再增加屏幕倾斜设计。' },
      ],
      [
        { name: '我', text: '还有，上次我爸想找刚测的结果，却在看历史记录那一栏。' },
        { name: 'AI', text: '好的，再增加本次结果与历史记录的分区标识。' },
      ],
      [
        {
          name: '我',
          text: '等等，我们是不是该先把“量完以后怎么看结果”这个过程聊清楚，再决定屏幕怎么做？',
        },
      ],
    ],
    fragments: ['大屏', '角度', '信息位置'],
    takeaway: '量完以后，怎么看结果？',
  },
  perspective: {
    title: '03 / INSIDE THE SAME FRAME',
    heading: '我们一直在聊“价格”',
    labels: ['打折', '优惠券', '会员积分', '看看框外的角度'],
    steps: [
      [
        { name: '我', text: '老客户最近不怎么买了，要不做个折扣活动？' },
        { name: 'AI', text: '可以，面向老客户发放专属折扣，吸引他们回来购买。' },
      ],
      [
        { name: '我', text: '直接打折太伤利润了。' },
        { name: 'AI', text: '那可以改成满额优惠券，设置使用门槛。' },
      ],
      [
        { name: '我', text: '又怕他们以后只等着领券。' },
        { name: 'AI', text: '可以换成会员积分，让优惠和长期消费绑定。' },
      ],
      [],
    ],
    fragments: ['折扣', '优惠券', '积分'],
    takeaway: '方案换了好几版，我们换过角度吗？',
  },
  inspiration: {
    title: '05 / A CONVERSATION WITH PEERS',
    heading: '这次，大家接着彼此的话聊',
    labels: ['先说一个想法', '追问场景', '补充理解', '提出验证办法'],
    steps: [
      [{ name: '我', text: '我想让爸妈更容易看清血压计的结果，现在只想到屏幕大一点。' }],
      [
        { name: '做用户研究的同事', color: 'coral', text: '先说说他们怎么用？机器一般放在哪儿？' },
        { name: '我', text: '放在餐桌上，坐着看。对了，我爸有一次把历史记录当成本次结果了。' },
      ],
      [
        {
          name: '做设计的同事',
          color: 'violet',
          text: '那我们可以先画一下量完后的画面，看看本次结果是不是够突出。',
        },
      ],
      [
        {
          name: '做研发的同事',
          color: 'blue',
          text: '可以。如果先改信息布局，我们也能看看现有屏幕够不够用，再决定是否换屏。',
        },
      ],
    ],
    takeaway: '如果这些队友是 AI 呢？',
  },
};

function HighlightedText({ text, highlight }: { text: string; highlight?: string }) {
  if (!highlight) return <>{text}</>;
  const index = text.indexOf(highlight);
  return (
    <>
      {text.slice(0, index)}
      <mark>{highlight}</mark>
      {text.slice(index + highlight.length)}
    </>
  );
}

function RevealControls({
  step,
  labels,
  onChange,
}: {
  step: number;
  labels: string[];
  onChange: (step: number) => void;
}) {
  const last = step === labels.length - 1;
  return (
    <div className="mh-reveal-controls">
      <button
        className="mh-replay"
        onClick={() => onChange(0)}
        disabled={step === 0}
        aria-label="重播本页"
      >
        <RotateCcw size={15} />
      </button>
      <span className="mh-reveal-count" role="status">
        {step + 1} / {labels.length}
      </span>
      <button className="mh-reveal-next" onClick={() => onChange(step + 1)} disabled={last}>
        {last ? '本页已展开' : labels[step + 1]}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}

function ConversationVisual({ kind }: { kind: keyof typeof conversations }) {
  const [step, setStep] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  const conversation = conversations[kind];
  const last = step === conversation.steps.length - 1;
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = step === 0 ? 0 : log.scrollHeight;
  }, [step]);
  return (
    <div className={`mh-proof-card mh-conversation mh-conversation--${kind}`}>
      <CardTop title={conversation.title} />
      <h3 className="mh-demo-heading">{conversation.heading}</h3>
      <div
        className="mh-conversation-log"
        ref={logRef}
        tabIndex={0}
        role="region"
        aria-label={`${conversation.heading}的对话记录`}
      >
        {conversation.steps.slice(0, step + 1).map((messages, index) => (
          <div className="mh-conversation-round" key={index}>
            {messages.length > 0 && (
              <div className="mh-round-label">
                {String(index + 1).padStart(2, '0')} / {conversation.labels[index]}
              </div>
            )}
            {messages.map((message, messageIndex) => (
              <ChatBubble
                key={messageIndex}
                name={message.name}
                avatar={
                  message.name === '我'
                    ? '我'
                    : message.name === 'AI'
                      ? 'AI'
                      : message.name.slice(1, 2)
                }
                color={message.color ?? (message.name === '我' ? 'lime' : 'blue')}
              >
                <HighlightedText text={message.text} highlight={message.highlight} />
              </ChatBubble>
            ))}
          </div>
        ))}
        {last && kind === 'perspective' && (
          <div className="mh-outside-perspectives">
            <p>框外，还有这些待确认的问题</p>
            <div>
              <b>服务</b>
              <span>上次的服务问题，有没有解决？</span>
            </div>
            <div>
              <b>产品</b>
              <span>产品是不是哪里不好用？</span>
            </div>
            <div>
              <b>需求</b>
              <span>现在还有没有再次购买的需要？</span>
            </div>
          </div>
        )}
      </div>
      {conversation.fragments && (
        <div
          className="mh-fragment-trail"
          aria-label={kind === 'perspective' ? '价格维度' : '逐渐浮现的想法'}
        >
          {kind === 'perspective' && <b>价格</b>}
          {conversation.fragments.slice(0, Math.min(step + 1, 3)).map((fragment, index) => (
            <span key={fragment}>
              {index > 0 && <ArrowRight size={12} />} {fragment}
            </span>
          ))}
        </div>
      )}
      {last && <p className="mh-takeaway">{conversation.takeaway}</p>}
      <RevealControls step={step} labels={conversation.labels} onChange={setStep} />
    </div>
  );
}

const problems = [
  {
    axis: '关系',
    example: '买不买平板',
    issue: 'AI 跟着我的立场走',
    need: '一起权衡，而不只是认同',
  },
  {
    axis: '过程',
    example: '血压计需求',
    issue: '想法逐步浮现，回答却逐项执行',
    need: '容纳联想、追问和重新梳理',
  },
  {
    axis: '视角',
    example: '客户流失',
    issue: '讨论深入，却始终围着价格转',
    need: '引入其他专业和经验视角',
  },
];

function ProblemVisual() {
  const [step, setStep] = useState(0);
  return (
    <div className="mh-proof-card mh-problems">
      <CardTop title="04 / THREE QUESTIONS" badge="回看三个例子" />
      <h3 className="mh-demo-heading">分别卡在了三个地方</h3>
      <div className="mh-problem-list">
        {problems.slice(0, step + 1).map((problem, index) => (
          <div className="mh-problem-row" key={problem.axis}>
            <div className="mh-problem-axis">
              <span>0{index + 1}</span>
              <b>{problem.axis}</b>
            </div>
            <div>
              <small>{problem.example}</small>
              <h4>{problem.issue}</h4>
              <p>
                <ArrowRight size={14} />
                {problem.need}
              </p>
            </div>
          </div>
        ))}
      </div>
      <RevealControls
        step={step}
        labels={['关系', '再看思考过程', '再看思考视角']}
        onChange={setStep}
      />
    </div>
  );
}
function ProductVisual() {
  const [mode, setMode] = useState<'parallel' | 'execution'>('parallel');
  return (
    <div className="mh-proof-card mh-proof-card--room">
      <CardTop title="MIND HARNESS / PROJECT ROOM" badge="聊天室示意" />
      <div className="mh-room-title">
        <div>
          <span className="mh-eyebrow">PROJECT / PRODUCT EXPLORATION</span>
          <h3>为新用户设计第一次体验</h3>
        </div>
        <span className="mh-room-lock">● PRIVATE</span>
      </div>
      <div className="mh-room-agents">
        <div className="mh-room-agent">
          <AgentAvatar color="coral" label="U" />
          <span>
            <strong>用户研究员</strong>
            <small>理解真实需求</small>
          </span>
        </div>
        <div className="mh-room-agent">
          <AgentAvatar color="blue" label="P" />
          <span>
            <strong>产品经理</strong>
            <small>定义问题边界</small>
          </span>
        </div>
        <div className="mh-room-agent">
          <AgentAvatar color="violet" label="D" />
          <span>
            <strong>设计师</strong>
            <small>寻找体验方向</small>
          </span>
        </div>
      </div>
      <div className="mh-mode-toggle" role="group" aria-label="Mind Harness 工作模式">
        <button
          className={mode === 'parallel' ? 'is-active' : ''}
          onClick={() => setMode('parallel')}
          aria-pressed={mode === 'parallel'}
        >
          <Users size={14} />
          平行讨论
        </button>
        <button
          className={mode === 'execution' ? 'is-active' : ''}
          onClick={() => setMode('execution')}
          aria-pressed={mode === 'execution'}
        >
          <Network size={14} />
          主从执行
        </button>
      </div>
      <div className="mh-room-thread">
        {mode === 'parallel' ? (
          <>
            <ChatBubble name="用户研究员" avatar="U" color="coral">
              我们是不是先问：用户第一次打开时，真正害怕的是什么？
            </ChatBubble>
            <ChatBubble name="设计师" avatar="D" color="violet">
              我接着这个问题，想到可以把“第一次体验”做成一条可回看的路径。
            </ChatBubble>
          </>
        ) : (
          <>
            <ChatBubble name="产品经理 · Lead" avatar="P" color="blue">
              我来拆分任务：研究员看用户，设计师看路径，最后汇总成一个验证方案。
            </ChatBubble>
            <div className="mh-task-line">
              <span />
              <span />
              <span /> 三个角色正在并行推进
            </div>
          </>
        )}
      </div>
      <div className="mh-room-input">
        <MessageCircle size={15} />
        <span>在聊天室里继续探索…</span>
      </div>
    </div>
  );
}

function EvidenceVisual() {
  return (
    <div className="mh-proof-card mh-proof-card--evidence">
      <CardTop title="CASE STUDY / SAME PROMPT" badge="模拟示例 · 真实记录待补" />
      <div className="mh-evidence-grid">
        <div className="mh-evidence-column mh-evidence-column--single">
          <div className="mh-evidence-label">
            <span className="mh-label-dot" />单 Agent
          </div>
          <p className="mh-evidence-question">“怎样提升新用户留存？”</p>
          <div className="mh-evidence-answer">
            可以优化 onboarding 流程，增加个性化推荐，并通过数据分析持续迭代。
          </div>
          <div className="mh-evidence-result">
            <span>1</span> 条主线建议（示意）
          </div>
        </div>
        <div className="mh-evidence-column mh-evidence-column--multi">
          <div className="mh-evidence-label">
            <span className="mh-label-dot mh-label-dot--bright" />
            Mind Harness
          </div>
          <p className="mh-evidence-question">“怎样提升新用户留存？”</p>
          <div className="mh-evidence-stack">
            <span>研究员：先找出流失发生在哪一步</span>
            <span>设计师：让用户看到自己的进度</span>
            <span>产品经理：用一个可验证的假设收敛</span>
          </div>
          <div className="mh-evidence-result mh-evidence-result--bright">
            <span>3</span> 个视角 · 1 个待验证假设（示意）
          </div>
        </div>
      </div>
      <div className="mh-evidence-note">
        <Lightbulb size={15} /> 不是预设多 Agent 一定更好，而是让差异可以被看见、被验证。
      </div>
    </div>
  );
}

function ValueVisual() {
  return (
    <div className="mh-proof-card mh-proof-card--value">
      <CardTop title="FOR PRODUCT MANAGERS" badge="价值与定位" />
      <div className="mh-value-quote">“这次我们先不急着找答案，先把问题问得更完整。”</div>
      <div className="mh-value-orbit">
        <div className="mh-orbit-ring mh-orbit-ring--outer" />
        <div className="mh-orbit-ring mh-orbit-ring--inner" />
        <span className="mh-orbit-core">PM</span>
        <span className="mh-orbit-tag mh-orbit-tag--a">用户</span>
        <span className="mh-orbit-tag mh-orbit-tag--b">市场</span>
        <span className="mh-orbit-tag mh-orbit-tag--c">设计</span>
        <span className="mh-orbit-tag mh-orbit-tag--d">技术</span>
      </div>
      <div className="mh-value-points">
        <span>需求探索</span>
        <span>产品定义</span>
        <span>方案讨论</span>
        <span>创意发散</span>
      </div>
    </div>
  );
}

function SectionVisual({ section }: { section: SectionKey }) {
  switch (section) {
    case 'resonance':
    case 'fragments':
    case 'perspective':
    case 'inspiration':
      return <ConversationVisual kind={section} />;
    case 'problem':
      return <ProblemVisual />;
    case 'product':
      return <ProductVisual />;
    case 'evidence':
      return <EvidenceVisual />;
    case 'value':
      return <ValueVisual />;
  }
}

export function PresentationPage() {
  const [activeIndex, setActiveIndex] = useState(0);
  const progress = `${((activeIndex + 1) / sections.length) * 100}%`;
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(sections.length - 1, index));
    document.getElementById(`mh-slide-${sections[bounded].key}`)?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
  }, []);

  useEffect(() => {
    const previousTitle = document.title;
    const previousLanguage = document.documentElement.lang;
    document.title = 'Mind Harness — Presentation';
    document.documentElement.lang = 'zh-CN';
    let observer: IntersectionObserver | undefined;
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        entries => {
          entries.forEach(entry => {
            if (entry.isIntersecting) {
              const index = sections.findIndex(
                section => entry.target.id === `mh-slide-${section.key}`
              );
              if (index >= 0) setActiveIndex(index);
            }
          });
        },
        {
          rootMargin: `-${window.innerHeight * 0.4}px 0px -${window.innerHeight * 0.55}px 0px`,
          threshold: 0,
        }
      );
      mainRef.current
        ?.querySelectorAll<HTMLElement>('.mh-slide')
        .forEach(section => observer?.observe(section));
    };
    observe();
    window.addEventListener('resize', observe);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', observe);
      document.title = previousTitle;
      document.documentElement.lang = previousLanguage;
    };
  }, []);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (event.target instanceof HTMLElement &&
          event.target.closest("button,a,input,textarea,select,summary,[contenteditable='true']"))
      )
        return;
      if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
        event.preventDefault();
        navigate(activeIndex + (event.key === 'ArrowRight' ? 1 : -1));
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [activeIndex, navigate]);

  return (
    <div className="mh-presentation" lang="zh-CN">
      <header className="mh-presentation-header">
        <a
          className="mh-brand"
          href="#mh-slide-resonance"
          onClick={event => {
            event.preventDefault();
            navigate(0);
          }}
          aria-label="回到开头"
        >
          <span className="mh-brand-mark" aria-hidden="true">
            <span />
            <span />
            <span />
          </span>
          <span>MIND HARNESS</span>
        </a>
        <div className="mh-header-center">
          <span>AI COLLABORATION / INTERNAL SHOWCASE</span>
          <span className="mh-header-slash">/</span>
          <strong>V1.3</strong>
        </div>
        <div
          className="mh-header-progress"
          aria-label={`第 ${activeIndex + 1} 页，共 ${sections.length} 页`}
        >
          <span>{String(activeIndex + 1).padStart(2, '0')}</span>
          <i aria-hidden="true">
            <b style={{ inlineSize: progress }} />
          </i>
          <span>{String(sections.length).padStart(2, '0')}</span>
        </div>
      </header>
      <nav className="mh-section-nav" aria-label="演示章节">
        {sections.map((section, index) => (
          <a
            href={`#mh-slide-${section.key}`}
            key={section.key}
            className={index === activeIndex ? 'is-active' : ''}
            aria-current={index === activeIndex ? 'step' : undefined}
            aria-label={`${index + 1}. ${section.label}`}
            title={section.label}
            onClick={event => {
              event.preventDefault();
              navigate(index);
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <i />
          </a>
        ))}
      </nav>
      <main className="mh-presentation-main" ref={mainRef}>
        {sections.map((section, index) => {
          const Heading = index === 0 ? 'h1' : 'h2';
          return (
            <section
              key={section.key}
              id={`mh-slide-${section.key}`}
              aria-labelledby={`mh-title-${section.key}`}
              className={`mh-slide mh-slide--${section.key}`}
            >
              <div className="mh-slide-copy">
                <div className="mh-slide-kicker">
                  <span className="mh-kicker-line" />
                  {section.kicker}
                </div>
                <Heading id={`mh-title-${section.key}`} className="mh-slide-title">
                  {section.title
                    .split(/(?<=[，；。？])/u)
                    .filter(Boolean)
                    .map(phrase => (
                      <span className="mh-title-phrase" key={phrase}>
                        {phrase}
                      </span>
                    ))}
                </Heading>
                {section.key === 'problem' ? (
                  <ul className="mh-summary-list">
                    {section.summary
                      .split('\n')
                      .filter(Boolean)
                      .map(line => (
                        <li key={line}>{line.replace(/^- /, '')}</li>
                      ))}
                  </ul>
                ) : (
                  <p className="mh-slide-summary">{section.summary}</p>
                )}
                {section.key === 'product' && (
                  <div className="mh-product-facts">
                    <span>
                      <strong>1+</strong>人类参与者
                    </span>
                    <span>
                      <strong>1+</strong>AI 参与者
                    </span>
                    <span>
                      <strong>∞</strong>种视角
                    </span>
                  </div>
                )}
                {section.key === 'evidence' && (
                  <div className="mh-evidence-tags">
                    <span>更多角度</span>
                    <span>主动补充</span>
                    <span>发现盲区</span>
                  </div>
                )}
                {section.key === 'value' && (
                  <div className="mh-value-closer">
                    <span className="mh-quote-mark">“</span>
                    <p>让产品经理与一支 AI 团队共同探索问题、碰撞想法、形成方案。</p>
                  </div>
                )}
                <div className="mh-copy-actions">
                  <button
                    className="mh-next-button"
                    onClick={() => navigate(index === sections.length - 1 ? 0 : index + 1)}
                  >
                    {index === sections.length - 1 ? '回到开头' : '下一页'}
                    <ArrowDown size={16} />
                  </button>
                  <details className="mh-speaker-notes">
                    <summary>讲稿</summary>
                    <div>
                      <p>{section.notes}</p>
                      {section.transition && (
                        <p className="mh-notes-transition">{section.transition}</p>
                      )}
                    </div>
                  </details>
                </div>
              </div>
              <div className="mh-slide-visual">
                <SectionVisual section={section.key} />
              </div>
            </section>
          );
        })}
      </main>
      <footer className="mh-presentation-footer">
        <span>SCROLL / ← → 翻页</span>
        <span className="mh-footer-line" />
        <span>Mind Harness / 2026</span>
        <div className="mh-footer-arrows">
          <button
            onClick={() => navigate(activeIndex - 1)}
            disabled={activeIndex === 0}
            aria-label="上一页"
          >
            <ChevronLeft size={17} />
          </button>
          <button
            onClick={() => navigate(activeIndex + 1)}
            disabled={activeIndex === sections.length - 1}
            aria-label="下一页"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}
