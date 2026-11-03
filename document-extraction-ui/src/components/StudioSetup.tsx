import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Input, Select, Spin } from 'antd';
import { CheckCircleOutlined, EditOutlined, FileExcelOutlined, FileTextOutlined, RobotOutlined, UploadOutlined } from '@ant-design/icons';
import { parseRequirementWorkbook } from '../service.ts';
import { profileApi, type ProfileRule, type RulePreview } from '../profiles.ts';
import type { RequirementDefinition, RequirementWorkbook } from '../types.ts';

export type ConfigurationMode = 'manual' | 'ai';
export function StudioSetup({ busy, initialRequest, hasFields, mode, compact, importOnly, onModeChange, onStart, onCancel, onStop }: {
  busy: boolean; initialRequest: string; hasFields: boolean; mode?: ConfigurationMode; compact?: boolean; importOnly?: boolean; onModeChange: (mode: ConfigurationMode) => void;
  onStart: (mode: ConfigurationMode, request: string, requirements?: RequirementDefinition) => void;
  onCancel: () => void; onStop: () => void;
}) {
  const [request, setRequest] = useState(initialRequest);
  const [workbook, setWorkbook] = useState<RequirementWorkbook>();
  const [sheet, setSheet] = useState('');
  const [reading, setReading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  async function read(file: File) {
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    setReading(true); setError(''); setWorkbook(undefined); setSheet('');
    try { const value = await parseRequirementWorkbook(file, abort.signal); setWorkbook(value); setSheet(value.sheets[0]?.sheet || ''); }
    catch (error) { if (!abort.signal.aborted) setError(error instanceof Error ? error.message : '字段表读取失败'); }
    finally { if (controller.current === abort) { controller.current = null; setReading(false); } }
  }
  const selectedSheet = workbook?.sheets.find(item => item.sheet === sheet);
  const requirements = workbook && selectedSheet ? { fileName: workbook.fileName, ...selectedSheet } : undefined;
  return <div className="studio-setup" aria-label="选择配置方式">
    <div className="studio-setup-heading">{!compact && <span>样例已就绪</span>}<h2>{importOnly ? '导入字段表' : compact ? mode === 'manual' ? '人工配置' : 'AI 辅助配置' : '如何开始配置？'}</h2></div>
    <div hidden={compact} className="studio-mode-options" role="group" aria-label="配置方式">
      <button type="button" disabled={busy || reading} aria-pressed={mode === 'manual'} onClick={() => onModeChange('manual')}><EditOutlined /><span><strong>人工配置</strong><small>自己添加字段，在原文上定位</small></span><i aria-hidden>{mode === 'manual' && <CheckCircleOutlined />}</i></button>
      <button type="button" disabled={busy || reading} aria-pressed={mode === 'ai'} onClick={() => onModeChange('ai')}><RobotOutlined /><span><strong>AI 辅助配置</strong><small>先生成规则草稿，再人工校准</small></span><i aria-hidden>{mode === 'ai' && <CheckCircleOutlined />}</i></button>
    </div>
    {mode && <div className="studio-setup-requirements">
      {mode === 'ai' && <label>提取要求<Input.TextArea aria-label="AI 配置提取要求" value={request} maxLength={4000} disabled={busy || reading} rows={4} onChange={event => setRequest(event.target.value)} placeholder="例如：提取发票号码、开票日期、购买方名称和价税合计。" /></label>}
      <input ref={input} type="file" accept=".xlsx" hidden disabled={busy || reading} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void read(file); }} />
      <Button icon={<UploadOutlined />} loading={reading} disabled={busy} onClick={() => input.current?.click()}>{mode === 'ai' ? '或上传 Excel 字段表' : '从 Excel 导入字段'}</Button>
      {workbook && <div className="studio-setup-workbook"><FileExcelOutlined /><span title={workbook.fileName}>{workbook.fileName}</span><Button type="text" size="small" disabled={busy || reading} onClick={() => { setWorkbook(undefined); setSheet(''); }}>移除</Button>
        {workbook.sheets.length > 1 && <Select aria-label="配置字段工作表" value={sheet} disabled={busy} onChange={setSheet} options={workbook.sheets.map(item => ({ value: item.sheet, label: item.sheet }))} />}
        <small>{selectedSheet?.fields.length || 0} 个字段</small>
      </div>}
      {requirements && <details className="studio-setup-field-names"><summary>查看字段清单</summary>{requirements.fields.map(item => <div key={item.name}><strong>{item.name}</strong>{item.rule && <span>{item.rule}</span>}</div>)}</details>}
      {mode === 'ai' && <small className="studio-setup-note">样例识别文本与提取要求将发送至 DeepSeek。</small>}
    </div>}
    {error && <Alert type="error" title={error} showIcon />}
    <div className="studio-setup-actions">{busy ? <><span role="status"><Spin size="small" /> 正在生成并核对原文位置</span><Button onClick={onStop}>停止生成</Button></> : <>
      {hasFields && <Button onClick={onCancel}>返回字段</Button>}
      <Button type="primary" disabled={!mode || reading || (importOnly && !requirements) || (mode === 'ai' && !request.trim() && !requirements)} onClick={() => { if (mode) onStart(mode, request.trim(), requirements); }}>{importOnly ? `导入字段（${requirements?.fields.length || 0}）` : mode === 'manual' ? '进入人工配置' : '生成配置草稿'}</Button>
    </>}</div>
  </div>;
}

