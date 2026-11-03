import {
  ApartmentOutlined, AuditOutlined, BulbOutlined, FileProtectOutlined,
  FileSyncOutlined, FileTextOutlined, LayoutOutlined, PartitionOutlined,
  ReadOutlined, ReconciliationOutlined, ScanOutlined, SolutionOutlined, TableOutlined,
} from '@ant-design/icons';
import './product-icon.css';

// Supplement the Ant Design outline family where a domain-specific symbol is needed.
function DeskewGlyph() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" focusable="false">
    <path d="M3 21h18M4 18v3m16-3v3" opacity=".45" />
    <rect x="7" y="3" width="11" height="14" rx="1.5" transform="rotate(-12 12.5 10)" />
    <path d="m9 7 5.9-1.2m-5.2 4.6 5.9-1.2m-5.2 4.6 3.9-.8" />
  </svg>;
}

function ExtractionServiceGlyph() {
  return <svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="1.65" strokeLinecap="round" strokeLinejoin="round" focusable="false">
    <path d="M18 10V8l-5-5H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h4M13 3v5h5M8 9h2m-2 4h3m-3 4h2" />
    <rect x="14" y="13" width="7" height="3" rx=".7" />
    <rect x="14" y="19" width="7" height="3" rx=".7" opacity=".55" />
  </svg>;
}

const glyphs = {
  orientation: FileSyncOutlined,
  deskew: DeskewGlyph,
  'document-grouping': PartitionOutlined,
  ocr: ScanOutlined,
  'pdf-text': FileTextOutlined,
  layout: TableOutlined,
  semantic: BulbOutlined,
  grounding: FileProtectOutlined,
  seal: AuditOutlined,
  scene: ApartmentOutlined,
  service: ExtractionServiceGlyph,
  template: LayoutOutlined,
  'skill-contract': ReadOutlined,
  'skill-invoice': ReconciliationOutlined,
  'skill-application': SolutionOutlined,
} as const;

export type ProductIconName = keyof typeof glyphs;

/** Decorative icons accompany visible names; controls retain their own accessible labels. */
export function ProductIcon({ name, framed = false, small = false, className = '' }: {
  name: ProductIconName; framed?: boolean; small?: boolean; className?: string;
}) {
  const Glyph = glyphs[name];
  return <span aria-hidden="true" className={`product-icon${framed ? ' product-icon-framed' : ''}${small ? ' product-icon-small' : ''} ${className}`}><Glyph /></span>;
}
