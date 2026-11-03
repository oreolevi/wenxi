export const navigationGroups = ['工作空间', '能力中心', '运营管理'] as const;
export const navigationItems = [
  { key: 'business', label: '文析', group: '工作空间', icon: 'extract' },
  { key: 'profiles', label: '文析 Studio', group: '工作空间', icon: 'profiles' },
  { key: 'history', label: '历史记录', group: '工作空间', icon: 'history' },
  { key: 'skills', label: 'Skill 库', group: '能力中心', icon: 'skills' },
  { key: 'components', label: '能力组件', group: '能力中心', icon: 'components' },
  { key: 'operations', label: '运行看板', group: '运营管理', icon: 'dashboard' },
  { key: 'resources', label: '应用接入', group: '运营管理', icon: 'access' },
] as const;
export type PlatformPage = typeof navigationItems[number]['key'];
const aliases: Record<string, PlatformPage> = {
  scenes: 'business', overview: 'business', sceneDetail: 'business', batch: 'history', review: 'history',
  develop: 'skills', tools: 'components', evaluation: 'profiles', evaluations: 'profiles', release: 'profiles', services: 'resources',
};
export function navigationKey(page: string): PlatformPage {
  return navigationItems.some(item => item.key === page) ? page as PlatformPage : aliases[page] || 'business';
}
export function pageTitle(page: string) { return navigationItems.find(item => item.key === navigationKey(page))!.label; }
export function pageGroup(page: string) { return navigationItems.find(item => item.key === navigationKey(page))!.group; }
export function pageFromSearch(search: string) { return navigationKey(new URLSearchParams(search).get('page') || 'business'); }
