import { Button, Tabs } from 'antd';
import { AuditOutlined, PlusOutlined, QuestionCircleOutlined } from '@ant-design/icons';
import type { ProfileSummary, SharedScene, PublicationReview } from '../profiles.ts';
import { MyServices } from './MyServices.tsx';
import { SceneLibrary } from './SceneLibrary.tsx';
import { SceneDirectory } from './SceneDirectory.tsx';
import type { SceneSummary } from '../studio.ts';

export type StudioHomeView = 'mine' | 'parsers' | 'library';

export function StudioHelp({ disabled, onGuide }: { disabled?: boolean; onGuide: () => void }) {
  return <Button type="text" className="studio-help" aria-label="Studio 帮助" disabled={disabled} icon={<QuestionCircleOutlined />} onClick={onGuide}>帮助</Button>;
}

export function StudioHome({ view, records, scenes, createKey, onScene, onSceneNew, onChanged, onReference, library, libraryError, reviews, busy, query, filter, onQuery, onFilter, onView, onNew, onOpen, onReuse, onCopy, onShare, onReview }: {
  onReference: (entry: SharedScene, sceneId: string) => void; scenes: SceneSummary[]; createKey: number; onScene: (id: string) => void; onSceneNew: () => void; onChanged: () => void;
  view: StudioHomeView; records: ProfileSummary[]; library: SharedScene[]; libraryError: string; busy: boolean; query: string; filter: string;
  onQuery: (value: string) => void; onFilter: (value: string) => void; onView: (view: StudioHomeView) => void;
  onNew: () => void; onOpen: (id: string) => void; onReuse: (item: SharedScene) => void; onCopy: (text: string) => void;
  reviews: PublicationReview[]; onShare: (item: ProfileSummary) => void; onReview: () => void;
}) {
  return <div className="studio-home-scroll"><div className="platform-page studio-home-page">
    <div className="platform-intro"><h1 tabIndex={-1} data-page-heading>文析 Studio</h1><Button type="primary" icon={<PlusOutlined />} disabled={busy} onClick={view === 'mine' ? onSceneNew : onNew}>{view === 'mine' ? '新建场景' : '新建服务'}</Button></div>
    <Tabs className="studio-directory-tabs" aria-label="场景目录" tabBarExtraContent={<Button type="text" size="small" icon={<AuditOutlined />} disabled={busy} onClick={onReview}>模拟审核{reviews.some(item => item.status === 'pending') ? ` · ${reviews.filter(item => item.status === 'pending').length}` : ''}</Button>} activeKey={view} onChange={key => onView(key as StudioHomeView)} destroyOnHidden items={[
      { key: 'mine', label: <span>我的场景 <small aria-hidden>{scenes.length}</small></span>, disabled: busy, children: <SceneDirectory scenes={scenes} query={query} onQuery={onQuery} onOpen={onScene} createKey={createKey} onChanged={onChanged} /> },
      { key: 'parsers', label: <span>我的服务 <small aria-hidden>{records.length}</small></span>, disabled: busy, children: <MyServices records={records} reviews={reviews} onShare={onShare} query={query} filter={filter} busy={busy} onQuery={onQuery} onFilter={onFilter} onOpen={onOpen} onNew={onNew} /> },
      { key: 'library', label: <span>公共服务库 <small aria-hidden>{library.length}</small></span>, disabled: busy, children: <SceneLibrary entries={library} scenes={scenes} onReference={onReference} error={libraryError} busy={busy} onReuse={onReuse} onMine={() => onView('parsers')} onCopy={onCopy} /> },
    ]} />
  </div></div>;
}
