export interface ReleaseTarget { area: 'fields' | 'test' | 'evaluate' | 'settings' | 'services' | 'api'; templateId?: string; fieldId?: string; bindingId?: string }
export interface ReleaseReport {
  ready: boolean; unchanged: boolean; currentVersion: string; nextVersion: string;
  issues: Array<{ code: string; title: string; detail: string; target: ReleaseTarget }>;
}
