import { Button, Select, Tag } from 'antd';
import { CheckCircleOutlined, FileTextOutlined, ReloadOutlined } from '@ant-design/icons';
import { defaultPreprocessing, type ProfileDraft, type ProfileSample } from '../profiles.ts';

export function PreprocessingSettings({ draft, sample, busy, onChange, onReprocess, onPage }: {
  draft: ProfileDraft; sample?: ProfileSample; busy: boolean;
  onChange: (draft: ProfileDraft) => void; onReprocess: () => void; onPage: (page: number) => void;
}) {
  const policy = draft.preprocessing || defaultPreprocessing;
  return <div className="preprocessing-settings">
    <div className="preprocessing-heading"><strong>公共处理流程</strong><Tag color="blue">无大模型</Tag></div>
    <div className="preprocessing-step"><span className="preprocessing-step-number">1</span><div><strong>文字层检测</strong><p>可读 PDF 直接取字，扫描件使用 OCR。</p></div><CheckCircleOutlined /></div>
    <label>页面转正<Select aria-label="页面转正策略" disabled={busy} value={policy.orientation} onChange={orientation => onChange({ ...draft, preprocessing: { ...policy, orientation } })}
      options={[{ value: 'auto', label: '自动判断方向' }, { value: 'off', label: '保持上传方向' }, { value: '90', label: '逆时针旋转 90°' }, { value: '180', label: '旋转 180°' }, { value: '270', label: '顺时针旋转 90°' }]} /></label>
    <label>倾斜校正<Select aria-label="倾斜校正策略" disabled={busy} value={policy.deskew} onChange={deskew => onChange({ ...draft, preprocessing: { ...policy, deskew } })}
      options={[{ value: 'auto', label: '自动校正小角度倾斜' }, { value: 'off', label: '关闭' }]} /></label>
    {draft.materialTypes?.length ? <p className="scene-config-hint">文档按材料类型分别组织；在“场景配置”中设置合同保留整份、发票逐页处理等策略。</p> : <label>材料分组<Select aria-label="材料分组策略" disabled={busy} value={policy.grouping} onChange={grouping => onChange({ ...draft, preprocessing: { ...policy, grouping }, templates: draft.templates.map(item => ({ ...item, referencePage: grouping === 'per_page' ? item.referencePage || 1 : grouping === 'document' ? null : item.referencePage })) })}
      options={[{ value: 'auto', label: '自动识别独立发票，其他保留整份' }, { value: 'document', label: '整份文档 · 多页合同等' }, { value: 'per_page', label: '每页一份 · 每页一张票据' }]} /></label>}
    <div className="preprocessing-boundary">同页拼有多张票据、照片透视变形，当前需先手动裁切。</div>
    {sample && <><Button block icon={<ReloadOutlined />} disabled={busy} onClick={onReprocess}>按当前流程重新处理样例</Button>
      <div className="preprocessing-heading"><strong>样例处理记录</strong><span>{sample.pages.length} 页 · {sample.preprocessing?.unitCount || 1} 份</span></div>
      <div className="preprocessing-page-list">{sample.pages.map(page => <button type="button" key={page.number} onClick={() => onPage(page.number)}>
        <FileTextOutlined /><div><strong>第 {page.number} 页</strong><span>{page.steps?.map(step => step.label).join(' · ') || 'PDF 文字层'}</span></div><Tag color={page.needsReview ? 'warning' : 'success'}>{page.needsReview ? '待核对' : '已就绪'}</Tag>
      </button>)}</div>
    </>}
  </div>;
}
