import { useEffect, useRef, useState, type MutableRefObject } from 'react';
import { Alert, Button, Checkbox, Input, Select, Spin, Tag, Tooltip } from 'antd';
import { ArrowUpOutlined, CloseOutlined, FileExcelOutlined, PauseOutlined, RobotOutlined, UndoOutlined, UploadOutlined } from '@ant-design/icons';
import { assistantSignature, changeDescription } from '../assistant.ts';
import { profileApi, profileId, type AssistantChange, type AssistantMessage, type AssistantReply, type ProfileRule, type ProfileTemplate } from '../profiles.ts';
import { parseRequirementWorkbook } from '../service.ts';
import { DEMO_MODE } from '../demoMode.ts';
import type { RequirementWorkbook } from '../types.ts';

interface Turn { id: string; role: 'user' | 'assistant'; content: string; reply?: AssistantReply; baseline?: string; selected?: string[]; status?: 'pending' | 'applied' | 'discarded' | 'undone' }
export interface AssistantSession { input: string; turns: Turn[]; workbook?: RequirementWorkbook; sheet: string }
export type AssistantSessions = MutableRefObject<Map<string, AssistantSession>>;

export function StudioAssistant({ scope, template, selectedId, materialLabel, busy, visible, sessions, prompt, onApply, onPreview, onFields }: {
  scope: string; template: ProfileTemplate; selectedId: string; materialLabel: string; busy: boolean; visible: boolean; sessions: AssistantSessions;
  prompt?: { token: number; text: string };
  onApply: (baseline: string, changes: AssistantChange[]) => () => void;
  onPreview: (rule: ProfileRule) => void; onFields: () => void;
}) {
  const [session, setSession] = useState<AssistantSession>(() => sessions.current.get(scope) || { input: '', turns: [], sheet: '' });
  const [loading, setLoading] = useState(false); const [reading, setReading] = useState(false); const [error, setError] = useState('');
  const [undo, setUndo] = useState<{ turnId: string; run: () => void }>();
  const abort = useRef<AbortController | null>(null); const workbookAbort = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null); const bottom = useRef<HTMLDivElement>(null);
  const current = useRef(template); current.current = template;
  const disabled = busy || loading || reading;
  const sheet = session.workbook?.sheets.find(item => item.sheet === session.sheet);
  const requirements = session.workbook && sheet ? { fileName: session.workbook.fileName, ...sheet } : undefined;
  useEffect(() => { sessions.current.set(scope, session); if (sessions.current.size > 20) sessions.current.delete(sessions.current.keys().next().value!); }, [session, scope, sessions]);
  useEffect(() => { if (prompt) setSession(value => ({ ...value, input: prompt.text })); }, [prompt?.token]);
  useEffect(() => { bottom.current?.scrollIntoView?.({ block: 'nearest' }); }, [session.turns.length, loading]);
  useEffect(() => () => { abort.current?.abort(); workbookAbort.current?.abort(); }, []);
  useEffect(() => { if (!visible) { abort.current?.abort(); workbookAbort.current?.abort(); } }, [visible]);
  async function readWorkbook(file: File) {
    workbookAbort.current?.abort(); const controller = new AbortController(); workbookAbort.current = controller;
    setReading(true); setError('');
    try { const workbook = await parseRequirementWorkbook(file, controller.signal); if (!controller.signal.aborted) setSession(value => ({ ...value, workbook, sheet: workbook.sheets[0]?.sheet || '' })); }
    catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '字段表读取失败'); }
    finally { if (workbookAbort.current === controller) { workbookAbort.current = null; setReading(false); } }
  }
  async function send(value = session.input) {
    if (disabled || (!value.trim() && !requirements)) return;
    const request = value.trim() || '按照字段表的名称和要求，补充当前版式需要提取的字段。';
    const snapshot = structuredClone(current.current); const baseline = assistantSignature(snapshot);
    const history: AssistantMessage[] = session.turns.slice(-8).map(turn => ({ role: turn.role, content: turn.content.slice(0, 4000) }));
    const controller = new AbortController(); abort.current = controller; setLoading(true); setError('');
    setSession(value => ({ ...value, turns: [...value.turns.slice(-18), { id: profileId(), role: 'user', content: request }] }));
    try {
      const reply = await profileApi.assist(snapshot.sampleId, request, snapshot.fields, snapshot.fields.some(field => field.id === selectedId) ? selectedId : '', snapshot.referencePage || 0, requirements, history, controller.signal);
      if (controller.signal.aborted) return;
      setSession(value => ({ ...value, input: '', turns: [...value.turns, { id: profileId(), role: 'assistant', content: reply.message, reply, baseline, selected: reply.changes.map(change => change.id), status: 'pending' }] }));
    } catch (error) { if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '助手暂时不可用，请重试'); }
    finally { if (abort.current === controller) { abort.current = null; setLoading(false); } }
  }
  function apply(turn: Turn) {
    try {
      const changes = turn.reply!.changes.filter(change => turn.selected?.includes(change.id));
      const rollback = onApply(turn.baseline!, changes);
      setUndo({ turnId: turn.id, run: rollback });
      setSession(value => ({ ...value, turns: value.turns.map(item => item.id === turn.id ? { ...item, status: 'applied' } : item) })); setError('');
    } catch (error) { setError(error instanceof Error ? error.message : '修改未应用'); }
  }
  const signature = assistantSignature(template);
  return <section className="studio-assistant" aria-label="配置助手">
    <div className="studio-assistant-context"><RobotOutlined /><div><strong>配置助手</strong><span>{materialLabel}</span></div><Tooltip title="返回字段编辑"><Button type="text" size="small" icon={<CloseOutlined />} aria-label="返回字段编辑" onClick={onFields} /></Tooltip></div>
    <div className="studio-assistant-conversation">
      {!session.turns.length && <div className="studio-assistant-welcome"><strong>{template.fields.length ? '辅助调整提取规则' : '生成第一版规则'}</strong><p>{template.fields.length ? '描述需要调整的内容，预览建议后应用到草稿。' : '描述提取要求，或上传 Excel 字段表，生成字段与原文定位建议。'}</p></div>}
      {session.turns.map(turn => <div key={turn.id} className={`studio-assistant-turn is-${turn.role}`}><div className="studio-assistant-message">{turn.content}</div>
        {turn.reply && turn.reply.changes.length > 0 && <div className="studio-assistant-proposal"><div className="studio-assistant-proposal-title"><strong>{turn.reply.changes.length} 项修改建议</strong><Tag color={turn.status === 'applied' ? 'success' : turn.status === 'pending' && turn.baseline === signature ? 'processing' : 'default'}>{turn.status === 'applied' ? '已应用到草稿' : turn.status === 'undone' ? '已撤销' : turn.status === 'discarded' ? '已忽略' : turn.baseline !== signature ? '配置已变化' : '待应用'}</Tag></div>
          {turn.reply.changes.map(change => <div className="studio-assistant-change" key={change.id}><div className="studio-assistant-change-title"><Checkbox aria-label={`选择建议 ${change.after?.name || change.before?.name}`} checked={!!turn.selected?.includes(change.id)} disabled={disabled || turn.status !== 'pending' || turn.baseline !== signature} onChange={event => setSession(value => ({ ...value, turns: value.turns.map(item => item.id === turn.id ? { ...item, selected: event.target.checked ? [...item.selected || [], change.id] : item.selected?.filter(id => id !== change.id) } : item) }))}>{change.after?.name || change.before?.name}</Checkbox><small>{change.op === 'add' ? '新增' : change.op === 'remove' ? '移除' : '修改'}</small></div>
            <details><summary>查看差异</summary><div className="studio-assistant-diff">{changeDescription(change).map(row => <div key={row.label}><span>{row.label}</span><del>{row.before}</del><strong>{row.after}</strong></div>)}</div></details>
            {change.check && <div className="studio-assistant-check"><span>样例取值</span><strong>{change.check.value || '尚未定位'}</strong>{change.check.issue && <small>{change.check.issue}</small>}</div>}
            {(change.after?.region || change.before?.region) && <Button type="text" size="small" disabled={busy || turn.baseline !== signature || turn.status !== 'pending'} onClick={() => onPreview((change.after || change.before)!)}>预览原文位置</Button>}
          </div>)}
          {turn.status === 'pending' && <div className="studio-assistant-proposal-actions"><Button size="small" disabled={disabled} onClick={() => setSession(value => ({ ...value, turns: value.turns.map(item => item.id === turn.id ? { ...item, status: 'discarded' } : item) }))}>忽略</Button><Button type="primary" size="small" disabled={disabled || !turn.selected?.length || turn.baseline !== signature} onClick={() => apply(turn)}>应用修改（{turn.selected?.length || 0}）</Button></div>}
          {turn.status === 'pending' && turn.baseline !== signature && <p className="studio-assistant-boundary">当前样例或规则已改变，请基于最新配置重新生成。</p>}
          {turn.status === 'applied' && undo?.turnId === turn.id && <Button type="text" size="small" icon={<UndoOutlined />} disabled={busy} onClick={() => { try { undo.run(); setSession(value => ({ ...value, turns: value.turns.map(item => item.id === turn.id ? { ...item, status: 'undone' } : item) })); setUndo(undefined); setError(''); } catch (error) { setError(error instanceof Error ? error.message : '无法撤销'); } }}>撤销本次修改</Button>}
        </div>}
      </div>)}
      {loading && <div className="studio-assistant-loading" role="status"><Spin size="small" /><span>正在读取当前规则与样例，生成建议…</span></div>}
      {error && <Alert type="error" title={error} closable onClose={() => setError('')} />}
      <div ref={bottom} />
    </div>
    <div className="studio-assistant-input">
      {session.workbook && <div className="studio-assistant-workbook"><FileExcelOutlined /><span title={session.workbook.fileName}>{session.workbook.fileName}</span><small>{sheet?.fields.length || 0} 个字段</small><Button size="small" type="text" aria-label="移除助手字段表" disabled={disabled} icon={<CloseOutlined />} onClick={() => setSession(value => ({ ...value, workbook: undefined, sheet: '' }))} />{session.workbook.sheets.length > 1 && <Select aria-label="助手字段工作表" disabled={disabled} value={session.sheet} onChange={sheet => setSession(value => ({ ...value, sheet }))} options={session.workbook.sheets.map(item => ({ value: item.sheet, label: item.sheet }))} />}</div>}
      <Input.TextArea aria-label="配置助手输入" value={session.input} maxLength={4000} autoSize={{ minRows: 2, maxRows: 5 }} disabled={disabled} placeholder="例如：把价税合计改为必填，其他字段不变。" onChange={event => setSession(value => ({ ...value, input: event.target.value }))} onPressEnter={event => { if (!event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); void send(); } }} />
      <div className="studio-assistant-input-actions"><input type="file" ref={input} accept=".xlsx" hidden disabled={disabled} onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void readWorkbook(file); }} /><Button type="text" size="small" icon={<UploadOutlined />} loading={reading} disabled={disabled} onClick={() => input.current?.click()}>上传字段表</Button>{loading ? <Button size="small" icon={<PauseOutlined />} onClick={() => { if (!abort.current || abort.current.signal.aborted) return; abort.current.abort(); setSession(value => ({ ...value, turns: [...value.turns, { id: profileId(), role: 'assistant', content: '已停止，本次未应用任何修改。' }] })); }}>停止</Button> : <Tooltip title="发送"><Button type="primary" shape="circle" size="small" icon={<ArrowUpOutlined />} aria-label="发送给配置助手" disabled={disabled || (!session.input.trim() && !requirements)} onClick={() => void send()} /></Tooltip>}</div>
      <small className="studio-assistant-boundary">{DEMO_MODE ? '固定演示建议 · 未调用大模型' : '识别文本与规则发送至 DeepSeek'} · 修改仅影响草稿</small>
    </div>
  </section>;
}
