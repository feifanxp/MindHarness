import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  ArrowDown,
  ArrowRight,
  ChevronLeft,
  ChevronRight,
  RotateCcw,
  Users,
  MessageCircle,
  ClipboardList,
  ArrowUpRight,
  CircleHelp,
  Check,
} from 'lucide-react';
import { slides, type SlideKey } from './presentationContent';
import {
  EditableText,
  PresentationEditor,
  PresentationEditButton,
  usePresentationText,
  usePresentationEditor,
} from './PresentationEditor';

type Color = 'lime' | 'coral' | 'blue' | 'violet';
type Message = { name: string; text: string; color?: Color; highlight?: string };

function Avatar({ name, color = 'blue' }: { name: string; color?: Color }) {
  return (
    <span className={`mh-avatar mh-avatar--${color}`} aria-hidden="true">
      {name === 'AI' ? 'AI' : name.slice(0, 1)}
    </span>
  );
}
function Card({
  title,
  badge,
  field,
  children,
  className = '',
}: {
  title: string;
  badge: string;
  field: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`mh-proof-card mh-v2-card ${className}`}>
      <div className="mh-proof-card__topline">
        <span>
          <EditableText id={field + '.caption'} text={title} label="示例标题" />
        </span>
        <span className="mh-sample-label">
          <EditableText id={field + '.badge.' + badge} text={badge} label="示例状态说明" />
        </span>
      </div>
      {children}
    </div>
  );
}
function MessageBubble({ message, field }: { message: Message; field: string }) {
  const { name, text, highlight, color } = message;
  const displayName = usePresentationText(field + '.name', name);
  return (
    <div className={`mh-chat-row ${name === '我' ? 'mh-chat-row--human' : ''}`}>
      <Avatar name={displayName} color={color ?? (name === '我' ? 'lime' : 'blue')} />
      <div className="mh-chat-content">
        <div className="mh-chat-meta">
          <EditableText id={field + '.name'} text={name} label="说话人" />
        </div>
        <div className="mh-chat-bubble">
          <EditableText
            id={field + '.text'}
            text={text}
            label={displayName + '的发言'}
            render={value =>
              (highlight ? value.split(highlight) : [value]).map((chunk, index) => (
                <span key={index}>
                  {index > 0 && <mark>{highlight}</mark>}
                  {chunk}
                </span>
              ))
            }
          />
        </div>
      </div>
    </div>
  );
}
function StepControls({
  step,
  labels,
  onChange,
}: {
  step: number;
  labels: string[];
  onChange: (n: number) => void;
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
      <button className="mh-reveal-next" disabled={last} onClick={() => onChange(step + 1)}>
        {last ? '本页已展开' : labels[step + 1]}
        <ArrowRight size={15} />
      </button>
    </div>
  );
}
function Choice({
  options,
  value,
  onChange,
  label,
}: {
  options: string[];
  value: number;
  onChange: (n: number) => void;
  label: string;
}) {
  return (
    <div className="mh-switch" role="group" aria-label={label}>
      {options.map((option, index) => (
        <button key={option} aria-pressed={value === index} onClick={() => onChange(index)}>
          {option}
        </button>
      ))}
    </div>
  );
}

const agreementRounds: Message[][] = [
  [
    { name: '我', text: '我觉得周末应该安排点学习，别把时间都浪费在休息上，你觉得呢？' },
    {
      name: 'AI',
      text: '很有道理！周末学点东西能保持状态，也能利用空闲时间提升自己，值得安排。',
      highlight: '值得安排',
    },
  ],
  [
    { name: '我', text: '但我又觉得，平时已经够累了，周末好好休息，才能恢复精力。' },
    {
      name: 'AI',
      text: '你说得很对！休息好了才能更好地工作和学习，周末没必要再给自己增加负担。',
      highlight: '没必要再给自己增加负担',
    },
  ],
];

