import { dateKey } from './activity.ts';

/** Only status metadata is needed; document text and field values stay out of the dashboard. */
export interface QualityTask {
  id: string; createdAt: string; updatedAt: string;
  files: Array<{ id: string; kind: string; processed?: boolean; results?: Array<{ status?: string; validationStatus?: string; kind?: string }> }>;
}
export interface OperationsQuality {
  materials: number; total: number; reviewed: number;
  passed: number; partial: number; visual: number; missing: number; unknown: number;
}

export function savedResultQuality(tasks: QualityTask[], from: string, through: string): OperationsQuality {
  const result: OperationsQuality = { materials: 0, total: 0, reviewed: 0, passed: 0, partial: 0, visual: 0, missing: 0, unknown: 0 };
  // A repeated snapshot must not count the same task/material twice.
  const latest = new Map<string, QualityTask>();
  for (const task of tasks) {
    const previous = latest.get(task.id);
    if (!previous || previous.updatedAt < task.updatedAt) latest.set(task.id, task);
  }
  for (const task of latest.values()) {
    const created = new Date(task.createdAt);
    if (Number.isNaN(created.getTime())) continue;
    const day = dateKey(created);
    if (day < from || day > through) continue;
    const seen = new Set<string>();
    for (const file of task.files) {
      if (seen.has(file.id) || ['demo', 'spreadsheet'].includes(file.kind) || !file.processed || !file.results?.length) continue;
      seen.add(file.id); result.materials++;
      for (const field of file.results) {
        result.total++;
        if (field.status === 'confirmed' || field.status === 'corrected') result.reviewed++;
        // These buckets describe original machine evidence, separately from human review.
        if (field.kind === 'visual' || field.validationStatus === 'visual_required' || field.status === 'visual_required') result.visual++;
        else if (field.validationStatus === 'missing' || field.status === 'missing') result.missing++;
        else if (['partial', 'rejected'].includes(field.validationStatus || '') || field.status === 'rejected') result.partial++;
        else if (field.validationStatus === 'passed') result.passed++;
        else result.unknown++;
      }
    }
  }
  return result;
}
