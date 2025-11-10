# Azure Prices Agent

Azure Prices Agent 是一个基于自然语言搜索和 AI Agent 的 Azure 云服务价格查询工具。通过自然语言对话，用户可以轻松查询 Azure 各种服务的价格信息、比较不同地区的定价、获取 Meter ID 等详细信息。

## ✨ 功能特点

- 🤖 **AI Agent 驱动**：使用 Azure OpenAI GPT-5-Codex 模型，智能理解用户意图
- 💬 **自然语言查询**：无需记忆复杂的查询语法，使用日常语言提问即可
- 📊 **详细价格数据**：显示 SKU、地区、计量单位、Meter ID、预留实例、节省计划等完整信息
- 🔄 **流式响应**：实时显示 Agent 执行步骤和查询结果，提供流畅的用户体验
- 🎯 **智能建议**：AI 助手分析查询结果，提供优化建议和替代方案
- 📥 **数据导出**：支持将查询结果导出为 CSV 格式
- 🔍 **结果过滤**：内置搜索和排序功能，快速定位所需信息

## 🚀 快速开始

### 前置要求

- Node.js 18+ 
- npm、yarn、pnpm 或 bun 包管理器
- Azure OpenAI 服务实例（需部署 GPT-5-Codex 模型）

### 本地开发

1. **克隆仓库**
```bash
git clone https://github.com/xuhaodev/azure-price-agent.git
cd azure-price-agent
```

2. **安装依赖**
```bash
npm install
# 或
yarn install
# 或
pnpm install
```

3. **配置环境变量**

在项目根目录创建 `.env.local` 文件（或复制 `env.example`）：

```bash
cp env.example .env.local
```

编辑 `.env.local` 文件，添加以下配置：

```env
# Azure OpenAI 配置
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
AZURE_OPENAI_DEPLOYMENT_NAME=your-gpt5-codex-deployment-name

# 可选：API 版本（默认使用最新版本）
AZURE_OPENAI_API_VERSION=2024-08-01-preview
```

4. **启动开发服务器**
```bash
npm run dev
```