function AgreementVisual() {
  const [step, setStep] = useState(0);
  return (
    <Card field={'resonance'} title="02 / FEEL FAMILIAR?" badge="模拟对话">
      <h3 className="mh-demo-heading">
        <EditableText id={'copy.resonance.0'} text={'周末，该学习还是休息？'} />
      </h3>
      <p className="mh-context">
        <EditableText id={'copy.resonance.1'} text={'同一个周末，没有新增安排，只是改变了倾向。'} />
      </p>
      <div
        className="mh-v2-body mh-message-list"
        tabIndex={0}
        role="region"
        aria-label="周末对话记录"
      >
        {agreementRounds.slice(0, step + 1).map((round, index) => (
          <div className="mh-conversation-round" key={index}>
            <span className="mh-round-label">
              <EditableText
                id={'resonance.round.' + index}
                text={index === 0 ? 'A / 安排学习' : 'B / 好好休息'}
              />
            </span>
            {round.map((message, i) => (
              <MessageBubble
                key={i}
                field={'resonance.message.' + index + '.' + i}
                message={message}
              />
            ))}
          </div>
        ))}
      </div>
      {step === 1 && (
        <p className="mh-takeaway">
          <EditableText
            id={'copy.resonance.2'}
            text={'我想听听你的判断，怎么变成了我说什么都对？'}
          />
        </p>
      )}
      <StepControls step={step} labels={['安排学习', '换个想法试试']} onChange={setStep} />
    </Card>
  );
}
function MotivationVisual() {
  return (
    <Card field={'motivation'} title="03 / WHY THIS FEATURE?" badge="模拟对话">
      <h3 className="mh-demo-heading">
        <EditableText id={'copy.motivation.0'} text={'一句需求，一串功能'} />
      </h3>
      <div className="mh-v2-body mh-motivation">
        <MessageBubble
          field="motivation.user"
          message={{ name: '我', text: '我们下一款血压计要用一个大的彩屏。' }}
        />
        <MessageBubble
          field="motivation.ai"
          message={{
            name: 'AI',
            text: '当然可以！大彩屏可以实现很多功能：\n\n1. 大字号显示：突出显示本次测量结果。\n2. 趋势图表：展示近期数据变化。\n3. 多用户档案：切换不同家庭成员的记录。\n4. 图文引导：分步骤提示测量操作。\n5. 测量提醒：设置时间，提示按时测量。\n6. 历史查询：按日期查看、对比过往记录。\n7. 显示设置：调节亮度、字号和界面主题。',
          }}
        />
      </div>
    </Card>
  );
}
const realWorldMessages: Message[][] = [
  [
    { name: '老板', text: '大屏方向定了，这周把方案给我。', color: 'coral' },
    { name: '我', text: '好，我先整理功能和排期，把需要确认的事项列出来。' },
  ],
  [
    { name: '我', text: '我在想，血压计做个大屏是不是更好？' },
    { name: '朋友甲', text: '你想解决的是数字看不清，还是想多放点信息？', color: 'coral' },
    {
      name: '朋友乙',
      text: '我家里人用的时候只找这次的结果，信息多了会不会反而难找？',
      color: 'violet',
    },
    { name: '我', text: '有道理，那我们先把“看结果”这个场景说清楚。' },
  ],
];
function RealWorldVisual() {
  const [scene, setScene] = useState(0);
  return (
    <Card field={'realworld'} title="04 / SAME PERSON, DIFFERENT ROOM" badge="模拟场景">
      <Choice
        options={['工作汇报', '朋友讨论']}
        value={scene}
        onChange={setScene}
        label="现实中的交流关系"
      />
      <h3 className="mh-demo-heading">
        <EditableText
          id={'realworld.heading.' + scene}
          text={scene === 0 ? '方向已定，怎么落实？' : '想法未定，一起商量'}
        />
      </h3>
      <div
        className="mh-v2-body mh-message-list"
        tabIndex={0}
        role="region"
        aria-label="现实场景对话"
      >
        {realWorldMessages[scene].map((message, index) => (
          <MessageBubble
            key={`${scene}-${index}`}
            field={'realworld.' + scene + '.message.' + index}
            message={message}
          />
        ))}
      </div>
      <p className="mh-takeaway">
        <EditableText
          id={'realworld.takeaway.' + scene}
          text={scene === 0 ? '先把明确的方向落实。' : '把方向本身，也拿出来聊一聊。'}
        />
      </p>
    </Card>
  );
}
function RelationshipVisual() {
  const [step, setStep] = useState(0);
  return (
    <Card field={'relationship'} title="05 / RETHINK THE RELATIONSHIP" badge="协作关系示意">
      <h3 className="mh-demo-heading">
        <EditableText id={'copy.relationship.0'} text={'“你帮我做”与“我们一起聊”'} />
      </h3>
      <div className="mh-v2-body mh-relation-comparison">
        <div className="mh-flow-block">
          <span className="mh-round-label">
            <EditableText id={'copy.relationship.1'} text={'指令式协作'} />
          </span>
          <div className="mh-flow-line">
            <b>
              <EditableText id={'copy.relationship.2'} text={'用户给方向'} />
            </b>
            <ArrowRight size={18} />
            <b>
              <EditableText id={'copy.relationship.3'} text={'Agent 执行'} />
            </b>
            <ArrowRight size={18} />
            <b>
              <EditableText id={'copy.relationship.4'} text={'交付结果'} />
            </b>
          </div>
          <p>
            <EditableText id={'copy.relationship.5'} text={'目标明确时，让任务继续推进。'} />
          </p>
        </div>
        {step === 1 && (
          <div className="mh-flow-block mh-flow-block--accent">
            <span className="mh-round-label">
              <EditableText id={'copy.relationship.6'} text={'我们想增加的讨论方式'} />
            </span>
            <div className="mh-dialogue-flow">
              <b>
                <EditableText id={'copy.relationship.7'} text={'我提出想法'} />
              </b>
              <span>
                <EditableText id={'copy.relationship.8'} text={'↔'} />
              </span>
              <b>
                <EditableText id={'copy.relationship.9'} text={'AI 队友表达判断'} />
              </b>
            </div>
            <p>
              <EditableText id={'copy.relationship.10'} text={'彼此追问、补充，共同梳理方案。'} />
            </p>
          </div>
        )}
      </div>
      {step === 1 && (
        <p className="mh-takeaway">
          <EditableText
            id={'copy.relationship.11'}
            text={'一个会执行的助手之外，我还想要能一起商量的队友。'}
          />
        </p>
      )}
      <StepControls step={step} labels={['你帮我做', '如果换成队友？']} onChange={setStep} />
    </Card>
  );
}
const teammates: { name: string; color: Color; trait: string; question: string }[] = [
  {
    name: '用户研究员',
    color: 'coral',
    trait: '喜欢追问细节',
    question: '谁在用，具体哪里不方便？',
  },
  {
    name: '设计师',
    color: 'violet',
    trait: '善于联想，愿意把想法画出来',
    question: '这个操作过程能不能更顺？',
  },
  {
    name: '研发工程师',
    color: 'blue',
    trait: '谨慎，关注可行性',
    question: '怎么实现，有什么成本和限制？',
  },
];
function RoomVisual() {
  const { fields } = usePresentationEditor();
  const [person, setPerson] = useState(0);
  return (
    <Card field={'room'} title="MIND HARNESS / PROJECT ROOM" badge="界面示意">
      <div className="mh-room-title">
        <div>
          <span className="mh-eyebrow">
            <EditableText id={'copy.room.0'} text={'产品探索 / 平行讨论'} />
          </span>
          <h3>
            <EditableText id={'copy.room.1'} text={'下一款家用血压计，该优先改什么？'} />
          </h3>
        </div>
      </div>
      <div className="mh-team-select" role="group" aria-label="认识 AI 队友">
        {teammates.map((member, index) => (
          <button
            key={member.name}
            aria-pressed={person === index}
            onClick={() => setPerson(index)}
          >
            <Avatar
              name={fields['room.member.' + index + '.name'] ?? member.name}
              color={member.color}
            />
            <strong>{fields['room.member.' + index + '.name'] ?? member.name}</strong>
          </button>
        ))}
      </div>
      <div className="mh-v2-body mh-teammate-detail">
        <span className="mh-round-label">
          <EditableText
            id={'room.member.' + person + '.trait'}
            text={teammates[person].trait}
            label="队友特点"
          />
        </span>
        <MessageBubble
          field={'room.member.' + person}
          message={{ ...teammates[person], text: teammates[person].question }}
        />
        <div className="mh-human-role">
          <Users size={18} />
          <p>
            <strong>
              <EditableText id={'copy.room.2'} text={'你始终在讨论中'} />
            </strong>
            <span>
              <EditableText id={'copy.room.3'} text={'提供背景，参与讨论，决定下一步。'} />
            </span>
          </p>
        </div>
      </div>
      <div className="mh-room-input">
        <MessageCircle size={16} />
        <span>
          <EditableText id={'copy.room.4'} text={'你说出想法，队友接着往下聊'} />
        </span>
      </div>
    </Card>
  );
}
const discussionRounds: Message[][] = [
  [{ name: '我', text: '我想让爸妈量完以后，更容易看清血压计的结果，现在只想到屏幕大一点。' }],
  [
    { name: '用户研究员', text: '他们一般怎么用？机器放在哪儿，人从哪个角度看？', color: 'coral' },
    { name: '我', text: '放在餐桌上，坐着看。有时候还会把历史记录当成本次结果。' },
  ],
  [
    {
      name: '设计师',
      text: '那可以先看量完后的画面，让本次结果更突出，历史信息另放。',
      color: 'violet',
    },
    {
      name: '研发',
      text: '我们可以先用现有屏幕试信息布局，也做一个大屏版本，对比之后再选。',
      color: 'blue',
    },
  ],
  [],
];
const discussionBrief = [
  ['想解决的问题', '用户量完后，能否方便地找到并读清本次结果？'],
  ['候选方案', '调整信息布局、改善观看角度，或采用更大屏幕。'],
  ['还需确认', '真实使用中最主要的障碍是什么，各方案是否有效。'],
  ['下一步', '制作对比原型，结合真实用户反馈再做取舍。'],
];
function DiscussionVisual() {
  const [step, setStep] = useState(0);
  const logRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = step === 0 || step === 3 ? 0 : log.scrollHeight;
  }, [step]);
  return (
    <Card
      field={'discussion'}
      title="07 / THINK TOGETHER"
      badge={step === 3 ? '方案草案 · 尚待验证' : '模拟对话'}
    >
      <h3 className="mh-demo-heading">
        <EditableText
          id={'discussion.heading.' + (step === 3 ? 'brief' : 'chat')}
          text={step === 3 ? '聊完，留下什么？' : '一个想法，接着一个想法'}
        />
      </h3>
      <div
        className="mh-v2-body mh-message-list"
        tabIndex={0}
        ref={logRef}
        role="region"
        aria-label="讨论与方案草案"
      >
        {step < 3 ? (
          discussionRounds
            .slice(0, step + 1)
            .flat()
            .map((message, index) => (
              <MessageBubble key={index} field={'discussion.message.' + index} message={message} />
            ))
        ) : (
          <dl className="mh-brief-list">
            {discussionBrief.map(([label, text], index) => (
              <div key={label}>
                <dt>
                  <EditableText id={'discussion.brief.' + index + '.label'} text={label} />
                </dt>
                <dd>
                  <EditableText
                    id={'discussion.brief.' + index + '.text'}
                    text={text}
                    label={label}
                  />
                </dd>
              </div>
            ))}
          </dl>
        )}
      </div>
      <StepControls
        step={step}
        labels={['先说一个想法', '队友追问', '接着补充', '看看方案草案']}
        onChange={setStep}
      />
    </Card>
  );
}
const executionSteps = [
  ['用户确认执行计划', '目标、任务、负责人、交付物、验收标准'],
  ['切换主从执行', '项目经理 Agent 拆解并分发任务'],
  ['各 Bot 执行与提交', '分别完成自己的任务，提交成果'],
  ['整体审核与质量评价', '检查整体结果，需要修改的回到对应任务'],
  ['最终交付', '审核完成后，输出整体成果'],
];
function ExecutionVisual() {
  const [mode, setMode] = useState(0);
  const [step, setStep] = useState(0);
  return (
    <Card
      field={'execution'}
      title="08 / FROM DISCUSSION TO ACTION"
      badge="流程设计 · 实现范围待核对"
    >
      <Choice
        options={['平行讨论', '主从执行']}
        value={mode}
        onChange={setMode}
        label="讨论与执行模式"
      />
      <div className="mh-v2-body">
        {mode === 0 ? (
          <div className="mh-explore-stage">
            <Users size={36} />
            <h3>
              <EditableText id={'copy.execution.0'} text={'先把目标和边界聊清楚'} />
            </h3>
            <p>
              <EditableText id={'copy.execution.1'} text={'提出想法 ↔ 自由讨论 ↔ 共同梳理'} />
            </p>
            <p className="mh-context">
              <EditableText id={'copy.execution.2'} text={'用户确认后，再形成执行计划。'} />
            </p>
          </div>
        ) : (
          <ol className="mh-execution-list">
            {executionSteps.slice(0, step + 1).map(([title, body], index) => (
              <li key={title}>
                <span>{String(index + 1).padStart(2, '0')}</span>
                <div>
                  <strong>
                    <EditableText id={'execution.step.' + index + '.title'} text={title} />
                  </strong>
                  <p>
                    <EditableText
                      id={'execution.step.' + index + '.body'}
                      text={body}
                      label={title}
                    />
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="mh-external-path">
        <ArrowUpRight size={18} />
        <p>
          <strong>
            <EditableText id={'copy.execution.3'} text={'也可以带到其他地方继续'} />
          </strong>
          <span>
            <EditableText
              id={'copy.execution.4'}
              text={'整理讨论结论与计划，交给其他工具或真实团队。'}
            />
          </span>
        </p>
      </div>
      {mode === 1 && (
        <StepControls
          step={step}
          labels={executionSteps.map(([title]) => title)}
          onChange={setStep}
        />
      )}
    </Card>
  );
}
const caseData = {
  'case-bp': {
    title: '09 / BLOOD PRESSURE MONITOR',
    prompt:
      '我们在考虑下一款家用血压计怎么改善结果查看体验，目前有“大屏”的想法，还没有定方案。请基于同一份背景材料，和我讨论需求及下一步怎么验证。',
    observations: [
      '有没有问到关键使用场景？',
      '有没有重新审视大屏方向？',
      '需求和候选方案是否因此改变？',
    ],
  },
  'case-retention': {
    title: '10 / CUSTOMER RETENTION',
    prompt:
      '最近老客户复购减少，我在考虑优惠活动，但还没确定流失原因。请基于同一份背景材料，和我讨论可能原因以及下一步怎么做。',
    observations: [
      '有没有检验价格之外的假设？',
      '不同观点是否影响了后续判断？',
      '下一步行动有没有材料依据？',
    ],
  },
};
function CaseVisual({ kind }: { kind: keyof typeof caseData }) {
  const [view, setView] = useState(0);
  const data = caseData[kind];
  const views = ['过程', '关键节点', '最终产物'];
  const empty = ['待补真实讨论记录', '待标出影响判断的原文', '待补最终方案与决定依据'];
  return (
    <Card field={kind} title={data.title} badge="案例待验证">
      <details className="mh-case-prompt">
        <summary>共同起点 · 查看任务</summary>
        <p>
          <EditableText id={kind + '.prompt'} text={data.prompt} label="案例任务" />
        </p>
      </details>
      <Choice options={views} value={view} onChange={setView} label="案例查看方式" />
      <div className="mh-v2-body">
        <div className="mh-case-columns">
          {['一对一对话', 'Mind Harness 平行讨论'].map((name, side) => (
            <div className="mh-case-empty" key={name}>
              <h3>
                <EditableText id={kind + '.column.' + side + '.title'} text={name} />
              </h3>
              <ClipboardList size={26} />
              <strong>
                <EditableText
                  id={kind + '.evidence.' + side + '.' + view}
                  text={empty[view]}
                  label={name + ' / ' + views[view]}
                />
              </strong>
              <span>
                <EditableText
                  id={kind + '.column.' + side + '.conclusion'}
                  text="当前没有效果结论"
                  label={name + '的结论'}
                />
              </span>
            </div>
          ))}
        </div>
        <div className="mh-case-observe">
          <span className="mh-round-label">
            <EditableText id={'copy.case.1' + '.' + kind} text={'看什么，才算有帮助？'} />
          </span>
          {data.observations.map((item, index) => (
            <p key={item}>
              <CircleHelp size={14} />
              <EditableText id={kind + '.observation.' + index} text={item} />
            </p>
          ))}
        </div>
      </div>
      <p className="mh-context mh-case-note">
        <EditableText
          id={'copy.case.2' + '.' + kind}
          text={'同一问题、同一背景材料。用真实记录比较，不预设哪种方式更好。'}
        />
      </p>
    </Card>
  );
}
function ValueVisual() {
  return (
    <Card field={'value'} title="11 / FOR PRODUCT MANAGERS" badge="目标产物示意">
      <div className="mh-v2-body mh-value-draft">
        <span className="mh-round-label">
          <EditableText id={'copy.value.0'} text={'开始时'} />
        </span>
        <blockquote>
          <EditableText id={'copy.value.1'} text={'“想做个大屏。”'} />
          <br />
          <EditableText id={'copy.value.2'} text={'“一条用户反馈。”'} />
          <br />
          <EditableText id={'copy.value.3'} text={'“一个还没验证的判断。”'} />
        </blockquote>
        <div className="mh-draft-divider">
          <ArrowDown size={18} />
          <span>
            <EditableText id={'copy.value.4'} text={'带去下一次团队讨论'} />
          </span>
        </div>
        <ul>
          {[
            '我们想解决谁的什么问题',
            '候选方案有哪些，各自怎样取舍',
            '哪些已经知道，哪些还需要验证',
            '接下来先验证什么，再决定做什么',
          ].map((item, index) => (
            <li key={item}>
              <Check size={16} />
              <span>
                <EditableText id={'value.result.' + index} text={item} />
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="mh-takeaway">
        <EditableText id={'copy.value.5'} text={'带着更清楚的问题，去和真实团队协作。'} />
      </p>
    </Card>
  );
}
function HarnessVisual() {
  const [step, setStep] = useState(0);
  return (
    <Card field={'harness'} title="12 / MIND HARNESS" badge="项目愿景">
      <div className="mh-v2-body mh-harness-visual">
        <div className="mh-thoughts">
          <span>
            <EditableText id={'copy.harness.0'} text={'一个念头'} />
          </span>
          <span>
            <EditableText id={'copy.harness.1'} text={'一段经历'} />
          </span>
          <span>
            <EditableText id={'copy.harness.2'} text={'一个还没验证的判断'} />
          </span>
        </div>
        <div className="mh-harness-center">
          <span className="mh-harness-name">
            <EditableText id={'copy.harness.3'} text={'MIND'} />
            <br />
            <strong>
              <EditableText id={'copy.harness.4'} text={'HARNESS'} />
            </strong>
          </span>
          <p>
            <EditableText id={'copy.harness.5'} text={'用户始终参与，作出判断，决定下一步。'} />
          </p>
        </div>
        {step === 1 && (
          <>
            <div className="mh-harness-team">
              <span>
                <EditableText id={'copy.harness.6'} text={'研究 · 追问'} />
              </span>
              <span>
                <EditableText id={'copy.harness.7'} text={'设计 · 补充'} />
              </span>
              <span>
                <EditableText id={'copy.harness.8'} text={'研发 · 另一个角度'} />
              </span>
            </div>
            <p className="mh-harness-outcome">
              <EditableText id={'copy.harness.9'} text={'让零散的想法，逐渐整理成形。'} />
            </p>
          </>
        )}
      </div>
      <StepControls step={step} labels={['零散的想法', '让队友接住这些想法']} onChange={setStep} />
    </Card>
  );
}
function SlideVisual({ kind }: { kind: SlideKey }) {
  switch (kind) {
    case 'cover':
      return null;
    case 'resonance':
      return <AgreementVisual />;
    case 'motivation':
      return <MotivationVisual />;
    case 'realworld':
      return <RealWorldVisual />;
    case 'relationship':
      return <RelationshipVisual />;
    case 'room':
      return <RoomVisual />;
    case 'discussion':
      return <DiscussionVisual />;
    case 'execution':
      return <ExecutionVisual />;
    case 'case-bp':
    case 'case-retention':
      return <CaseVisual kind={kind} />;
    case 'value':
      return <ValueVisual />;
    case 'harness':
      return <HarnessVisual />;
  }
}

function PresentationContent() {
  const [activeIndex, setActiveIndex] = useState(0);
  const mainRef = useRef<HTMLElement>(null);
  const navigate = useCallback((index: number) => {
    const bounded = Math.max(0, Math.min(slides.length - 1, index));
    const section = document.getElementById(`mh-slide-${slides[bounded].key}`);
    setActiveIndex(bounded);
    section?.scrollIntoView({
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
      block: 'start',
    });
    document.getElementById(`mh-title-${slides[bounded].key}`)?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const title = document.title;
    const lang = document.documentElement.lang;
    document.title = 'Mind Harness — Presentation V2.0';
    document.documentElement.lang = 'zh-CN';
    let observer: IntersectionObserver;
    const observe = () => {
      observer?.disconnect();
      observer = new IntersectionObserver(
        entries => {
          for (const entry of entries)
            if (entry.isIntersecting) {
              const index = slides.findIndex(s => entry.target.id === `mh-slide-${s.key}`);
              if (index >= 0) setActiveIndex(index);
            }
        },
        { rootMargin: `-${innerHeight * 0.4}px 0px -${innerHeight * 0.55}px 0px`, threshold: 0 }
      );
      mainRef.current?.querySelectorAll('.mh-slide').forEach(section => observer.observe(section));
    };
    observe();
    window.addEventListener('resize', observe);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', observe);
      document.title = title;
      document.documentElement.lang = lang;
    };
  }, []);
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (
        event.target instanceof HTMLElement &&
        event.target.closest(
          'button,a,input,textarea,select,summary,details,[data-edit-field],[contenteditable="true"],[role="region"][tabindex]'
        )
      )
        return;
      const offset = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (offset && activeIndex + offset >= 0 && activeIndex + offset < slides.length) {
        event.preventDefault();
        navigate(activeIndex + offset);
      }
    };
    window.addEventListener('keydown', keydown);
    return () => window.removeEventListener('keydown', keydown);
  }, [activeIndex, navigate]);
  return (
    <div className="mh-presentation" lang="zh-CN">
      <header className="mh-presentation-header">
        <a
          className="mh-brand"
          href="#mh-slide-cover"
          onClick={e => {
            e.preventDefault();
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
          <span>{slides[activeIndex].chapter}</span>
          <span className="mh-header-slash">/</span>
          <strong>V2.0</strong>
        </div>
        <PresentationEditButton />
        <div
          className="mh-header-progress"
          aria-label={`第 ${activeIndex + 1} 页，共 ${slides.length} 页`}
        >
          <span>{String(activeIndex + 1).padStart(2, '0')}</span>
          <i aria-hidden="true">
            <b style={{ inlineSize: `${((activeIndex + 1) / slides.length) * 100}%` }} />
          </i>
          <span>{slides.length}</span>
        </div>
      </header>
      <nav className="mh-section-nav" aria-label="演示章节">
        {slides.map((slide, index) => (
          <a
            key={slide.key}
            href={`#mh-slide-${slide.key}`}
            aria-current={activeIndex === index ? 'step' : undefined}
            className={activeIndex === index ? 'is-active' : ''}
            aria-label={`${index + 1}. ${slide.label}`}
            title={`${slide.chapter} / ${slide.label}`}
            onClick={e => {
              e.preventDefault();
              navigate(index);
            }}
          >
            <span>{String(index + 1).padStart(2, '0')}</span>
            <i />
          </a>
        ))}
      </nav>
      <main ref={mainRef}>
        {slides.map((slide, index) => {
          const Heading = index === 0 ? 'h1' : 'h2';
          return (
            <section
              key={slide.key}
              className={`mh-slide mh-slide--${slide.key}`}
              id={`mh-slide-${slide.key}`}
              aria-labelledby={`mh-title-${slide.key}`}
            >
              <div className="mh-slide-copy">
                {slide.key !== 'cover' && (
                  <div className="mh-slide-kicker">
                    <span className="mh-kicker-line" />
                    {String(index + 1).padStart(2, '0')} / {slide.chapter}
                  </div>
                )}
                <Heading className="mh-slide-title" id={`mh-title-${slide.key}`} tabIndex={-1}>
                  <EditableText
                    id={'slide.' + slide.key + '.title'}
                    text={slide.title}
                    label={'第 ' + (index + 1) + ' 页标题'}
                    render={title =>
                      title
                        .split(/(?<=[，；。？：])/u)
                        .filter(Boolean)
                        .map((phrase, i) => (
                          <span className="mh-title-phrase" key={i}>
                            {phrase.split(/(“[^”]+”)/u).map((part, j) => (
                              <span
                                key={j}
                                className={part.startsWith('“') ? 'mh-title-quoted' : undefined}
                              >
                                {part}
                              </span>
                            ))}
                          </span>
                        ))
                    }
                  />
                </Heading>
                <p className="mh-slide-summary">
                  <EditableText
                    id={'slide.' + slide.key + '.summary'}
                    text={slide.summary}
                    label={'第 ' + (index + 1) + ' 页正文'}
                  />
                </p>
                {slide.key === 'harness' && (
                  <p className="mh-closing-line">
                    <EditableText
                      id="slide.harness.closing"
                      text="带着一个还没想清楚的念头进来，带着更清晰的思路出去。"
                      label="结尾句"
                    />
                  </p>
                )}
                <div className="mh-copy-actions">
                  <button
                    className="mh-next-button"
                    onClick={() => navigate(index === slides.length - 1 ? 0 : index + 1)}
                  >
                    {slide.key === 'cover'
                      ? '开始演示'
                      : index === slides.length - 1
                        ? '回到开头'
                        : '下一页'}
                    <ArrowDown size={16} />
                  </button>
                </div>
              </div>
              {slide.key !== 'cover' && (
                <div className="mh-slide-visual">
                  <SlideVisual kind={slide.key} />
                </div>
              )}
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
            disabled={activeIndex === slides.length - 1}
            aria-label="下一页"
          >
            <ChevronRight size={17} />
          </button>
        </div>
      </footer>
    </div>
  );
}

export function PresentationPage() {
  return (
    <PresentationEditor>
      <PresentationContent />
    </PresentationEditor>
  );
}
