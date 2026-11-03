import welcome from '../../../docs/README.md?raw';
import choose from '../../../docs/getting-started/choose.md?raw';
import scope from '../../../docs/getting-started/scope.md?raw';
import extraction from '../../../docs/business/extraction.md?raw';
import excel from '../../../docs/business/excel.md?raw';
import review from '../../../docs/business/review.md?raw';
import quickstart from '../../../docs/studio/quickstart.md?raw';
import requirements from '../../../docs/studio/requirements.md?raw';
import services from '../../../docs/studio/services.md?raw';
import testing from '../../../docs/studio/testing.md?raw';
import scenes from '../../../docs/studio/scenes.md?raw';
import api from '../../../docs/studio/api.md?raw';
import faq from '../../../docs/studio/faq.md?raw';
import { parseHelpMarkdown, type HelpArticle, type HelpGroup } from './model.ts';

const article = (id: string, path: string, group: HelpGroup, description: string, markdown: string): HelpArticle => ({
  id, path, group, description, markdown, title: markdown.match(/^# (.+)/m)?.[1] || id,
  blocks: parseHelpMarkdown(markdown).filter(block => block.type !== 'heading' || block.level !== 1),
});
export const helpArticles: HelpArticle[] = [
  article('welcome', 'README.md', '入门指南', '文档解析与提取服务开发平台。', welcome),
  article('choose', 'getting-started/choose.md', '入门指南', '使用方式与服务、版式、样例和场景的关系。', choose),
  article('scope', 'getting-started/scope.md', '入门指南', '文件格式、容量限制与功能边界。', scope),
  article('extraction', 'business/extraction.md', '文析', '材料上传、提取要求与处理进度。', extraction),
  article('excel', 'business/excel.md', '文析', '字段表格式、工作表选择与要求检查。', excel),
  article('review', 'business/review.md', '文析', '原文定位、人工核验、结果导出与历史记录。', review),
  article('quickstart', 'studio/quickstart.md', '文析 Studio', '需求准备、服务开发、场景联调与接口接入。', quickstart),
  article('requirements', 'studio/requirements.md', '文析 Studio', '字段定义、版式样例与验收要求。', requirements),
  article('services', 'studio/services.md', '文析 Studio', '版式管理、规则生成与字段校准。', services),
  article('testing', 'studio/testing.md', '文析 Studio', '单份测试、批量回放与固定版本发布。', testing),
  article('scenes', 'studio/scenes.md', '文析 Studio', '服务引用、材料约束与整包联调。', scenes),
  article('api', 'studio/api.md', '文析 Studio', '接口调用、异常处理与版本维护。', api),
  article('faq', 'studio/faq.md', '参考', '配置、发布与运行问题。', faq),
];
