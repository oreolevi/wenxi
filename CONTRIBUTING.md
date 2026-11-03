# 贡献说明

## 开始开发

阅读 [项目 README](README.md)，选择纯前端演示、本机完整版本或云端 API 模式。环境变量使用空白示例文件初始化，不使用其他人的密钥。

```sh
git switch main
git pull --ff-only
git switch -c feature/your-change
```

## 提交要求

- 一次 Pull Request 处理一个明确问题，说明可观察的行为变化。
- 数据格式和接口变化说明兼容方式，保留已发布服务版本的行为。
- 使用生成的虚构材料或仓库自带样例验证，截图不得包含真实业务数据。
- 运行与变更相关的检查；说明未验证的边界和原因。

前端检查：

```sh
cd document-extraction-ui
npm ci
npm test
npm run build:live
npm run build:demo
```

后端检查（从仓库根目录执行）：

```sh
node --test mineru-local/deepseek/client.test.mjs
.runtime/mineru-venv/bin/python -m unittest discover -s mineru-local -t mineru-local -p 'test_*.py'
```

默认测试不下载模型、不访问真实识别接口、不调用付费模型。真实接口验收单独进行，在 Pull Request 中记录使用的虚构材料及结论。

## 文件边界

不提交以下内容：

- `.env.local`、服务端密钥、登录密码和证书。
- `.runtime/`、模型权重、数据库、缓存、上传材料及处理结果。
- `node_modules/`、构建产物、生成报告和本机截图。
- 银行样本、客户信息或真实业务附件。

仓库仅允许 `mineru-local/testdata/` 下的两份指定虚构 PDF 作为二进制材料样例。新增样例优先提交生成脚本，不提交实际业务文档。

## 评审与发布

提交前检查 `git diff --cached --stat` 和文件内容。通过 Pull Request 协作，评审和自动检查完成后合并。提交、合并不会自动更新线上站点，发布由维护者按部署文档操作。

服务、场景、历史和权限数据不随 Git 同步。需要迁移时，在 Issue 中说明目标环境和范围，单独评审迁移方式。

项目按私有协作方式维护。新增第三方代码、字体、图标或模型时保留来源与许可证；对外分发的整体授权方式由维护者确定。
