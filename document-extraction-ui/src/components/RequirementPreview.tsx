import { useState } from 'react';
import { Alert, Button, Modal, Select, Table, Typography } from 'antd';
import { FileExcelOutlined, LoadingOutlined } from '@ant-design/icons';
import type { Material, RequirementField } from '../types.ts';

export function RequirementPreview({ file, busy, onSheet }: { file: Material; busy: boolean; onSheet: (sheet: string) => void }) {
  const [open, setOpen] = useState(false);
  const sheet = file.requirementWorkbook?.sheets.find(sheet => sheet.sheet === file.requirementSheet);
  return <>
    <div className="requirement-summary" role="status">
      {file.requirementLoading ? <LoadingOutlined /> : <FileExcelOutlined />}
      <span>{file.requirementLoading ? '正在读取字段表…' : file.requirementError ? '字段表读取失败' : sheet ? `提取要求 · ${sheet.fields.length} 个字段` : '请选择字段工作表'}</span>
      <Button size="small" type="link" disabled={file.requirementLoading} onClick={() => setOpen(true)}>{sheet ? '查看字段' : '查看要求'}</Button>
    </div>
    <Modal title="Excel 提取要求" open={open} onCancel={() => setOpen(false)} footer={<Button onClick={() => setOpen(false)}>完成</Button>} width={720}>
      <Typography.Paragraph>{file.name}</Typography.Paragraph>
      {file.requirementError ? <Alert type="error" showIcon title={file.requirementError} /> : <>
        <Select aria-label="字段工作表" placeholder="选择本次使用的工作表" value={file.requirementSheet} disabled={busy}
          onChange={onSheet} options={file.requirementWorkbook?.sheets.map(item => ({ value: item.sheet, label: `${item.sheet} · ${item.fields.length}个字段` }))} style={{ minWidth: 240, marginBottom: 16 }} />
        <Table<RequirementField> rowKey="name" size="small" dataSource={sheet?.fields || []} pagination={false} scroll={{ y: 360 }}
          columns={[{ title: '字段', dataIndex: 'name', width: '42%' }, { title: '提取要求', dataIndex: 'rule', render: value => value || '—' }, { title: '来源', dataIndex: 'cell', width: 70 }]} />
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>按这份字段表提取时，请同时添加合同 PDF 或图片。</Typography.Paragraph>
      </>}
    </Modal>
  </>;
}
