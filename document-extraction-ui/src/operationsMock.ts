import { addDays, dateKey } from './activity.ts';
import { efficiencySummary, type OperationRecord, type OperationsOverview } from './operations.ts';
import { savedResultQuality, type OperationsQuality, type QualityTask } from './operationsQuality.ts';

const phases = [
  { id: 'queue', name: '排队' }, { id: 'prepare', name: '预处理与识别' },
  { id: 'recognize', name: 'OCR 与版面识别' }, { id: 'preview', name: '原文预览' },
  { id: 'semantic', name: '语义提取' }, { id: 'validate', name: '引用校验' },
  { id: 'rule', name: '规则执行' },
];
const kinds = [
  { id: 'document', name: '通用文档解析' },
  { id: 'service', name: '服务接口' },
  { id: 'scene', name: '场景接口' },
] as const;
const targets = [
  { kind: 'document', name: '合同条款提取', version: '', caller: '文析办公端', scan: true },
  { kind: 'document', name: '企业材料信息整理', version: '', caller: '文析办公端', scan: true },
  { kind: 'service', name: '电子发票要素提取', version: '1.3.0', caller: '费用报销平台', scan: false },
  { kind: 'service', name: '扫描发票基础信息提取', version: '1.1.0', caller: '对公转账系统', scan: true },
  { kind: 'service', name: '报关单要素提取', version: '2.0.1', caller: '贸易融资系统', scan: true },
  { kind: 'scene', name: '企业对外付款', version: '1.2.0', caller: '对公转账系统', scan: true },
  { kind: 'scene', name: '费用报销票据整理', version: '1.0.2', caller: '费用报销平台', scan: false },
] as const;
const failures = [
  '材料版式未匹配：上传材料不符合已发布版式，请检查调用的服务版本。',
  'OCR 识别超时：扫描页清晰度不足，识别未在指定时间内完成。',
  '文件读取失败：PDF 内容不完整，请重新上传完整文件。',
  '识别队列等待超时：并发任务较多，请稍后重试。',
];

function seedOf(text: string) {
  let seed = 2166136261;
  for (const char of text) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return seed >>> 0;
}
function randomFor(key: string) {
  let seed = seedOf(key);
  return () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
}