在浏览器中访问 [http://localhost:3000](http://localhost:3000) 查看应用。

## 🌐 部署到 Azure Static Web Apps

### 方式一：通过 Azure Portal 部署

1. **创建 Azure Static Web App**
   - 登录 [Azure Portal](https://portal.azure.com)
   - 点击 "Create a resource" > 搜索 "Static Web Apps"
   - 点击 "Create"

2. **基本配置**
   - **Subscription**: 选择你的订阅
   - **Resource Group**: 创建新的或选择现有的资源组
   - **Name**: 输入应用名称（例如：azure-prices-agent）
   - **Plan type**: 选择 "Free" 或 "Standard"
   - **Region**: 选择离你最近的区域

3. **部署详情**
   - **Source**: 选择 "GitHub"
   - **Organization**: 选择你的 GitHub 账户
   - **Repository**: 选择 `azure-price-agent` 仓库
   - **Branch**: 选择 `main` 分支

4. **构建详情**
   - **Build Presets**: 选择 "Next.js"
   - **App location**: `/` （根目录）
   - **Api location**: 留空
   - **Output location**: `.next` 或留空（使用默认值）

5. **配置环境变量**
   
   部署完成后，在 Azure Portal 中配置环境变量：
   
   a. 进入你创建的 Static Web App 资源
   
   b. 在左侧菜单中选择 **"Configuration"**
   
   c. 点击 **"Application settings"** 标签
   
   d. 点击 **"+ Add"** 按钮，添加以下环境变量：
   
   | Name | Value | 说明 |
   |------|-------|------|
   | `AZURE_OPENAI_ENDPOINT` | `https://your-resource.openai.azure.com/` | Azure OpenAI 服务端点 |
   | `AZURE_OPENAI_API_KEY` | `your-api-key` | Azure OpenAI API 密钥 |
   | `AZURE_OPENAI_DEPLOYMENT_NAME` | `your-deployment-name` | GPT-5-Codex 部署名称 |
   | `AZURE_OPENAI_API_VERSION` | `2024-08-01-preview` | API 版本（可选） |
   
   e. 点击 **"Save"** 保存配置
   
   f. 环境变量会在下次部署时生效

6. **触发重新部署**
   
   如果已经部署但环境变量未生效，可以通过以下方式触发重新部署：
   - 推送新的提交到 GitHub 仓库
   - 或在 GitHub Actions 中手动触发工作流

### 方式二：通过 Azure CLI 部署

```bash
# 安装 Azure Static Web Apps CLI
npm install -g @azure/static-web-apps-cli

# 登录 Azure
az login

# 创建 Static Web App
az staticwebapp create \
  --name azure-prices-agent \
  --resource-group your-resource-group \
  --source https://github.com/xuhaodev/azure-price-agent \
  --location "East Asia" \
  --branch main \
  --app-location "/" \
  --output-location ".next" \
  --login-with-github

# 设置环境变量
az staticwebapp appsettings set \
  --name azure-prices-agent \
  --setting-names \
    AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/" \
    AZURE_OPENAI_API_KEY="your-api-key" \
    AZURE_OPENAI_DEPLOYMENT_NAME="your-deployment-name" \
    AZURE_OPENAI_API_VERSION="2024-08-01-preview"
```

### 环境变量安全最佳实践

⚠️ **重要提示**：
- 永远不要将 API 密钥提交到 Git 仓库
- 使用 Azure Key Vault 存储敏感信息（生产环境推荐）
- 定期轮换 API 密钥
- 为不同环境（开发、测试、生产）使用不同的密钥

### 验证部署

部署完成后：
1. 访问 Azure Portal 中显示的应用 URL
2. 测试查询功能，例如："West US 2 地区的 D4s v4 虚拟机价格是多少？"
3. 检查 Agent Activity 是否正常显示执行步骤
4. 确认价格数据能够正确加载和显示

## 🛠️ 技术栈

- **前端框架**: Next.js 15 (React 19)
- **样式**: TailwindCSS
- **AI 服务**: Azure OpenAI (GPT-5-Codex)
- **数据源**: Azure Retail Prices API
- **部署**: Azure Static Web Apps
- **CI/CD**: GitHub Actions

## 📖 使用示例

### 查询价格
```
"West US 2 地区的 Standard D4s v4 虚拟机的价格是多少？"
"查询东亚地区所有 D 系列虚拟机的价格"
"M50 Redis 缓存在 West US 2 的 meter id 是什么？"
```

### 比较价格
```
"比较 East US 和 West US 2 地区 D8s v4 的价格"
"哪个美国地区的 D16s v4 最便宜？"
```

### 获取详细信息
```
"D4s v4 有哪些预留实例选项？"
"显示 Azure Redis 的节省计划价格"
```

## 📁 项目结构

```
azure-price-agent/
├── src/
│   ├── app/              # Next.js 应用路由
│   │   ├── api/          # API 路由
│   │   │   └── prices/   # 价格查询 API
│   │   ├── globals.css   # 全局样式
│   │   ├── layout.tsx    # 根布局
│   │   └── page.tsx      # 首页
│   ├── components/       # React 组件
│   │   ├── ChatInterface.tsx   # 聊天界面
│   │   ├── PriceResults.tsx    # 价格结果表格
│   │   └── QueryFilter.tsx     # 查询过滤器
│   └── lib/             # 工具库
│       ├── agentPrompt.ts      # Agent 提示词
│       ├── azure-regions.ts    # Azure 地区映射
│       ├── price-api.ts        # 价格 API 客户端
│       └── schema.ts           # 数据模型
├── public/              # 静态资源
├── .github/             # GitHub Actions 工作流
└── package.json         # 项目配置
```

## 🤝 贡献

欢迎提交 Issues 和 Pull Requests！

## 📄 许可证

本项目采用 MIT 许可证。

## 📚 相关资源

- [Next.js 文档](https://nextjs.org/docs) - 了解 Next.js 功能和 API
- [Azure OpenAI 服务](https://azure.microsoft.com/products/ai-services/openai-service) - Azure OpenAI 服务文档
- [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices) - Azure 价格 API 文档
- [Azure Static Web Apps 文档](https://learn.microsoft.com/azure/static-web-apps/) - 部署和配置指南
- [TailwindCSS 文档](https://tailwindcss.com/docs) - CSS 框架文档
