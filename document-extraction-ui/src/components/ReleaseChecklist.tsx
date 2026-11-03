import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Drawer, Empty, Input, Space, Spin } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, ReloadOutlined } from '@ant-design/icons';
import type { ReleaseReport, ReleaseTarget } from '../release.ts';

export function ReleaseChecklist({ open, name, onClose, onCheck, onPublish, onNavigate, allowNote = false }: {
  open: boolean; name: string; onClose: () => void; onCheck: () => Promise<ReleaseReport>;
  onPublish: (note?: string) => Promise<void>; onNavigate: (target: ReleaseTarget) => void; allowNote?: boolean;
}) {
  const [report, setReport] = useState<ReleaseReport>();
  const [checking, setChecking] = useState(false); const [publishing, setPublishing] = useState(false);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  const [note, setNote] = useState('');
  const current = useRef({ onCheck, onPublish }); current.current = { onCheck, onPublish };
  useEffect(() => {
    if (!open) { setReport(undefined); setError(''); setNote(''); return; }
    let live = true; setChecking(true); setError(''); setReport(undefined);
    void current.current.onCheck().then(value => { if (live) setReport(value); }).catch(e => { if (live) setError(e instanceof Error ? e.message : '检查失败，请重试'); }).finally(() => { if (live) setChecking(false); });
    return () => { live = false; };
  }, [open, attempt]);
  async function publish() {
    if (!report?.ready) return;
    setPublishing(true); setError('');
    try { await current.current.onPublish(note.trim()); }
    catch (e) { setReport(undefined); setError(e instanceof Error ? e.message : '发布未完成，请重新检查'); }
    finally { setPublishing(false); }
  }
  return <Drawer title="发布检查" open={open} placement="right" size={520} className="studio-release-check" styles={{ wrapper: { maxWidth: '100vw' } }} maskClosable={!publishing} closable={!publishing} onClose={() => { if (!publishing) onClose(); }} footer={<Space>
    <Button disabled={publishing} onClick={onClose}>返回编辑</Button>
    {report?.ready ? <Button type="primary" loading={publishing} disabled={checking} onClick={() => report.unchanged ? onNavigate({ area: 'api' }) : void publish()}>{report.unchanged ? '查看已发布接口' : `确认发布 v${report.nextVersion}`}</Button>
      : <Button icon={<ReloadOutlined />} loading={checking} disabled={publishing} onClick={() => setAttempt(value => value + 1)}>重新检查</Button>}
  </Space>}>
    <div className="release-check-context"><strong>{name}</strong><span>{checking ? '正在保存草稿并检查发布条件…' : report?.ready ? report.unchanged ? `当前配置已发布为 v${report.currentVersion}` : '发布条件已满足' : report ? `${report.issues.length} 项需要处理` : '检查未完成'}</span></div>
    {checking ? <div className="release-check-loading" role="status"><Spin /><span>检查字段、测试结果与版本状态</span></div> : <>
      {error && <Alert type="error" showIcon title={error} description="本次未发布，请处理上述问题后重新检查。" />}
      {report?.ready ? <div className="release-check-ready"><CheckCircleOutlined /><h3>{report.unchanged ? '已是当前发布版本' : '可以发布此版本'}</h3><p>{report.unchanged ? '接口继续使用已发布的固定配置。' : '确认后生成固定版本，现有调用方继续使用其指定版本。'}</p></div>
        : report && <div className="release-check-issues">{report.issues.map((issue, index) => <article key={`${issue.code}:${index}`}><div><strong>{issue.title}</strong><p>{issue.detail}</p></div><Button size="small" type="link" icon={<ArrowRightOutlined />} iconPlacement="end" aria-label={`处理：${issue.title}`} onClick={() => onNavigate(issue.target)}>去处理</Button></article>)}</div>}
      {allowNote && report?.ready && !report.unchanged && <label className="studio-release-note">发布说明（可选）<Input.TextArea aria-label="发布说明" value={note} onChange={event => setNote(event.target.value)} disabled={publishing} maxLength={500} rows={3} placeholder="例如：新增一种发票版式，调整金额字段定位" /></label>}
      {!report && !error && <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无检查结果" />}
    </>}
  </Drawer>;
}
