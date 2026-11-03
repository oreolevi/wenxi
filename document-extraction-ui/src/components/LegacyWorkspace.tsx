import { useEffect, useMemo, useRef, useState } from 'react';
import original from '../legacy/original.html?raw';
import presentation from '../legacy/presentation.css?raw';
import bridge from '../legacy/bridge.js?raw';
import { useColorMode } from '../theme.tsx';

type Props = { page: string; active: boolean; onNavigate: (page: string) => void };

export function LegacyWorkspace({ page, active, onNavigate }: Props) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [ready, setReady] = useState(false);
  const { mode } = useColorMode();
  const source = useMemo(() => original
    .replace('</head>', `<style>${presentation}</style></head>`)
    .replace("document.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});render();", `${bridge}\ndocument.addEventListener('keydown',e=>{if(e.key==='Escape')closeModal()});render();`), []);

  useEffect(() => {
    const receive = (event: MessageEvent) => {
      if (event.source !== frame.current?.contentWindow || event.data?.source !== 'document-platform-legacy') return;
      if (event.data.type === 'navigate' && typeof event.data.page === 'string') onNavigate(event.data.page);
    };
    window.addEventListener('message', receive);
    return () => window.removeEventListener('message', receive);
  }, [onNavigate]);

  useEffect(() => {
    if (ready) frame.current?.contentWindow?.postMessage({ source: 'document-platform-shell', type: 'theme', mode }, '*');
  }, [ready, mode]);
  useEffect(() => {
    if (ready && active) frame.current?.contentWindow?.postMessage({ source: 'document-platform-shell', type: 'navigate', page }, '*');
  }, [ready, page, active]);

  return <div className="legacy-workspace" hidden={!active}>
    <iframe ref={frame} title="原有功能页面" srcDoc={source} onLoad={() => setReady(true)} />
  </div>;
}
