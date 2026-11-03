import { useEffect, useRef, useState } from 'react';
import { Button, Tooltip } from 'antd';
import { CheckOutlined, LoadingOutlined, ReloadOutlined } from '@ant-design/icons';
import { DraftSaveQueue } from '../draftSaveQueue.ts';

export function useDraftAutosave<T extends { id: string }, R extends { draft: T }>(options: {
  draft: T | null | undefined; saved: R | null | undefined; active: boolean; paused?: boolean;
  write: (value: T) => Promise<R>; onSaved: (result: R, submitted: T) => void;
  validate?: (value: T) => string | undefined;
}) {
  const current = useRef(options); current.current = options;
  const mounted = useRef(true);
  const [, redraw] = useState(0);
  const [failure, setFailure] = useState<{ signature: string; message: string }>();
  const queue = useRef<DraftSaveQueue<T, R> | null>(null);
  if (!queue.current) queue.current = new DraftSaveQueue(
    value => current.current.write(value),
    (result, submitted) => { if (mounted.current) current.current.onSaved(result, submitted); },
    () => { if (mounted.current) redraw(value => value + 1); },
  );
  const signature = JSON.stringify(options.draft);
  const savedSignature = JSON.stringify(options.saved?.draft);
  const dirty = !!options.draft && signature !== savedSignature;
  const invalid = options.draft ? options.validate?.(options.draft) : undefined;
  const error = failure && failure.signature === signature ? failure.message : '';
  const pending = queue.current.pending > 0;

  async function flush(value = current.current.draft): Promise<R> {
    if (!value) throw new Error('请等待草稿加载');
    const issue = current.current.validate?.(value);
    if (issue) throw new Error(issue);
    const key = JSON.stringify(value);
    if (!queue.current!.pending && key === JSON.stringify(current.current.saved?.draft)) return current.current.saved!;
    try {
      const result = await queue.current!.save(value);
      if (mounted.current) setFailure(old => old?.signature === key ? undefined : old);
      return result;
    } catch (e) {
      if (mounted.current) setFailure({ signature: key, message: e instanceof Error ? e.message : '保存失败，请重试' });
      throw e;
    }
  }
  const flushRef = useRef(flush); flushRef.current = flush;
  useEffect(() => {
    if (!options.active || options.paused || !dirty || invalid || error) return;
    const timer = setTimeout(() => { void flushRef.current().catch(() => {}); }, 900);
    return () => clearTimeout(timer);
  }, [signature, savedSignature, options.active, options.paused, dirty, invalid, error]);
  // Changing the main navigation should also persist the last edits before hiding the editor.
  const wasActive = useRef(options.active);
  useEffect(() => {
    if (wasActive.current && !options.active && dirty && !invalid && !error) void flushRef.current().catch(() => {});
    wasActive.current = options.active;
  }, [options.active, dirty, invalid, error]);
  useEffect(() => {
    if (!dirty && !pending) return;
    const preventLoss = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', preventLoss);
    return () => window.removeEventListener('beforeunload', preventLoss);
  }, [dirty, pending]);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      const { draft, saved, validate } = current.current;
      if (draft && JSON.stringify(draft) !== JSON.stringify(saved?.draft) && !validate?.(draft)) void flushRef.current(draft).catch(() => {});
    };
  }, []);
  return { flush, pending, dirty, invalid, error };
}

export function DraftSaveStatus({ save, disabled }: { save: { pending: boolean; dirty: boolean; invalid?: string; error: string; flush: () => Promise<unknown> }; disabled?: boolean }) {
  const label = save.pending ? '保存中…' : save.error ? '保存失败，重试' : save.invalid ? '待完善' : save.dirty ? '待保存' : '已保存';
  return <Tooltip title={save.error || save.invalid || '草稿自动保存；发布后才更新接口版本'}>
    <span className={`studio-save-status${save.error ? ' has-error' : ''}`} role="status" aria-live="polite">
      <Button type="text" size="small" aria-label="立即保存草稿" disabled={disabled || save.pending || !save.dirty || !!save.invalid} icon={save.pending ? <LoadingOutlined /> : save.error ? <ReloadOutlined /> : !save.dirty ? <CheckOutlined /> : undefined} onClick={() => { void save.flush().catch(() => {}); }}>{label}</Button>
    </span>
  </Tooltip>;
}
