import type { ActivityData } from './activity.ts';
export interface OperationRecord {
  id: string; kind: 'document' | 'service' | 'scene'; targetId: string; name: string; version: string;
  createdAt: string; status: string; totalElapsedMs?: number; phases?: Record<string, number>; error?: string; caller?: string | null;
  minutesSavedPerRun?: number | null;
}
export interface EfficiencySummary {
  savedMinutes: number; configuredCalls: number; unconfiguredCalls: number; excludedCalls: number;
  scenes: Array<{ id: string; name: string; successfulCalls: number; configuredCalls: number; unconfiguredCalls: number;
    savedMinutes: number; minutesMin: number | null; minutesMax: number | null }>;
}
export interface OperationsOverview {
  from: string; through: string; generatedAt: string; legacyCount: number; callerTracking: boolean;
  summary: { calls: number; documentCalls: number; apiCalls: number; completed: number; failed: number; needsReview: number; cancelled: number; running: number;
    completionRate: number | null; averageMs: number | null; p95Ms: number | null; timedCalls: number };
  phases: Array<{ id: string; name: string; count: number; averageMs: number | null }>;
  distribution: Array<{ id: string; name: string; count: number }>;
  ranking: Array<{ key: string; kind: 'service' | 'scene'; targetId: string; name: string; count: number; failed: number }>;
  activity: ActivityData; records: OperationRecord[]; recordsTotal: number;
  efficiency: EfficiencySummary;
}

export function efficiencySummary(records: OperationRecord[]): EfficiencySummary {
  const groups = new Map<string, EfficiencySummary['scenes'][number]>();
  let excludedCalls = 0;
  for (const row of records) {
    if (row.kind !== 'scene') continue;
    if (row.status !== 'succeeded') { excludedCalls++; continue; }
    const item = groups.get(row.targetId) || { id: row.targetId, name: row.name, successfulCalls: 0,
      configuredCalls: 0, unconfiguredCalls: 0, savedMinutes: 0, minutesMin: null, minutesMax: null };
    item.successfulCalls++;
    const minutes = row.minutesSavedPerRun;
    if (typeof minutes === 'number' && Number.isFinite(minutes) && minutes >= 0 && minutes <= 1440) {
      item.configuredCalls++; item.savedMinutes = Math.round((item.savedMinutes + minutes) * 100) / 100;
      item.minutesMin = item.minutesMin === null ? minutes : Math.min(item.minutesMin, minutes);
      item.minutesMax = item.minutesMax === null ? minutes : Math.max(item.minutesMax, minutes);
    } else item.unconfiguredCalls++;
    groups.set(row.targetId, item);
  }
  const scenes = [...groups.values()].sort((a, b) => b.savedMinutes - a.savedMinutes || a.id.localeCompare(b.id));
  return { scenes, excludedCalls, savedMinutes: Math.round(scenes.reduce((sum, item) => sum + item.savedMinutes, 0) * 100) / 100,
    configuredCalls: scenes.reduce((sum, item) => sum + item.configuredCalls, 0),
    unconfiguredCalls: scenes.reduce((sum, item) => sum + item.unconfiguredCalls, 0) };
}
export const savedHours = (minutes: number) => (minutes / 60).toLocaleString('zh-CN', { maximumFractionDigits: 1 });
export const operationStatus: Record<string, { label: string; color: string }> = {
  succeeded: { label: '已完成', color: 'success' }, needs_review: { label: '结果待核对', color: 'warning' },
  failed: { label: '失败', color: 'error' }, cancelled: { label: '已停止', color: 'default' }, running: { label: '处理中', color: 'processing' },
};
export const elapsed = (ms: number | null | undefined) => typeof ms !== 'number' ? '未记录' : ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
