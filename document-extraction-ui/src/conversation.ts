import { documentOutputMode } from './documentIntent.ts';
import { assistantReply, extractMaterial, reviewField } from './model.ts';
import { refersToRequirements } from './requirements.ts';
import type { ExtractedField, Material } from './types.ts';

export interface LocalTurn {
  kind: 'chat' | 'extract' | 'correct';
  materials: Material[];
  reply: string;
  activeId?: string;
  selectedKey?: string;
  page?: number | null;
}

/** Keep greetings and explicit manual corrections local; send document questions to extraction. */
export function runLocalTurn(prompt: string, materials: Material[], activeId: string, selectedKey: string | null, semantic = false): LocalTurn {
  const text = prompt.trim();
  const chat = (reply: string): LocalTurn => ({ kind: 'chat', materials, reply });
  if (/^(?:你好|您好|嗨|hello|hi)[！!。.,，\s]*$/i.test(text)) {
    return chat('你好，可以上传文档并说明需求，也可以先试用示例。');
  }
  if (/^(?:谢谢|感谢|好的|好|明白了|收到)(?:你|您)?[！!。.,，\s]*$/.test(text)) return chat('好的，可以继续补充要求或修改结果。');
  if (/^(?:先)?(?:不要|不用|别|停止)(?:再)?(?:提取|识别|运行)/.test(text)) return chat('好的，先保留当前结果。');
  if (/^(?:请问[，,\s]*)?(?:怎么|如何|你能做什么|你可以做什么|支持什么|有什么功能|能做什么)/.test(text)) {
    return chat('上传文档后，可以说“帮我提取提交人、通讯地址和审核人员”。已有结果也可以用“把提交人改为王明”来修正。');
  }

  if (documentOutputMode(text) === 'fulltext') {
    if (!materials.length || materials.every(file => file.kind === 'spreadsheet')) return chat('请添加需要转换全文的 PDF、图片或 TXT。');
    if (materials.some(file => file.kind === 'demo')) return chat('内置示例用于字段提取；请上传 PDF、图片或 TXT 体验全文转换。');
    if (!materials.some(file => ['pdf', 'image', 'text'].includes(file.kind))) return chat('全文转换支持 PDF、图片或 TXT。Word 请先转为 PDF，ZIP 请解压后上传材料。');
    const next = materials.map(file => file.kind === 'text' ? { ...file, processed: true, fullText: file.text || '', outputMode: 'fulltext' as const, error: undefined } : file);
    return { kind: 'extract', materials: next, reply: '全文转换已完成，可在右侧预览或下载 Markdown。' + (next.some(file => ['word', 'archive'].includes(file.kind)) ? '\nWord 请先转为 PDF，ZIP 请解压后上传材料。' : ''), activeId: next.find(file => file.id === activeId && ['pdf', 'image', 'text'].includes(file.kind))?.id || next.find(file => ['pdf', 'image', 'text'].includes(file.kind))?.id };
  }

  // Only an explicit correction with an exact field name (or the selected field) can change a value.
  const correction = text.match(/^(?:(?:请|帮我|麻烦)\s*)*(?:把|将)?\s*(.+?)\s*(?:改为|改成|修改为|更正为|修正为|调整为|更新为)\s*(.+)$/);
  if (correction) {
    const material = materials.find(item => item.id === activeId) || materials[0];
    const fields = material?.results || [];
    if (!fields.length) return chat('先上传文档并提取字段，再告诉我要修改哪一项。');
    const name = correction[1].trim().replace(/^当前(?:文件|文档)(?:中|里)?的?/, '').replace(/(?:的值|的结果)$/, '');
    const value = correction[2].trim().replace(/[。]$/, '').replace(/^[“"「]|[”"」]$/g, '').trim();
    const selected = /^(?:这个|该)(?:字段|结果)?$/.test(name);
    const candidates = selected ? fields.filter(field => field.key === selectedKey) : fields.filter(field =>
      field.name === name || field.aliases.includes(name));
    if (candidates.length !== 1 || !value || /[？?]$/.test(text)) return chat('请明确要修改的字段，例如“把提交人改为王明”。');
    const field: ExtractedField = candidates[0];
    const next = materials.map(item => item.id === material.id ? { ...item, results: fields.map(item => item.key === field.key ? reviewField(item, value) : item) } : item);
    return { kind: 'correct', materials: next, reply: `已将“${field.name}”修改为“${value}”。`, activeId: material.id, selectedKey: field.key, page: field.page };
  }

  const extraction = (refersToRequirements(text) && /提取|抽取|识别|整理/.test(text))
    || /^(?:(?:请|帮我|帮忙|麻烦|我想|我需要|我要|请你)[\s，,]*)*(?:再|另外|重新|只|仅)?(?:提取|识别|整理|新增|增加|加上|添加|补充|删除|去掉|只保留|只要|不要)/.test(text)
    || /^(?:(?:请|帮我)\s*)*(?:把|将)[^。！？?]{1,24}(?:去掉|删除)/.test(text);
  const semanticRequest = semantic && materials.some(file => ['pdf', 'image'].includes(file.kind)) && (
    /帮我找|找出|查找|读取|抽取/.test(text)
    || /谁|哪家|哪个|哪些|多少|何时|什么时候/.test(text)
    || (/文档|材料|申请|合同|担保|批准|审核|签字/.test(text) && /什么/.test(text))
  );
  if ((extraction || semanticRequest) && (semantic || !/[？?]$/.test(text))) {
    if (!materials.length) return chat('请先添加文档，或选择一份示例材料。');
    if (materials.every(file => file.kind === 'spreadsheet')) return chat('字段表已添加，请再添加需要提取的合同 PDF 或图片。');
    const next = materials.map(material => extractMaterial(material, text));
    const active = next.find(material => material.id === activeId && material.kind !== 'spreadsheet') || next.find(material => material.results?.length) || next.find(material => material.kind !== 'spreadsheet')!;
    return { kind: 'extract', materials: next, reply: assistantReply(next), activeId: active.id };
  }
  return chat(materials.some(material => material.results?.length)
    ? '当前原型支持追加字段和修改结果，例如“再加上注册地址”或“把提交人改为王明”；自由问答尚未接入。'
    : '可以上传文档并描述需要的字段。当前为交互原型，自由问答尚未接入。');
}
