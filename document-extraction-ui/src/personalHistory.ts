import { savedHistory, sessionHistory, type HistoryEntry } from './prototypeModel.ts';
import type { Material, SavedTaskSummary } from './types.ts';

export interface PersonalHistoryEntry extends HistoryEntry {
  fullText: boolean;
  current: boolean;
  timestamp?: string;
}
export function personalHistory(records: SavedTaskSummary[], files: Material[], busy: boolean, progress: string, started: boolean): PersonalHistoryEntry[] {
  const saved = savedHistory(records).map(row => {
    const record = records.find(record => record.id === row.recordId)!;
    const file = record.files.find(file => file.id === row.materialId)!;
    return { ...row, fullText: !!file.parsed?.fullText || !!file.fullText, current: false, timestamp: record.createdAt };
  });
  const current = sessionHistory(files, busy, progress).filter(row => {
    const file = files.find(file => file.id === row.materialId)!;
    return file.processed || !!file.error || (busy && started);
  }).map(row => {
    const previous = saved.find(item => item.materialId === row.materialId);
    const file = files.find(file => file.id === row.materialId)!;
    return { ...row, id: previous?.id || row.id, current: true, fullText: !!file.parsed?.fullText || !!file.fullText,
      timestamp: previous?.timestamp, time: previous?.time || '当前任务' };
  });
  const ids = new Set(current.map(row => row.materialId));
  return [...current, ...saved.filter(row => !ids.has(row.materialId))];
}
export const needsReview = (row: HistoryEntry) => row.status === '已完成' && row.total > row.confirmed;
