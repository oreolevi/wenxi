import type { ExtractedField, SourceEvidence, SourceFact } from '../types.ts';

export function StructuredValue({ field, onEvidence }: { field: ExtractedField; onEvidence: (evidence: SourceEvidence[]) => void }) {
  const fact = (item: SourceFact, label: string) => <button type="button" className={`fact-value is-${item.status}`}
    aria-label={`定位 ${field.name} ${label} 原文`} disabled={!item.evidence.length}
    title={item.issue || '查看这段内容的原文'} onClick={() => onEvidence(item.evidence)}>
    {item.value || (item.status === 'rejected' ? '待核对' : '未列明')}
  </button>;
  const content = field.table ? <div className="field-table-scroll"><table className="field-table" aria-label={`${field.name}明细`}>
    <thead><tr>{field.table.columns.map(column => <th key={column}>{column}</th>)}</tr></thead>
    <tbody>{field.table.rows.map((row, index) => <tr key={index} className={row.status === 'rejected' ? 'row-needs-review' : ''} title={row.issue}>
      {row.cells.map((cell, column) => <td key={column}>{fact(cell, `第${index + 1}行 ${field.table!.columns[column]}`)}</td>)}
    </tr>)}</tbody>
  </table></div> : <ol className="field-fragments">{(field.items || []).map((item, index) => <li key={index}>
    {item.label && <span className="fragment-label">{item.label}</span>}{fact(item, `第${index + 1}段`)}
  </li>)}</ol>;
  if (field.edited) return <div className="structured-value"><div className="field-value">{field.value}</div>
    <details><summary>机器原始明细与依据</summary>{content}</details></div>;
  return <div className="structured-value">{field.kind === 'judgment' && <div className="judgment-value">
    <span>模型判断 · 待人工核验</span><strong>{field.value || '判断待核对'}</strong></div>}{content}</div>;
}
