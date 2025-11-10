# Azure Price Agent

Azure Price Agent 是一个基于自然语言搜索的 Azure 云服务价格查询工具，允许用户使用简单语言查询 Azure 各种服务的价格信息。

## 功能特点

- 使用自然语言查询 Azure 服务价格
- 显示详细的价格数据（SKU、地区、计量单位等）
- 流式响应，快速获取查询结果
- AI 助手提供解释及建议，帮助用户选择合适的 Azure 资源

## 开发环境设置

首先，运行开发服务器:

```bash
npm run dev
# 或
yarn dev
# 或
pnpm dev
# 或
bun dev
```

在浏览器中访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 环境变量配置

在开始使用前，请创建一个 `.env` 文件，并设置以下环境变量：
```
AZURE_OPENAI_ENDPOINT=Azure OpenAI 服务端点
AZURE_OPENAI_API_KEY=Azure OpenAI 服务密钥
AZURE_OPENAI_DEPLOYMENT_NAME=Azure 上部署的 gpt-5-codex 模型名称
```

## 项目架构

该项目使用以下技术栈:

- Next.js 15 - React 框架
- TailwindCSS - UI 样式库
- OpenAI API - 自然语言处理
- Azure OpenAI 服务 - 提供 AI 响应
- Azure Retail Prices API - 获取 Azure 价格数据

## 部署到 Azure Static Web Apps

本项目配置为部署到 Azure Static Web Apps。项目中已包含 GitHub Actions 工作流配置（见 .github/workflows/azure-static-web-apps-wonderful-bush-0a52db800.yml）。

部署步骤:

1. 在 Azure 门户中创建一个新的 Static Web App 资源
2. 将代码推送到 GitHub 仓库
3. 在 Azure Static Web App 创建过程中链接到您的 GitHub 仓库
4. 在 Azure Portal 中配置必要的环境变量

更多关于 Azure Static Web Apps 的部署信息，请参考 [Azure Static Web Apps 文档](https://docs.microsoft.com/azure/static-web-apps/).

## 了解更多

- [Next.js 文档](https://nextjs.org/docs) - 了解 Next.js 功能和 API
- [Azure Retail Prices API](https://docs.microsoft.com/rest/api/cost-management/retail-prices) - Azure 价格 API 文档
- [GitHub 仓库](https://github.com/your-repo) - 项目源代码