/** In-memory fixtures only. No calls are executed or written to operational history. */
export function mockOperationsOverview(days = 30, kind = 'all', through = dateKey(), filters: { status?: string; target?: string } = {}): OperationsOverview & { quality: OperationsQuality } {
  const from = addDays(through, 1 - days);
  const records: OperationRecord[] = [];
  const daily: OperationsOverview['activity']['days'] = [];
  for (let offset = 0; offset < days; offset++) {
    const day = addDays(from, offset);
    const random = randomFor(day);
    const weekday = new Date(`${day}T00:00:00Z`).getUTCDay();
    const quiet = weekday === 0 || weekday === 6;
    // Stable business seasonality, quiet weekends and occasional inactive days.
    const pause = random();
    const month = Number(day.slice(5, 7));
    const seasonal = [.55, .45, .75, .65, .8, 1, .7, .85, 1.1, 1.25, 1.05, 1.15][month - 1];
    const volume = quiet ? (pause < .78 ? 0 : 1 + Math.floor(random() * 12))
      : pause < .06 ? 0 : Math.round((24 + random() * 60) * seasonal);
    let count = 0;
    for (let index = 0; index < volume; index++) {
      const targetIndex = Math.floor(random() * targets.length);
      const target = targets[targetIndex];
      const roll = random();
      let status = roll < .035 ? 'failed' : roll < .055 ? 'cancelled' : roll < .16 ? 'needs_review' : 'succeeded';
      // Include active and exceptional calls at the top of the current day's list.
      if (day === through && index === volume - 1) status = 'running';
      if (day === through && index === volume - 2) status = 'failed';
      if (day === through && index === volume - 3) status = 'needs_review';
      const timings: Record<string, number> = { queue: 20 + Math.floor(random() * 600) };
      timings.prepare = target.scan ? 3000 + Math.floor(random() * 6500) : 120 + Math.floor(random() * 350);
      if (target.kind === 'document') {
        timings.recognize = 2000 + Math.floor(random() * 9000);
        timings.preview = 80 + Math.floor(random() * 250);
        timings.semantic = 4000 + Math.floor(random() * 22000);
        timings.validate = 50 + Math.floor(random() * 180);
      } else {
        timings.rule = 30 + Math.floor(random() * (target.kind === 'scene' ? 650 : 160));
        timings.validate = 20 + Math.floor(random() * 80);
      }
      const failureIndex = Math.floor(random() * failures.length);
      if (status === 'failed' || status === 'cancelled' || status === 'running') {
        delete timings.semantic; delete timings.validate; delete timings.preview; delete timings.rule;
      }
      const totalElapsedMs = status === 'running' ? undefined : Object.values(timings).reduce((sum, ms) => sum + ms, 80);
      // Spread calls across office hours, with distinct, monotonically increasing times.
      const seconds = 9 * 3600 + Math.floor(index / Math.max(1, volume - 1) * 8 * 3600) + 5;
      const clock = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map(value => String(value).padStart(2, '0')).join(':');
      const record: OperationRecord = {
        id: `mock:${day}:${index}`, kind: target.kind, targetId: `mock-target-${targetIndex}`,
        name: target.name, version: target.version, caller: target.caller,
        createdAt: `${day}T${clock}+08:00`, status, totalElapsedMs, phases: timings,
        ...(target.kind === 'scene' ? { minutesSavedPerRun: targetIndex === 5 ? 12 : 5 } : {}),
        ...(status === 'failed' ? { error: target.kind === 'document' && failureIndex === 0
          ? '语义提取服务暂时不可用：模型请求超时，请稍后重试。'
          : failures[failureIndex] } : {}),
      };
      if (kind === 'all' || target.kind === kind || kind === 'api' && target.kind !== 'document') { records.push(record); count++; }
    }
    daily.push({ date: day, count });
  }
  records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const states = (state: string) => records.filter(row => row.status === state).length;
  const completed = states('succeeded') + states('needs_review');
  const ended = completed + states('failed');
  const times = records.flatMap(row => typeof row.totalElapsedMs === 'number' ? [row.totalElapsedMs] : []).sort((a, b) => a - b);
  const average = (values: number[]) => values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : null;
  const ranked = new Map<string, OperationsOverview['ranking'][number]>();
  for (const row of records) if (row.kind !== 'document') {
    const key = `${row.kind}:${row.targetId}`;
    const item = ranked.get(key) || { key, kind: row.kind, targetId: row.targetId, name: row.name, count: 0, failed: 0 };
    item.count++; if (row.status === 'failed') item.failed++;
    ranked.set(key, item);
  }
  const qualityTasks: QualityTask[] = records.filter(row => row.kind === 'document' && ['succeeded', 'needs_review'].includes(row.status)).map(row => {
    const random = randomFor(`${row.id}:quality`);
    const results = Array.from({ length: 8 + Math.floor(random() * 11) }, () => {
      const roll = random();
      const validationStatus = roll < .82 ? 'passed' : roll < .9 ? 'partial' : roll < .96 ? 'visual_required' : 'missing';
      const status = random() < .73 ? (random() < .12 ? 'corrected' : 'confirmed') : 'pending';
      return { status, validationStatus, kind: validationStatus === 'visual_required' ? 'visual' : 'text' };
    });
    return { id: row.id, createdAt: row.createdAt, updatedAt: row.createdAt, files: [{ id: row.id, kind: 'pdf', processed: true, results }] };
  });
  const detail = records.filter(row => (!filters.status || row.status === filters.status) && (!filters.target || `${row.kind}:${row.targetId}` === filters.target));
  return {
    from, through, generatedAt: new Date().toISOString(), legacyCount: 0, callerTracking: true,
    summary: {
      calls: records.length, documentCalls: records.filter(row => row.kind === 'document').length,
      apiCalls: records.filter(row => row.kind !== 'document').length, completed, failed: states('failed'), needsReview: states('needs_review'),
      cancelled: states('cancelled'), running: states('running'), completionRate: ended ? Math.round(completed / ended * 100) : null,
      averageMs: average(times), p95Ms: times.length ? times[Math.ceil(times.length * .95) - 1] : null, timedCalls: times.length,
    },
    phases: phases.map(phase => {
      const values = records.flatMap(row => typeof row.phases?.[phase.id] === 'number' ? [row.phases[phase.id]] : []);
      return { ...phase, count: values.length, averageMs: average(values) };
    }),
    distribution: kinds.map(item => ({ ...item, count: records.filter(row => row.kind === item.id).length })),
    activity: { trackingSince: from, through, scope: 'mock-invocations', days: daily },
    ranking: [...ranked.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)).slice(0, 5),
    records: detail.slice(0, 100), recordsTotal: detail.length,
    quality: savedResultQuality(qualityTasks, from, through), efficiency: efficiencySummary(records),
  };
}
