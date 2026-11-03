import { Button, Input, Tooltip } from 'antd';
import { ArrowRightOutlined, CheckOutlined, FileTextOutlined, UploadOutlined } from '@ant-design/icons';
import type { ProfileSample } from '../profiles.ts';

export function ServiceBuilderStart({ name, request, file, prepared, seedCount, busy, onName, onRequest, onSelect, onChoose, onCreate }: {
  name: string; request: string; file: File | null; prepared: ProfileSample | null; seedCount: number; busy: boolean;
  onName: (name: string) => void; onRequest: (request: string) => void;
  onSelect: (file: File) => void; onChoose: () => void; onCreate: (generate: boolean) => void;
}) {
  const ready = !!name.trim() && !!(file || prepared);
  return <section className="service-start" aria-label="构建解析服务">
    <div className="service-start-inner">
      <div className="service-start-title"><h2>新建解析服务</h2><ol aria-label="服务构建步骤">
        <li aria-current="step"><span>1</span>样例与字段</li><li><span>2</span>定位与校准</li><li><span>3</span>测试与发布</li>
      </ol></div>
      <div className="service-start-form">
        <div className="service-sample-input"><label id="service-sample-label">样例材料</label>
          <button type="button" className={`service-sample-drop ${prepared || file ? 'has-file' : ''}`} aria-labelledby="service-sample-label" disabled={busy} onClick={onChoose}
            onDragOver={event => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
            onDrop={event => { event.preventDefault(); event.stopPropagation(); const dropped = event.dataTransfer.files[0]; if (!busy && dropped) onSelect(dropped); }}>
            <span className="service-upload-icon">{prepared || file ? <FileTextOutlined /> : <UploadOutlined />}</span>
            <strong>{prepared?.name || file?.name || '上传或拖入固定版式样例'}</strong>
            <small>{prepared ? `${prepared.pages.length} 页 · ${prepared.engine}` : file ? `${(file.size / 1024 / 1024).toFixed(2)} MB` : 'PDF / PNG / JPEG / WebP · 最大 30 MB'}</small>
            {(prepared || file) && <span className="service-replace-file">更换材料</span>}
          </button>
          {prepared && seedCount > 0 && <div className="service-seed-note"><CheckOutlined />已带入 {seedCount} 个字段及原文位置</div>}
        </div>
        <div className="service-definition">
          <label>服务名称<Input aria-label="解析服务名称" placeholder="例如：转账材料 · 发票解析" value={name} onChange={event => onName(event.target.value)} disabled={busy} maxLength={100} /></label>
          <label>字段要求<Input.TextArea aria-label="服务字段要求" placeholder="例如：提取发票号码、开票日期、购买方名称、销售方名称和价税合计。" value={request} onChange={event => onRequest(event.target.value)} disabled={busy} maxLength={1000} autoSize={{ minRows: 4, maxRows: 7 }} /></label>
        </div>
      </div>
      <div className="service-start-actions">
        <Tooltip title="跳过字段建议，进入编辑器自行添加字段、框选原文位置。"><Button disabled={!ready || busy} onClick={() => onCreate(false)}>直接配置字段</Button></Tooltip>
        <Tooltip title={seedCount ? '沿用当前提取结果中的字段和位置。' : '目前支持常见发票字段建议；其他材料可直接配置字段。'}><Button type="primary" icon={<ArrowRightOutlined />} iconPlacement="end" disabled={!ready} loading={busy} onClick={() => onCreate(true)}>{seedCount ? '带入字段并进入' : '生成字段并进入'}</Button></Tooltip>
      </div>
    </div>
  </section>;
}
