import { ApiOutlined, AppstoreOutlined, AuditOutlined, BarChartOutlined, FileSearchOutlined, HistoryOutlined, ToolOutlined, PartitionOutlined } from '@ant-design/icons';
import { navigationItems } from './navigationModel.ts';
export { navigationGroups, navigationKey, pageTitle, pageGroup } from './navigationModel.ts';
const icons = { extract: <FileSearchOutlined />, profiles: <PartitionOutlined />, history: <HistoryOutlined />, skills: <AppstoreOutlined />,
  components: <ToolOutlined />, evaluation: <AuditOutlined />, dashboard: <BarChartOutlined />, access: <ApiOutlined /> };
export const navigation = navigationItems.map(item => ({ ...item, icon: icons[item.icon] }));
