import type { Material, RequirementDefinition } from './types.ts';

export const refersToRequirements = (prompt: string) => /excel|xlsx|字段表|要求表|字段清单|按[^。！？?]*表[^。！？?]*(?:字段|要求)|附件[^。！？?]*字段/i.test(prompt);

export function selectedRequirements(materials: Material[], prompt: string): RequirementDefinition | undefined {
  if (!refersToRequirements(prompt)) return undefined;
  const workbooks = materials.filter(file => file.kind === 'spreadsheet');
  if (!workbooks.length) throw new Error('请先添加包含字段清单和提取要求的 Excel（.xlsx）。');
  if (workbooks.length !== 1) throw new Error('请只保留本次要使用的一份字段要求表。');
  const file = workbooks[0];
  if (file.requirementLoading) throw new Error('字段表正在读取，请稍候再发送。');
  if (file.requirementError) throw new Error(file.requirementError);
  const sheet = file.requirementWorkbook?.sheets.find(sheet => sheet.sheet === file.requirementSheet);
  if (!sheet) throw new Error('请先在字段要求中选择本次使用的工作表。');
  if (!materials.some(file => ['pdf', 'image'].includes(file.kind))) throw new Error('字段表已读取，请再添加需要提取的合同 PDF 或图片。');
  return { fileName: file.name, sheet: sheet.sheet, fields: sheet.fields };
}
