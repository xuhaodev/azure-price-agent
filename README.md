# Azure Prices Agent

[English](README.md) | [中文](README-cn.md)

Azure Prices Agent is a natural-language driven AI Agent tool for querying Azure cloud service pricing. Through conversational queries, you can easily retrieve prices for Azure services, compare regional pricing, and obtain detailed fields like Meter IDs.

## ✨ Features

- 🤖 **AI Agent Powered**: Uses Azure OpenAI GPT-5-Codex deployment to intelligently interpret intent
- 💬 **Natural Language Queries**: Ask in everyday language—no complex query syntax
- 📊 **Rich Pricing Data**: Displays SKU, region, unit, Meter ID, reservation options, savings plan info, etc.
- 🔄 **Streaming Responses**: See agent execution steps and partial results in real time
- 🎯 **Intelligent Suggestions**: Assistant analyzes results and proposes optimizations or alternatives
- 📥 **Export Data**: Export query results to CSV
- 🔍 **Result Filtering**: Built‑in search/sort to quickly find what you need

## 🚀 Quick Start

### Prerequisites
- Node.js 18+
- Package manager: npm / yarn / pnpm / bun
- Azure OpenAI service instance (with a GPT-5-Codex model deployment)

### Local Development

1. **Clone the repo**
```bash
git clone https://github.com/xuhaodev/azure-price-agent.git
cd azure-price-agent
```
2. **Install dependencies**
```bash
npm install
# or
yarn install
# or
pnpm install
```
3. **Configure environment variables**

Create `.env.local` (or copy from `env.example`):
```bash
cp env.example .env.local
```
Edit `.env.local`:
```env
# Azure OpenAI
AZURE_OPENAI_ENDPOINT=https://your-resource.openai.azure.com/
AZURE_OPENAI_API_KEY=your-azure-openai-api-key
AZURE_OPENAI_DEPLOYMENT_NAME=your-gpt5-codex-deployment-name

# Optional: explicit API version
AZURE_OPENAI_API_VERSION=2024-08-01-preview
```
4. **Start dev server**
```bash
npm run dev
```
Visit http://localhost:3000

## 🌐 Deploy to Azure Static Web Apps

### Option 1: Azure Portal
1. Create Static Web App in Azure Portal
2. Basic settings: Subscription, Resource Group, Name, Plan (Free/Standard), Region
3. Source: GitHub → select repo `azure-price-agent`, branch `main`
4. Build Details:
   - Build Preset: Next.js
   - App location: `/`
   - API location: (leave blank)
   - Output location: `.next` or leave blank for default
5. Configure environment variables after initial deployment (Portal → Configuration → Application settings):

| Name | Value | Description |
|------|-------|-------------|
| `AZURE_OPENAI_ENDPOINT` | `https://your-resource.openai.azure.com/` | Azure OpenAI endpoint |
| `AZURE_OPENAI_API_KEY` | `your-api-key` | API key |
| `AZURE_OPENAI_DEPLOYMENT_NAME` | `your-deployment-name` | GPT-5-Codex deployment name |
| `AZURE_OPENAI_API_VERSION` | `2024-08-01-preview` | (Optional) API version |

Save and redeploy (push a commit or manually rerun workflow).

### Option 2: Azure CLI
```bash
npm install -g @azure/static-web-apps-cli
az login
az staticwebapp create \
  --name azure-prices-agent \
  --resource-group your-resource-group \
  --source https://github.com/xuhaodev/azure-price-agent \
  --location "East Asia" \
  --branch main \
  --app-location "/" \
  --output-location ".next" \
  --login-with-github

az staticwebapp appsettings set \
  --name azure-prices-agent \
  --setting-names \
    AZURE_OPENAI_ENDPOINT="https://your-resource.openai.azure.com/" \
    AZURE_OPENAI_API_KEY="your-api-key" \
    AZURE_OPENAI_DEPLOYMENT_NAME="your-deployment-name" \
    AZURE_OPENAI_API_VERSION="2024-08-01-preview"
```

### Environment Variable Security Best Practices
- Never commit API keys
- Consider Azure Key Vault for production secrets
- Rotate keys regularly
- Use distinct keys per environment (dev / test / prod)

### Verify Deployment
1. Open the deployed URL
2. Try a query: "What is the price of D4s v4 VM in West US 2?"
3. Confirm Agent Activity streams execution steps
4. Ensure pricing data loads correctly

## 🛠️ Tech Stack
- **Framework**: Next.js 15 (React 19)
- **Styling**: TailwindCSS
- **AI**: Azure OpenAI (GPT-5-Codex)
- **Data Source**: Azure Retail Prices API
- **Hosting**: Azure Static Web Apps
- **CI/CD**: GitHub Actions

## 📖 Usage Examples

### Price Queries
```
"Price of Standard D4s v4 VM in West US 2"
"List all D-series VM prices in East Asia"
"Meter ID for M50 Redis Cache in West US 2"
```
### Compare Pricing
```
"Compare D8s v4 prices between East US and West US 2"
"Which US region has the cheapest D16s v4?"
```
### Detailed Info
```
"What reservation options exist for D4s v4?"
"Show savings plan prices for Azure Redis"
```

## 📁 Project Structure
```
azure-price-agent/
├── src/
│   ├── app/              # Next.js app router
│   │   ├── api/
│   │   │   └── prices/   # Pricing API route
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── ChatInterface.tsx
│   │   ├── PriceResults.tsx
│   │   └── QueryFilter.tsx
│   └── lib/
│       ├── agentPrompt.ts
│       ├── azure-regions.ts
│       ├── price-api.ts
│       └── schema.ts
├── public/
├── .github/
└── package.json
```

## 🤝 Contributing
Issues and Pull Requests are welcome!

## 📄 License
MIT License.

## 📚 Resources
- [Next.js Docs](https://nextjs.org/docs)
- [Azure OpenAI Service](https://azure.microsoft.com/products/ai-services/openai-service)
- [Azure Retail Prices API](https://learn.microsoft.com/rest/api/cost-management/retail-prices/azure-retail-prices)
- [Azure Static Web Apps](https://learn.microsoft.com/azure/static-web-apps/)
- [TailwindCSS Docs](https://tailwindcss.com/docs)

---
Need Chinese? View the full Chinese version: [README-cn.md](README-cn.md)
