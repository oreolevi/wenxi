import type { Material, SavedTaskSummary } from './types.ts';

export interface SkillDraft {
  id: string; name: string; category: string; description: string; version: string;
  rules: Array<{ field: string; meaning: string }>; components: string[];
}
export const initialSkills: SkillDraft[] = [
  { id: 'contract', name: '合同条款理解', category: '合同', version: 'v0.1',
    description: '理解合同主体、交易明细和支付条款，处理字段名称与正文表达不一致的情况。',
    rules: [
      { field: '付款条件', meaning: '查找验收、审核、发票及其他付款前置约束，保留各条原文，区分实际履行情况与条款要求。' },
      { field: '付款进度', meaning: '查找各支付阶段、触发条件、支付比例与期限；区分累计比例与本次比例，不能将累计比例直接相加。' },
      { field: '签订日期 / 生效日期', meaning: '分别识别签订日期、明确生效日与生效条件，按调用方要求选择；没有固定生效日期时不推算。' },
    ], components: ['ocr', 'layout', 'semantic', 'grounding'] },
  { id: 'invoice', name: '发票字段语义', category: '发票', version: 'v0.1',
    description: '区分购销方、票面金额与项目名称，处理同一字段的跨行续文。',
    rules: [{ field: '购销方', meaning: '按票面角色分别取完整名称，不因出现顺序或同名关键字交换买卖双方。' },
      { field: '金额与税率', meaning: '分别提取不含税金额、税额和价税合计，缺失时不反算或猜测。' },
      { field: '项目名称', meaning: '保持发生地与项目名称的列关系，保留同一列中的后续文字行。' }], components: ['pdf-text', 'layout', 'semantic', 'grounding'] },
  { id: 'application', name: '申请表审核角色', category: '申请表', version: 'v0.1',
    description: '识别申请主体、联系人和不同审核层级，避免将初审人员当作最终审核人员。',
    rules: [{ field: '最终审核人员', meaning: '依据最终审核、复核批准等角色上下文查找，不以第一个出现的审核人代替。' },
      { field: '通讯地址', meaning: '区分注册地址与实际通讯地址，多处候选时保留不确定性。' }], components: ['ocr', 'semantic', 'grounding'] },
];

export const capabilityComponents = [
  { id: 'orientation', name: '页面自动转正', category: '预处理', engine: 'PP-OCR', state: '已接入',
    description: '判断四个方向，将横放和倒置的扫描页转正。', input: '扫描 PDF、图片页面', output: '转正预览、方向评分、原图坐标映射', limit: '低文字量或方向不明确时标记待核对；可在服务设置中指定角度。' },
  { id: 'deskew', name: '倾斜校正', category: '预处理', engine: 'OpenCV', state: '已接入',
    description: '根据页面长线校正轻微倾斜，保留边缘内容。', input: '已转正的扫描页面', output: '校正图像、倾斜角度、逆变换矩阵', limit: '适用小于 6° 的倾斜；证据不足时跳过，不处理照片透视变形。' },
  { id: 'document-grouping', name: '逐页票据分组', category: '预处理', engine: '文析', state: '已接入',
    description: '同一 PDF 内的独立发票分别提取、汇总。', input: '逐页文字与位置、材料分组策略', output: '独立材料、来源页码、每份提取结果', limit: '自动分组要求每页有独立发票标识；合同默认保留整份。同页拼票需先手动裁切。' },
  { id: 'ocr', name: 'OCR 文字识别', category: '识别', engine: 'MinerU', state: '已接入',
    description: '识别扫描件文字，保留页码与内容块位置。', input: 'PDF、PNG、JPEG、WebP', output: '文字块、页码、归一化坐标', limit: '扫描质量、水印和印章覆盖可能导致漏字，表格区域仍为块级坐标。' },
  { id: 'pdf-text', name: 'PDF 文字层', category: '识别', engine: 'PDFium', state: '已接入',
    description: '从可用的原生文字层读取文字与位置，减少识别损失。', input: '具有可用文字层的 PDF', output: '文字片段、页码、位置', limit: '旋转页及不可用文字层回退到 OCR；跨列与续行仍需校验。' },
  { id: 'layout', name: '版面与表格解析', category: '结构', engine: 'MinerU', state: '已接入',
    description: '保留段落、表格行列与阅读区域关系。', input: '文档页面', output: '版面块、表格行与单元格引用', limit: '当前表格单元格可能共享整表坐标，不代表精确单元格边框。' },
  { id: 'semantic', name: '语义字段提取', category: '理解', engine: 'DeepSeek', state: '已接入',
    description: '根据用户要求与字段规则，选择和组织有依据的内容。', input: '识别文本、提取要求、字段规则', output: '单值、分段条款、表格、带依据的判断', limit: '业务完整性仍需复核；业务 Skill 的配置与自动选择尚未接入。' },
  { id: 'grounding', name: '原文引用校验', category: '校验', engine: '文析', state: '已接入',
    description: '核对值与引用，生成可定位的原文依据。', input: '候选结果及真实原文块', output: '通过、待核对、缺失等状态', limit: '引用通过只证明有出处，不能代替业务准确性与完整性核验。' },
  { id: 'seal', name: '印章与签名核验', category: '图像', engine: '待选择', state: '待接入',
    description: '核验实际印文、手写签名以及签署区域与角色的对应关系。', input: '原文图像、签署区域、核验要求', output: '待定义的图像核验结果', limit: '目前没有自动核验能力，相关字段继续标记为待图像核验。' },
] as const;

