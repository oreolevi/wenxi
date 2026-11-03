import { copyFile, access, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demo = process.argv.includes('--demo');
const live = process.argv.includes('--live');
const destination = path.resolve(root, '..', '文档解析平台交互原型_V3.6.html');
const backup = path.resolve(root, '..', '文档解析平台交互原型_V3.6_原生交互版备份.html');
try { if (!demo && !live) { await access(backup); } } catch {
  try { await access(destination); await copyFile(destination, backup); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
}
const built = path.join(root, demo ? 'dist-demo/index.html' : live ? 'dist-live/index.html' : 'dist/index.html');
const notices = await Promise.all([
  ['React Bits', 'src/components/react-bits/LICENSE.md'],
  ['Manrope', 'src/assets/fonts/Manrope-LICENSE.txt'],
].map(async ([name, file]) => `<!-- ${name} third-party license\n${await readFile(path.join(root, file), 'utf8')}\n-->`));
const notice = notices.join('\n');
const html = await readFile(built, 'utf8');
await writeFile(built, html.replace('</body>', `${notice}\n</body>`));
if (!demo && !live) await copyFile(built, destination);
console.log(demo || live ? '已生成独立线上构建：' + built : '已导出单文件 HTML：' + destination);
