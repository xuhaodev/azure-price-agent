# Docker 部署到 Azure Web App

## 构建 Docker 镜像

```bash
docker build -t azure-price-agent .
```

## 本地测试

```bash
docker run -p 3000:3000 \
  -e AZURE_OPENAI_ENDPOINT="your-endpoint" \
  -e AZURE_OPENAI_API_KEY="your-key" \
  -e AZURE_OPENAI_DEPLOYMENT_NAME="gpt-5-codex" \
  azure-price-agent
```

## 推送到 Azure Container Registry (ACR)

```bash
# 登录 ACR
az acr login --name <your-acr-name>

# 打标签
docker tag azure-price-agent <your-acr-name>.azurecr.io/azure-price-agent:latest

# 推送
docker push <your-acr-name>.azurecr.io/azure-price-agent:latest
```

## 部署到 Azure Web App

```bash
# 创建 Web App（如果不存在）
az webapp create \
  --resource-group <resource-group> \
  --plan <app-service-plan> \
  --name <app-name> \
  --deployment-container-image-name <your-acr-name>.azurecr.io/azure-price-agent:latest

# 配置环境变量
az webapp config appsettings set \
  --resource-group <resource-group> \
  --name <app-name> \
  --settings \
    AZURE_OPENAI_ENDPOINT="your-endpoint" \
    AZURE_OPENAI_API_KEY="your-key" \
    AZURE_OPENAI_DEPLOYMENT_NAME="gpt-5-codex" \
    WEBSITES_PORT=3000

# 重启应用
az webapp restart --resource-group <resource-group> --name <app-name>
```

## 环境变量

需要在 Azure Web App 中配置以下环境变量：

- `AZURE_OPENAI_ENDPOINT`: Azure OpenAI 端点
- `AZURE_OPENAI_API_KEY`: Azure OpenAI API 密钥
- `AZURE_OPENAI_DEPLOYMENT_NAME`: 部署名称（默认: gpt-5-codex）
- `WEBSITES_PORT`: 3000（Azure Web App 需要）
