# Azure Price Agent 优化总结

## 优化目标
- 降低 token 消耗
- 增强 agent planning 显性化
- 加强反思和验证机制
- 提高回复准确性

## 优化成果

### 1. agentPrompt.ts - Token 减少约 60%

**优化前:** ~4000 tokens
**优化后:** ~1600 tokens

**关键改进:**
- ✅ **显性化三步工作流**: STEP 1 (内部规划) → STEP 2 (立即执行) → STEP 3 (分析响应)
- ✅ **强制规划静默**: 明确规划是内部过程,不输出给用户
- ✅ **验证机制**: 在 STEP 3 添加验证步骤,确保数据完整性
- ✅ **删除冗余示例**: 移除重复的正确/错误示例
- ✅ **精简描述**: 合并相似规则,使用更简洁的语言
- ✅ **反思文档化**: 要求在最终输出中记录假设和限制

**新增核心指令:**
```
STEP 1: SILENT PLANNING (Internal reasoning - NO user output)
- Identify: What resources/regions/SKUs to compare?
- Expand: "US regions" = 9 regions
- Map: Use context to convert names
- Plan: List ALL odata_query calls needed

STEP 2: IMMEDIATE EXECUTION (First action - NO text before)
- Call ALL odata_query functions in parallel
- NO announcements - just execute
- Continue until 100% data collected

STEP 3: ANALYSIS & RESPONSE (Only after complete data)
- Validate: Check all results match expectations
- Compare: Build complete comparison table
- Recommend: Present best option with justification
- Reflect: Document assumptions, note limitations
```

### 2. azure-regions.ts - Token 减少约 70%

**优化前:** ~1500 tokens (56 个区域完整对象)
**优化后:** ~450 tokens (21 个常用区域压缩格式)

**关键改进:**
- ✅ **精简区域列表**: 仅保留 21 个最常用区域
- ✅ **压缩存储格式**: `"code|display"` 替代 JSON 对象
- ✅ **懒加载解析**: 使用 Proxy 按需解析,不占用初始 token
- ✅ **向后兼容**: API 保持不变,透明升级

**新格式示例:**
```typescript
const regionMap = `eastus|East US
westus2|West US 2
westeurope|West Europe`;
```

### 3. azurevmsize.ts - Token 减少约 75%

**优化前:** ~2000 tokens (详细描述对象)
**优化后:** ~500 tokens (精简对象)

**关键改进:**
- ✅ **删除冗余字段**: 移除 `Purpose`, `Description` 字段
- ✅ **简化键名**: `VM_Type` → `type`, `Series_Family` → `family`
- ✅ **保留核心信息**: 类型、家族、关键词、示例

**对比:**
```typescript
// 优化前
{
  "VM_Type": "General Purpose",
  "Series_Family": "D-family",
  "Purpose": "Enterprise-grade applications...",
  "Description": "High CPU-to-memory ratio...",
  "armSkuName_Example": "Standard_D2_v5",
  "Keywords": "enterprise, relational databases..."
}

// 优化后
{
  type: "General",
  family: "D",
  keywords: "enterprise, databases, caching",
  example: "Standard_D2_v5"
}
```

### 4. price-api.ts - 上下文传递优化

**优化前:** 传递完整 JSON 对象
```typescript
text: `Azure region mapping: ${JSON.stringify(azureRegions)}`
text: `Azure virtual machine size context: ${JSON.stringify(azureVmSize)}`
```

**优化后:** 压缩格式单行传递
```typescript
text: `Region codes: eastus:East US|westus2:West US 2|...
VM families: D[General]:enterprise,databases|F[Compute]:high CPU|...`
```

**Token 节省:** 约 2000 tokens/请求

## 总体效果

| 组件 | 优化前 | 优化后 | 节省 |
|------|--------|--------|------|
| agentPrompt.ts | ~4000 | ~1600 | 60% |
| azure-regions.ts | ~1500 | ~450 | 70% |
| azurevmsize.ts | ~2000 | ~500 | 75% |
| 上下文传递 | ~3500 | ~1500 | 57% |
| **总计** | **~11000** | **~4050** | **63%** |

## Planning & Reflection 增强

### 1. 显性化规划流程
- **前置规划**: 明确要求内部规划所有查询
- **执行分离**: 规划不输出,执行为首个行动
- **验证步骤**: 分析前验证数据完整性

### 2. 反思机制
- **假设记录**: 要求记录所有合理假设
- **限制说明**: 主动指出建议的局限性
- **验证提示**: 提醒用户在 Azure Portal 确认

### 3. 质量保证
- **禁止占位符**: 明确禁止 "Pending data" 等不完整输出
- **完整性检查**: 确保所有对比项都有数据
- **渐进式匹配**: 查询失败时自动放宽条件重试(最多3次)

## 使用建议

### 对于开发者
1. **监控 token 使用**: 新结构应显著降低每次请求的 token 消耗
2. **观察规划质量**: Agent 应在执行前完成内部规划,不再输出 "I will query..."
3. **验证准确性**: 检查最终输出是否包含假设说明和限制

### 对于用户
1. **更快响应**: Token 减少意味着更低延迟
2. **完整对比**: 不会再看到部分数据的对比表
3. **透明假设**: AI 会明确说明其推理假设

## 后续优化方向

1. **动态上下文加载**: 根据查询类型仅加载相关区域/VM 类型
2. **缓存常见查询**: 缓存热门 SKU 的价格数据
3. **分级推理**: 简单查询使用 low reasoning_effort
4. **知识库提炼**: 将常见推荐模式编码为规则,减少实时推理

## 测试建议

### 功能测试
```bash
# 测试区域映射
curl -X POST http://localhost:3000/api/prices \
  -H "Content-Type: application/json" \
  -d '{"query": "What is the cheapest D8s v4 in US regions?"}'

# 测试 VM 类型识别
curl -X POST http://localhost:3000/api/prices \
  -H "Content-Type: application/json" \
  -d '{"query": "I need a compute-optimized VM for batch processing"}'
```

### 性能测试
- 对比优化前后的 token 使用量
- 测量首次响应时间 (TTFR)
- 验证并行查询执行

### 质量测试
- 检查是否还有 "I will query..." 输出
- 验证对比表完整性
- 确认假设说明存在

## 风险评估

### 低风险
- ✅ API 向后兼容
- ✅ 核心逻辑未变
- ✅ 编译通过无错误

### 需要验证
- ⚠️ 压缩上下文是否影响 agent 理解
- ⚠️ 精简区域列表是否覆盖常见需求
- ⚠️ 新的规划流程是否被正确执行

## 回滚方案

所有原始文件已通过 Git 版本控制保存。如需回滚:
```bash
git checkout HEAD~1 src/lib/agentPrompt.ts
git checkout HEAD~1 src/lib/azure-regions.ts
git checkout HEAD~1 src/lib/azurevmsize.ts
git checkout HEAD~1 src/lib/price-api.ts
```

---

**优化完成日期**: 2025-11-10
**优化人员**: AI Assistant
**下次审查**: 运行一周后评估效果