export function RuleSamplePreview({ sampleId, rule, referencePage, busy, locating, onLocate, onConfirm }: {
  sampleId: string; rule: ProfileRule; referencePage: number; busy: boolean; locating: boolean;
  onLocate: () => void; onConfirm: () => void;
}) {
  const [result, setResult] = useState<RulePreview>();
  const [error, setError] = useState(''); const [loading, setLoading] = useState(false);
  const serialized = JSON.stringify({ id: rule.id, ...Object.fromEntries(executionKeys.map(key => [key, rule[key]])) });
  useEffect(() => {
    setResult(undefined); setError(''); setLoading(false);
    if (!rule.region) return;
    const abort = new AbortController(); setLoading(true);
    const timer = setTimeout(() => {
      void profileApi.previewRule(sampleId, JSON.parse(serialized), referencePage, abort.signal)
        .then(value => { if (!abort.signal.aborted) setResult(value); })
        .catch(error => { if (!abort.signal.aborted) setError(error.message); })
        .finally(() => { if (!abort.signal.aborted) setLoading(false); });
    }, 250);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [sampleId, serialized, referencePage]);
  const status = !rule.region ? '待定位' : error ? '取值失败' : loading ? '正在读取' : result?.status === 'matched' ? rule.review === 'pending' ? '待确认' : rule.review === 'confirmed' ? '已确认' : '已取值' : result ? '需调整' : '正在读取';
  return <div className="studio-rule-preview" aria-label="字段样例取值" aria-busy={loading}>
    <div className="studio-value-heading"><span>样例取值</span><small className={status === '待定位' || status === '需调整' || status === '取值失败' ? 'needs-attention' : ''}>{status}</small></div>
    {loading ? <Spin size="small" /> : <strong>{result?.value || '—'}</strong>}
    {(error || result?.issue || (!rule.region && rule.note)) && <p role="status">{error || result?.issue || rule.note}</p>}
    <div className="studio-value-footer"><div className="studio-value-source"><span>原文来源</span>{rule.region ? <Button type="link" size="small" onClick={onLocate} disabled={busy} aria-label="查看字段原文来源">第 {referencePage || rule.page} 页</Button> : <span>尚未定位</span>}</div>
      <div className="studio-value-actions"><Button size="small" icon={<EditOutlined />} disabled={busy} onClick={onLocate}>调整定位</Button><Button size="small" type={rule.review === 'confirmed' ? 'default' : 'primary'} icon={<CheckCircleOutlined />} disabled={busy || loading || !rule.region || result?.status !== 'matched' || rule.review === 'confirmed'} onClick={onConfirm}>{rule.review === 'confirmed' ? '已确认' : '确认此字段'}</Button></div></div>
    {locating && <p className="studio-locating-hint" role="status">在原文中点击文字，或切换为框选区域。</p>}
  </div>;
}

const executionKeys = ['key', 'name', 'kind', 'method', 'page', 'region', 'anchor', 'direction', 'required', 'stripLabel'] as const;
export function parseRuleSource(source: string, original: ProfileRule): ProfileRule {
  const value = JSON.parse(source);
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !executionKeys.includes(key as typeof executionKeys[number]))) throw new Error('仅支持当前字段的执行配置项。');
  const next: ProfileRule = { ...original, ...value };
  if (typeof next.name !== 'string' || !next.name.trim() || next.name.length > 60 || typeof next.key !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_]{0,59}$/.test(next.key)) throw new Error('请填写字段名称和有效的英文接口字段名。');
  if (!['text', 'number', 'amount', 'date'].includes(next.kind) || !['region', 'anchor'].includes(next.method) || !['right', 'below'].includes(next.direction) || !Number.isInteger(next.page) || next.page < 1 || next.page > 50 || typeof next.required !== 'boolean' || typeof next.anchor !== 'string' || next.anchor.length > 100 || typeof next.stripLabel !== 'boolean') throw new Error('数据类型、定位方式、页码或开关值无效。');
  if (next.region !== null && (!Array.isArray(next.region) || next.region.length !== 4 || next.region.some(value => typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) || next.region[0] >= next.region[2] || next.region[1] >= next.region[3])) throw new Error('区域应为 0 到 1 之间的 [左, 上, 右, 下] 坐标。');
  return next;
}

export function RuleSourceEditor({ rule, busy, onApply }: { rule: ProfileRule; busy: boolean; onApply: (rule: ProfileRule) => void }) {
  const [open, setOpen] = useState(false); const [source, setSource] = useState(''); const [error, setError] = useState('');
  return <>
    <Button type="text" className="studio-rule-source-button" icon={<FileTextOutlined />} disabled={busy} onClick={() => { setSource(JSON.stringify(Object.fromEntries(executionKeys.map(key => [key, rule[key] ?? (key === 'stripLabel' ? false : null)])), null, 2)); setError(''); setOpen(true); }}>规则配置 JSON</Button>
    <Drawer title={`规则配置 · ${rule.name}`} open={open} placement="right" size={520} closable={{ placement: 'end' }} className="platform-drawer studio-rule-source" onClose={() => setOpen(false)} footer={<><Button onClick={() => setOpen(false)}>取消</Button><Button type="primary" disabled={busy} onClick={() => { try { onApply(parseRuleSource(source, rule)); setOpen(false); } catch (error) { setError(error instanceof Error ? error.message : 'JSON 格式无效'); } }}>应用配置</Button></>}>
      <p>修改后返回原文预览核对，再测试和发布。</p><Input.TextArea aria-label="字段规则 JSON" value={source} onChange={event => setSource(event.target.value)} rows={22} spellCheck={false} />
      {error && <Alert role="alert" type="error" title={error} />}
    </Drawer>
  </>;
}
