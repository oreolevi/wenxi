import type { ProcessingStep, ProcessingTrace } from './types.ts';

export function mergeProcessingSteps(trace: ProcessingTrace, updates: ProcessingStep[], prefix = ''): ProcessingTrace {
  const steps = trace.steps.map(step => ({ ...step }));
  for (const update of updates) {
    const event = { ...update, id: prefix + update.id };
    const index = steps.findIndex(step => step.id === event.id);
    if (index < 0) steps.push(event);
    else steps[index] = event;
  }
  return { ...trace, steps };
}

export function finishProcessing(trace: ProcessingTrace, status: Exclude<ProcessingTrace['status'], 'running'>, finishedAt = new Date().toISOString()): ProcessingTrace {
  return { ...trace, status, finishedAt, steps: trace.steps.map(step => step.status !== 'running' ? step : {
    ...step, status: status === 'cancelled' ? 'cancelled' : status === 'failed' || status === 'partial' ? 'error' : 'done', finishedAt,
  }) };
}

export function durationLabel(startedAt: string, finishedAt: string | undefined, now = Date.now()) {
  const seconds = Math.max(0, Math.floor(((finishedAt ? Date.parse(finishedAt) : now) - Date.parse(startedAt)) / 1000));
  return seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒` : `${seconds} 秒`;
}
