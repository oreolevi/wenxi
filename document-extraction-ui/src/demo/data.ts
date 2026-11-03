import type { ProfileDraft, ProfileRecord, ProfileRule, ProfileSample, ProfileTest } from '../profiles.ts';
import type { SceneRecord } from '../studio.ts';
import type { ExtractedField, ParsedDocument, SourceEvidence, TaskSnapshot } from '../types.ts';

export type DemoKind = 'invoice' | 'contract' | 'application';
const definitions = {
  invoice: {
    title: '采购费用演示票据', name: '虚构采购票据_DEMO.pdf',
    rows: [['invoice_number', '票据号码', 'DEMO-INV-2026-001'], ['invoice_date', '开票日期', '2026-11-01'],
      ['buyer_name', '购买方名称', '星河演示科技有限公司（虚构）'], ['seller_name', '销售方名称', '云杉演示设备有限公司（虚构）'],
      ['item_name', '项目名称', '演示办公设备'], ['amount', '不含税金额', '10000.00'], ['tax', '税额', '1300.00'], ['total', '价税合计', '11300.00']],
  },
  contract: {
    title: '设备采购演示合同', name: '虚构设备采购合同_DEMO.pdf',
    rows: [['contract_number', '合同编号', 'DEMO-HT-2026-008'], ['party_a', '甲方名称', '星河演示科技有限公司（虚构）'],
      ['party_b', '乙方名称', '云杉演示设备有限公司（虚构）'], ['amount', '合同金额', '11300.00'],
      ['date', '签订日期', '2026-11-01'], ['payment', '付款条件', '验收通过后 10 个工作日内支付全款']],
  },
  application: {
    title: '企业资料变更演示申请表', name: '虚构资料变更申请表_DEMO.pdf',
    rows: [['company', '企业名称', '星河演示科技有限公司（虚构）'], ['submitter', '提交人', '演示经办人'],
      ['address', '通讯地址', '演示市示例区虚构路 100 号'], ['phone', '联系电话', '000-0000-0000'],
      ['date', '申请日期', '2026-11-01'], ['reviewer', '最终审核人员', '演示审核人']],
  },
} satisfies Record<DemoKind, { title: string; name: string; rows: string[][] }>;
export const demoKind = (name: string): DemoKind => /合同/.test(name) ? 'contract' : /申请|资料/.test(name) ? 'application' : 'invoice';
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
export function demoSample(kind: DemoKind = 'invoice', id = `demo-sample-${kind}`): ProfileSample {
  const definition = definitions[kind];
  const blocks: SourceEvidence[] = definition.rows.map(([key, label, value], index) => ({
    pageIndex: 0, blockIndex: index, bbox: [.34, .255 + index * .065, .91, .29 + index * .065],
    text: value, ref: key, quote: `${label}：${value}`, source: 'pdf_text',
  }));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1080"><rect width="800" height="1080" fill="white"/><g font-family="Arial,PingFang SC,sans-serif"><text x="60" y="70" fill="#7c8a9f" font-size="16">WENXI / DEMO DOCUMENT</text><text x="400" y="153" text-anchor="middle" fill="#17253c" font-size="30" font-weight="600">${definition.title}</text><text x="400" y="194" text-anchor="middle" fill="#a55c24" font-size="17">虚构演示材料 · 非真实合同或税务凭证</text>${definition.rows.map(([, label, value], i) => `<line x1="60" x2="740" y1="${325 + i * 70.2}" y2="${325 + i * 70.2}" stroke="#e6eaf0"/><text x="70" y="${304 + i * 70.2}" fill="#778397" font-size="19">${label}</text><text x="282" y="${304 + i * 70.2}" fill="#263449" font-size="19">${escape(value)}</text>`).join('')}<text x="400" y="975" text-anchor="middle" fill="#a9b2c0" font-size="20">所有公司、金额、人员和编号均为虚构</text><text x="400" y="1025" text-anchor="middle" fill="#a9b2c0" font-size="15">文析在线演示 / 第 1 页</text></g></svg>`;
  return { id, name: definition.name, engine: '演示数据', sourceHash: `fictional-${kind}`, pages: [{ number: 1, width: 800, height: 1080, imageUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` }], blocks };
}
export function demoRules(sample: ProfileSample, names?: string[], ai = false): ProfileRule[] {
  const definition = definitions[demoKind(sample.name)];
  return (names?.length ? names : definition.rows.map(row => row[1])).map((name, i) => {
    const index = Math.max(0, definition.rows.findIndex(row => row[1] === name));
    const row = definition.rows[index];
    return { id: `rule-${i}-${row[0]}`, key: names?.length && !definition.rows.some(row => row[1] === name) ? `field_${i + 1}` : row[0], name,
      kind: /金额|税额|合计/.test(name) ? 'amount' : /日期/.test(name) ? 'date' : 'text', method: 'region', page: 1,
      region: sample.blocks[index]?.bbox || [.34, .25, .91, .29], anchor: '', direction: 'right', required: true,
      origin: ai ? 'ai' : 'manual', review: ai ? 'pending' : 'confirmed', note: '固定虚构示例，用于演示配置操作。' };
  });
}
export function demoTest(draft: ProfileDraft, sample: ProfileSample, templateId?: string): ProfileTest {
  const template = draft.templates.find(item => item.id === templateId) || draft.templates[0];
  const definition = definitions[demoKind(sample.name)];
  const fields: ProfileTest['fields'] = (template?.fields || []).map(rule => {
    const index = definition.rows.findIndex(row => row[0] === rule.key || row[1] === rule.name);
    const block = index < 0 ? undefined : sample.blocks[index];
    return { key: rule.key, name: rule.name, value: block?.text || '', raw: block?.text || '', status: block ? 'matched' : 'missing',
      issue: block ? '' : '内置虚构样例中没有此字段', page: 1, bbox: block?.bbox || null, evidence: block ? [block] : [] };
  });
  return { templateId: template?.id || '', templateName: template?.name || '', sampleId: sample.id, testedAt: new Date().toISOString(),
    scope: sample.id === template?.sampleId ? 'reference' : 'new-sample', engine: '演示数据', elapsedMs: 18, recognitionMs: 0,
    passed: !!fields.length && fields.every(field => field.status === 'matched'), usesLlm: false, fields };
}
export function demoDocument(sample: ProfileSample): ParsedDocument {
  return { id: sample.id, engine: '演示数据', tier: 'basic', extractor: 'label-match', pages: sample.pages,
    fullText: { url: `/api/documents/${sample.id}/fulltext`, downloadUrl: '', packageUrl: '', pageCount: 1, imageCount: 0 } };
}
export function demoFields(sample: ProfileSample): ExtractedField[] {
  return definitions[demoKind(sample.name)].rows.map(([key, name], i) => ({ key, name, value: sample.blocks[i].text, raw: sample.blocks[i].text,
    page: 1, ref: key, aliases: [name], note: '虚构示例结果，未执行真实识别。', status: 'pending', validationStatus: 'passed', evidence: [sample.blocks[i]] }));
}
export function demoMarkdown(sample: ProfileSample) {
  return `# ${definitions[demoKind(sample.name)].title}\n\n> 虚构演示材料，未执行真实文档识别。\n\n| 字段 | 内容 |\n| --- | --- |\n${demoFields(sample).map(field => `| ${field.name} | ${field.value} |`).join('\n')}\n\n所有主体、编号和金额均为虚构。`;
}
export interface DemoState {
  profiles: Record<string, ProfileRecord>; scenes: Record<string, SceneRecord>; samples: Record<string, ProfileSample>;
  versions: Record<string, Record<string, ProfileDraft>>; history: Record<string, { id: string; createdAt: string; updatedAt: string; snapshot: TaskSnapshot }>;
  reviews: import('../profiles.ts').PublicationReview[]; evaluations: Record<string, import('../profiles.ts').EvaluationReport[]>;
}
export function initialDemoState(): DemoState {
  const now = new Date().toISOString();
  const state: DemoState = { profiles: {}, scenes: {}, samples: {}, versions: {}, history: {}, reviews: [], evaluations: {} };
  for (const kind of ['invoice', 'contract', 'application'] as const) {
    const sample = demoSample(kind); state.samples[sample.id] = sample;
    const names = { invoice: '演示票据要素提取', contract: '演示采购合同要素提取', application: '演示申请表要素提取' };
    const id = `demo-service-${kind}`;
    const draft: ProfileDraft = { id, name: names[kind], description: `基于虚构${kind === 'invoice' ? '票据' : kind === 'contract' ? '合同' : '申请表'}样例，演示字段定位、测试与发布。`, resourceKind: 'parser',
      preprocessing: { orientation: 'auto', deskew: 'auto', grouping: 'auto' }, templates: [{ id: `template-${kind}`, name: '标准演示版式', sampleId: sample.id, matchTexts: [definitions[kind].title], fields: demoRules(sample) }] };
    const test = demoTest(draft, sample);
    state.profiles[id] = { draft, createdAt: now, updatedAt: now, versions: ['1.0.0'], publishedDraft: structuredClone(draft), lastTest: { hash: 'demo', templates: { [test.templateId]: test } } };
    state.versions[id] = { '1.0.0': structuredClone(draft) };
    const file = { id: sample.id, name: sample.name, kind: 'pdf' as const, size: 0, processed: true, parsed: demoDocument(sample), results: demoFields(sample) };
    state.history[`demo-history-${kind}`] = { id: `demo-history-${kind}`, createdAt: now, updatedAt: now,
      snapshot: { files: [file], messages: [{ id: `${kind}-user`, role: 'user', text: '提取这份演示材料中的关键信息。' }, { id: `${kind}-reply`, role: 'assistant', text: '已展示虚构示例结果，可点击字段查看原文位置。', resultLink: true }], draft: '', activeId: sample.id, selectedKey: null, page: 1 } };
  }
  for (const [id, name, parsers] of [
    ['demo-scene-payment', '企业采购付款演示', ['invoice', 'contract']],
    ['demo-scene-profile', '企业资料变更演示', ['application']],
  ] as const) {
    const draft = { id, name, description: '虚构业务流程，用于体验服务组合、整包联调和接口发布。', bindings: parsers.map(kind => ({ id: `binding-${kind}`, parserId: `demo-service-${kind}`, name: kind === 'invoice' ? '采购票据' : kind === 'contract' ? '采购合同' : '资料申请表', version: '1.0.0', required: true, multiple: true })) };
    state.scenes[id] = { draft, versions: [], updatedAt: now, efficiency: { minutesPerRun: 5 } };
  }
  return state;
}
