import React, { useId } from 'react';
import type { Teammate } from './api';

type Props = {
  agents: Teammate[];
  disabled: boolean;
  frozen: boolean;
  onSelect: (names: string[]) => void;
};

export function TeammatePicker({ agents, disabled, frozen, onSelect }: Props) {
  const id = useId();
  const selected = agents.filter((agent) => agent.selected);
  return (
    <fieldset className="wizard-teammates" disabled={disabled || frozen}>
      <legend>{frozen ? '你的 AI 队友' : '挑选 AI 队友'}</legend>
      <p className="wizard-teammates-hint">
        {frozen
          ? '带着刚才聊清楚的目标，一起开始讨论。'
          : '不同专长，不同个性。选出你想一起讨论的伙伴，也可以继续聊天调整。'}
      </p>
      <div className="wizard-teammate-grid">
        {agents.map((agent, index) => (
          <label
            htmlFor={`${id}-${index}`}
            className={`wizard-teammate-card ${agent.selected ? 'wizard-teammate-selected' : ''}`}
            key={agent.name}
          >
            <input
              id={`${id}-${index}`}
              type="checkbox"
              aria-label={`选择 ${agent.name}`}
              checked={agent.selected}
              onChange={() =>
                onSelect(
                  agents
                    .filter((candidate) =>
                      candidate.name === agent.name ? !candidate.selected : candidate.selected
                    )
                    .map((candidate) => candidate.name)
                )
              }
            />
            {agent.avatar_id !== null ? (
              <img
                className="wizard-teammate-avatar"
                src={`/api/project-wizard/avatars/${agent.avatar_id}`}
                alt=""
                width={64}
                height={64}
              />
            ) : (
              <span className="wizard-teammate-avatar wizard-teammate-initial" aria-hidden="true">
                {agent.name.slice(0, 1)}
              </span>
            )}
            <span className="wizard-teammate-name">{agent.name}</span>
            <span className="wizard-teammate-type">AI 队友</span>
            <span className="wizard-teammate-field">职业专长</span>
            <span className="wizard-teammate-detail">{agent.responsibility}</span>
            <span className="wizard-teammate-field">性格与交流方式</span>
            <span className="wizard-teammate-detail">{agent.behavior}</span>
            {agent.recommendation && (
              <span className="wizard-teammate-reason">
                <strong>为什么适合你</strong>
                {agent.recommendation}
              </span>
            )}
          </label>
        ))}
      </div>
      <p className="wizard-team-count" role="status">
        已选择 {selected.length} / {agents.length} 位队友
      </p>
    </fieldset>
  );
}