export interface HistoryEntry {
  id: string; name: string; status: '已完成' | '处理中' | '失败' | '待处理'; type: string;
  time: string; total: number; passed: number; review: number; visual: number; missing: number;
  confirmed: number; tokens: number | null; modelMs: number | null; materialId?: string; recordId?: string;
}
export function savedHistory(records: SavedTaskSummary[]): HistoryEntry[] {
  return records.flatMap(record => sessionHistory(record.files, false, '').map(row => ({ ...row,
    id: `${record.id}:${row.id}`, recordId: record.id,
    time: new Date(record.updatedAt).toLocaleString('zh-CN', { hour12: false }),
  })));
}
export const exampleHistory: HistoryEntry[] = [
  { id: 'DEMO-1030-004', name: '采购合同_示例.pdf', status: '已完成', type: '合同', time: '2026-10-30 10:42', total: 12, passed: 9, review: 1, visual: 2, missing: 0, confirmed: 7, tokens: 5400, modelMs: 8600 },
  { id: 'DEMO-1030-003', name: '费用发票_示例.pdf', status: '已完成', type: '发票', time: '2026-10-30 10:18', total: 8, passed: 7, review: 0, visual: 0, missing: 1, confirmed: 6, tokens: 3200, modelMs: 4200 },
  { id: 'DEMO-1030-002', name: '资料变更申请表_示例.pdf', status: '已完成', type: '申请表', time: '2026-10-30 09:56', total: 6, passed: 6, review: 0, visual: 0, missing: 0, confirmed: 6, tokens: 1800, modelMs: 3100 },
  { id: 'DEMO-1030-001', name: '扫描材料_示例.pdf', status: '失败', type: '其他', time: '2026-10-30 09:30', total: 0, passed: 0, review: 0, visual: 0, missing: 0, confirmed: 0, tokens: null, modelMs: null },
];
export function sessionHistory(files: Material[], busy: boolean, progress: string): HistoryEntry[] {
  return files.filter(file => file.kind !== 'spreadsheet').map(file => {
    const fields = file.results || [];
    return { id: file.id, name: file.name, materialId: file.id,
      status: busy && progress.startsWith(file.name) ? '处理中' : file.error ? '失败' : file.processed && !['word', 'archive'].includes(file.kind) ? '已完成' : '待处理',
      type: ({ pdf: 'PDF', image: '图片', text: '文本', demo: '内置示例', word: 'Word', archive: 'ZIP', spreadsheet: 'Excel' })[file.kind], time: '当前会话', total: fields.length,
      passed: fields.filter(field => field.validationStatus === 'passed').length,
      review: fields.filter(field => ['partial', 'rejected'].includes(field.validationStatus || '') || field.status === 'rejected').length,
      visual: fields.filter(field => field.kind === 'visual').length,
      missing: fields.filter(field => field.status === 'missing').length,
      confirmed: fields.filter(field => ['confirmed', 'corrected'].includes(field.status)).length,
      tokens: typeof file.parsed?.modelCall?.usage?.total_tokens === 'number' ? file.parsed.modelCall.usage.total_tokens : null,
      modelMs: file.parsed?.modelCall?.elapsedMs ?? null };
  });
}
export function historyStats(rows: HistoryEntry[]) {
  const sum = (key: 'total' | 'passed' | 'review' | 'visual' | 'missing' | 'confirmed') => rows.reduce((value, row) => value + row[key], 0);
  return { count: rows.length, complete: rows.filter(row => row.status === '已完成').length,
    failed: rows.filter(row => row.status === '失败').length, active: rows.filter(row => ['处理中', '待处理'].includes(row.status)).length,
    fields: sum('total'), passed: sum('passed'), review: sum('review'), visual: sum('visual'), missing: sum('missing'), confirmed: sum('confirmed'),
    tokens: rows.some(row => row.tokens !== null) ? rows.reduce((value, row) => value + (row.tokens || 0), 0) : null,
    unknownUsage: rows.filter(row => row.tokens === null).length };
}
