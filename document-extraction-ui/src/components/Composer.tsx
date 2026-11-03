import { useEffect, useRef } from 'react';
import { FileCard, Sender } from '@ant-design/x';
import { BorderBeam } from 'border-beam';
import type { SenderRef } from '@ant-design/x/es/sender';
import { Button, Tooltip } from 'antd';
import { ArrowUpOutlined, CloseOutlined, LockOutlined, PaperClipOutlined, StopOutlined } from '@ant-design/icons';
import { fileAccept } from '../model.ts';
import { useColorMode } from '../theme.tsx';
import { localServicePage } from '../service.ts';
import { CLOUD_MODE, DEMO_MODE } from '../demoMode.ts';
import { RequirementPreview } from './RequirementPreview.tsx';
import type { ExtractionTask } from '../useExtractionTask.ts';

export function Composer({ task, compact = false, onSend, focusToken = 0 }: { task: ExtractionTask; compact?: boolean; onSend?: () => void; focusToken?: number }) {
  const { mode } = useColorMode();
  const fileInput = useRef<HTMLInputElement>(null);
  const sender = useRef<SenderRef>(null);
  useEffect(() => { if (focusToken) sender.current?.focus({ cursor: 'end', preventScroll: true }); }, [focusToken]);
  const canSend = !!task.draft.trim() && !task.files.some(file => file.requirementLoading);
  const requirementFiles = task.files.filter(file => file.kind === 'spreadsheet');

  return <div className={`composer-wrap ${compact ? 'compact' : ''}`}>
    <input ref={fileInput} type="file" accept={fileAccept} multiple hidden disabled={task.busy} onChange={event => {
      const files = Array.from(event.currentTarget.files || []);
      event.currentTarget.value = '';
      if (files.length) void task.addFiles(files);
    }} />
    {!!task.files.length && <div className="composer-attachments" aria-label="已添加的附件">
      <div className="composer-attachment-row" role="list">{task.files.map(file => <div className="composer-attachment-item" role="listitem" key={file.id}>
        <FileCard className="composer-attachment-card" type="file" name={file.name} title={file.name} byte={file.size} description={false}
          icon={file.kind === 'spreadsheet' ? 'excel' : file.kind === 'image' ? 'image' : file.kind === 'archive' ? 'zip' : file.kind === 'word' ? 'word' : file.kind === 'text' ? 'default' : 'pdf'}
          classNames={{ file: 'composer-attachment-file', icon: 'composer-attachment-icon', name: 'composer-attachment-name' }} />
        <Button className="composer-attachment-remove" type="text" size="small" shape="circle" icon={<CloseOutlined />} disabled={task.busy}
          aria-label={`移除附件 ${file.name}`} onClick={() => task.removeFile(file.id)} />
      </div>)}</div>
    </div>}
    <BorderBeam className="composer-beam" size="md" colorVariant="colorful" theme={mode}
      strength={0.7} duration={1.96} borderRadius={compact ? 12 : 16}>
    <Sender
      ref={sender}
      className="task-sender"
      value={task.draft}
      onChange={task.setDraft}
      onSubmit={() => { if (canSend && !task.busy) { onSend?.(); void task.send(); } }}
      onCancel={task.stop}
      onPasteFile={files => void task.addFiles(Array.from(files))}
      loading={task.busy}
      readOnly={task.busy}
      submitType="enter"
      autoSize={{ minRows: compact ? 1 : 2, maxRows: compact ? 4 : 6 }}
      placeholder={compact ? '补充要求，或告诉我需要修改什么…' : requirementFiles.length ? '例如：帮我按照 Excel 中的字段和要求，提取这份合同的内容，并展示原文依据。' : '上传文档，或直接描述你的需求。\n例如：帮我提取这份申请表中的提交人、通讯地址和最终审核人员，整理成表格。'}
      suffix={false}
      footer={(_, { components: { SendButton, LoadingButton } }) => <div className="sender-footer">
        <Tooltip title={compact ? '添加附件' : undefined}><Button type="text" icon={<PaperClipOutlined />} aria-label="添加附件" disabled={task.busy}
          onClick={() => fileInput.current?.click()}>{!compact && '添加附件'}</Button></Tooltip>
        <div className="sender-footer-right">
          {task.busy
            ? <Tooltip title="停止"><LoadingButton aria-label="停止回复" shape="circle" icon={<StopOutlined />} /></Tooltip>
            : <Tooltip title="发送"><SendButton disabled={!canSend} aria-label="发送" shape="circle" icon={<ArrowUpOutlined />} /></Tooltip>}
        </div>
      </div>}
    />
    </BorderBeam>
    {requirementFiles.map(file => <RequirementPreview key={file.id} file={file} busy={task.busy} onSheet={sheet => task.selectRequirementSheet(file.id, sheet)} />)}
    {!compact && <div className="composer-meta"><span><LockOutlined /> {DEMO_MODE ? '附件留在浏览器 · 结果使用虚构示例' : CLOUD_MODE ? '附件交由 MinerU 解析，识别文本发送至 DeepSeek' : localServicePage() ? task.serviceInfo?.semantic ? '识别文本与字段要求发送至 DeepSeek' : '附件仅在本机处理' : '附件仅在当前浏览器中使用'}</span><span>PDF / 图片 / Excel / Word / TXT / ZIP</span></div>}
  </div>;
}
