import { useEffect, useState } from 'react';
import { Alert, App, Button, InputNumber } from 'antd';
import { sceneApi, type EfficiencyBaseline } from '../studio.ts';

export function SceneEfficiencySettings({ id, baseline, onSaved }: {
  id: string; baseline?: EfficiencyBaseline; onSaved: (value: EfficiencyBaseline) => void;
}) {
  const { message } = App.useApp();
  const [minutes, setMinutes] = useState<number | null>(baseline?.minutesPerRun ?? null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { setMinutes(baseline?.minutesPerRun ?? null); }, [id, baseline?.minutesPerRun]);
  const changed = minutes !== (baseline?.minutesPerRun ?? null);
  async function save() {
    setSaving(true); setError('');
    try { const value = await sceneApi.efficiency(id, minutes); onSaved(value); void message.success('效能基准已保存'); }
    catch (failure) { setError(failure instanceof Error ? failure.message : '保存失败，请重试'); }
    finally { setSaving(false); }
  }
  return <section className="scene-efficiency-settings">
    <label htmlFor="scene-minutes-saved">单次预计节约时长</label>
    <InputNumber id="scene-minutes-saved" min={0} max={1440} precision={2} value={minutes} onChange={setMinutes} suffix="分钟" placeholder="未设置" disabled={saving} style={{ width: '100%' }} />
    <p className="platform-caption">与人工处理相比，每次成功调用预计节约的时间，用于运行看板的工时估算。</p>
    <p className="platform-caption">保存后对新调用生效，不改变历史数据或已发布的提取规则。</p>
    {error && <Alert type="error" title={error} />}
    <Button disabled={!changed || saving} loading={saving} onClick={() => void save()}>保存效能基准</Button>
  </section>;
}
