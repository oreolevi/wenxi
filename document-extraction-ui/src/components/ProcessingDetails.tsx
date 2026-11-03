import { useEffect, useState } from 'react';
import { CheckOutlined, CloseOutlined, DownOutlined, LoadingOutlined, PauseOutlined } from '@ant-design/icons';
import type { ProcessingTrace } from '../types.ts';
import { durationLabel } from '../processing.ts';

export function ProcessingDetails({ trace }: { trace: ProcessingTrace }) {
  const [expanded, setExpanded] = useState(trace.status === 'running');
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (trace.status !== 'running') { setExpanded(false); return; }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [trace.status]);
  const current = [...trace.steps].reverse().find(step => step.status === 'running');
  const title = trace.status === 'running' ? current?.label || '正在准备处理'
    : ({ done: '处理完成', partial: '部分材料未完成', failed: '处理未完成', cancelled: '已停止处理' })[trace.status];
  return <div className={`processing-details is-${trace.status}`}>
    <button className="processing-toggle" type="button" aria-expanded={expanded} aria-controls={`process-${trace.id}`} onClick={() => setExpanded(value => !value)}>
      {trace.status === 'running' ? <LoadingOutlined spin /> : trace.status === 'done' ? <CheckOutlined /> : trace.status === 'cancelled' ? <PauseOutlined /> : <CloseOutlined />}
      <span>{title}</span><small>{durationLabel(trace.startedAt, trace.finishedAt, now)}</small><DownOutlined className={expanded ? 'is-expanded' : ''} />
    </button>
    <ol id={`process-${trace.id}`} className="processing-steps" hidden={!expanded} aria-label="处理过程">
      {trace.steps.map(step => <li key={step.id} className={`step-${step.status}`}>
        <span className="processing-step-icon" aria-label={{ running: '处理中', done: '已完成', error: '未完成', cancelled: '已停止' }[step.status]}>{step.status === 'running' ? <LoadingOutlined spin /> : step.status === 'done' ? <CheckOutlined /> : step.status === 'error' ? <CloseOutlined /> : <PauseOutlined />}</span>
        <div><span>{step.status === 'done' ? step.label.replace(/正在/g, '') : step.label}</span>{step.detail && <small title={step.detail}>{step.detail}</small>}</div>
      </li>)}
    </ol>
  </div>;
}
