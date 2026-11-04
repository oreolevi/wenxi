export type Scenario = 'application' | 'contract';
export type FileKind = 'demo' | 'text' | 'image' | 'pdf' | 'word' | 'archive' | 'spreadsheet';
export type ReviewStatus = 'pending' | 'confirmed' | 'corrected' | 'missing' | 'rejected' | 'visual_required';

export interface ProcessingStep {
  id: string; label: string; detail?: string;
  status: 'running' | 'done' | 'error' | 'cancelled';
  startedAt: string; finishedAt?: string;
}
export interface ProcessingTrace {
  id: string; startedAt: string; finishedAt?: string;
  status: 'running' | 'done' | 'partial' | 'failed' | 'cancelled'; steps: ProcessingStep[];
}

export interface SourceEvidence {
  pageIndex: number;
  blockIndex: number;
  bbox: [number, number, number, number];
  text: string;
  ref: string;
  quote?: string;
  source?: 'pdf_text' | 'mineru';
  blockType?: string;
  rowRef?: string;
  originalPageIndex?: number;
  originalBBox?: [number, number, number, number];
  originalPolygon?: number[][];
  confidence?: number;
  recoverySourceRef?: string;
  sealRecognition?: { status: string; engine: string; confidence?: number;
    lines?: Array<{ text: string; confidence: number; polygon: number[][] }> };
}

export interface PreprocessingPolicy {
  orientation: 'auto' | 'off' | '90' | '180' | '270';
  deskew: 'auto' | 'off';
  grouping: 'auto' | 'document' | 'per_page';
}
export interface DocumentPage {
  number: number; width: number; height: number; imageUrl: string;
  originalImageUrl?: string; originalWidth?: number; originalHeight?: number;
  toOriginal?: number[][]; rotation?: number; deskewAngle?: number; needsReview?: boolean;
  steps?: Array<{ tool: string; status: string; label: string; angle?: number }>; elapsedMs?: number;
}
export interface PreprocessingReport {
  version: number; policy: PreprocessingPolicy; elapsedMs: number; pageCount: number; unitCount: number; needsReview: boolean;
}

export interface FullTextArtifact {
  url: string; downloadUrl: string; packageUrl: string; pageCount: number; imageCount: number;
}

export interface ParsedDocument {
  id: string;
  historyId?: string;
  fullText?: FullTextArtifact;
  engine: string;
  tier: 'basic' | 'standard';
  extractor: 'label-match' | 'deepseek';
  model?: string;
  modelCall?: { callId: string; model: string; elapsedMs: number; usage: Record<string, unknown> | null; outcome: string };
  schemaVersion?: number;
  textSources?: { pdfTextPages: number[]; ocrPages: number[] };
  requirements?: RequirementDefinition | null;
  pages: DocumentPage[];
  preprocessing?: PreprocessingReport;
  sealRecognition?: { engine: string; regions: number; recognized: number; elapsedMs: number };
  capabilityPlan?: { schemaVersion: number; base: string; seal?: string; recovery?: string;
    maxRecoveryRounds: number; maxRecoveryFields: number; maxRecoveryRegions: number;
    recoveryRounds: number; recoveryCapability?: string; recoveryFields?: string[]; recoveryRefs?: string[]; recoveryReason?: string };
  units?: Array<{ id: string; label: string; pages: number[]; needsReview: boolean }>;
}

export interface ExtractedField {
  key: string;
  name: string;
  unitId?: string;
  unitLabel?: string;
  value: string;
  raw: string;
  page: number | null;
  ref: string | null;
  aliases: string[];
  note: string;
  sourceKind?: 'seal';
  recoveryRefs?: string[];
  status: ReviewStatus;
  edited?: boolean;
  evidence?: SourceEvidence[];
  kind?: 'text' | 'list' | 'table' | 'judgment' | 'visual';
  validationStatus?: 'passed' | 'partial' | 'rejected' | 'missing' | 'visual_required';
  issues?: Array<{ path: string; code: string; message: string }>;
  items?: SourceFact[];
  table?: { columns: string[]; rows: Array<{ cells: SourceFact[]; status: 'pending' | 'rejected'; issue?: string }> };
  decision?: 'yes' | 'no' | 'uncertain';
  modelCallId?: string;
  requirement?: RequirementField & { fileName: string; sheet: string };
}

export interface RequirementField { name: string; rule: string; cell: string; ruleCell: string | null; group: string }
export interface RequirementDefinition { fileName: string; sheet: string; fields: RequirementField[] }
export interface RequirementWorkbook { fileName: string; sheets: Array<{ sheet: string; fields: RequirementField[] }> }

export interface SourceFact {
  label: string;
  value: string;
  raw: string;
  status: 'pending' | 'missing' | 'rejected';
  evidence: SourceEvidence[];
  issue?: string;
}

export interface Fixture {
  name: string;
  label: string;
  description: string;
  prompt: string;
  pages: number;
  fields: ExtractedField[];
}

export interface Material {
  id: string;
  name: string;
  kind: FileKind;
  size: number;
  scenario?: Scenario;
  url?: string;
  text?: string;
  results: ExtractedField[] | null;
  processed?: boolean;
  sourceFile?: File;
  sourceUrl?: string;
  parsed?: ParsedDocument;
  error?: string;
  taskId?: string;
  outputMode?: 'fields' | 'fulltext' | 'both';
  fullText?: string;
  requirementWorkbook?: RequirementWorkbook;
  requirementSheet?: string;
  requirementLoading?: boolean;
  requirementError?: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  files?: string[];
  resultLink?: boolean;
  processing?: ProcessingTrace;
}

export interface TaskSnapshot {
  files: Material[];
  messages: ChatMessage[];
  draft: string;
  activeId: string;
  selectedKey: string | null;
  page: number;
}
export interface SavedTaskSummary {
  id: string; createdAt: string; updatedAt: string; files: Material[];
}

export const reviewLabels: Record<ReviewStatus, string> = {
  pending: '待核验', confirmed: '已确认', corrected: '已修改', missing: '未找到',
  rejected: '依据待核对', visual_required: '待图像核验',
};
