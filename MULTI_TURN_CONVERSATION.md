# 多轮对话功能实现说明

## 功能概述

已成功实现多轮对话功能，支持基于会话上下文的连续交互。

## 核心实现

### 1. 会话上下文管理 (Session Context)

- **状态维护**: `ChatInterface` 组件维护 `sessionResponseId` 状态
- **上下文传递**: 每次 API 调用都会传递 `previous_response_id` 参数
- **会话延续**: Azure OpenAI Responses API 使用 `previous_response_id` 维护对话历史

### 2. 价格查询结果保持 (Price Results Persistence)

- **智能更新**: 只有在 agent 调用 `price_query_tool` 时才更新结果表
- **上下文保持**: 如果 agent 没有查询价格（仅回答问题），结果表保持不变
- **追加模式**: 多次查询的结果会追加显示，而不是替换

### 3. 会话清除 (Session Clear)

- **Clear 按钮**: 用户可以点击 "Clear" 按钮清除会话
- **状态重置**: 清除操作会重置：
  - 聊天消息历史
  - 会话 response_id
  - 价格查询结果
  - 执行步骤

## 工作流程

```
用户输入 Query 1 (关于价格)
  ↓
Agent 查询价格 → 返回结果 + response_id_1
  ↓
用户输入 Query 2 (追问)
  ↓
传递 previous_response_id = response_id_1
  ↓
Agent 基于上下文回答 (不调用 tool)
  ↓
价格结果表保持 Query 1 的数据
  ↓
用户输入 Query 3 (新的价格查询)
  ↓
传递 previous_response_id = response_id_2
  ↓
Agent 查询新价格 → 追加到结果表 + response_id_3
```

## 代码修改

### 1. ChatInterface.tsx
- 添加 `sessionResponseId` 状态
- 修改 API 调用传递 `previous_response_id`
- 处理 SSE 消息中的 `response_id` 类型
- 移除自动清空结果表的逻辑
- 更新 `handleClearChat` 重置会话状态

### 2. route.ts (API)
- 接收 `previous_response_id` 参数
- 传递给 `queryPricingWithStreamingResponse`

### 3. price-api.ts
- `executePricingWorkflow` 接收 `previousResponseId` 参数
- 在创建 Response 时传递 `previous_response_id`
- 返回 `responseId` 供下一轮使用
- 在 SSE 流中发送 `response_id` 给客户端

### 4. page.tsx
- `handleResults` 支持 `append` 参数
- 根据 `append` 决定是追加还是替换结果

## 使用场景

### 场景 1: 连续追问
```
用户: "US 地区最便宜的 D8s v4 在哪里？"
Agent: [查询价格] → 显示结果表
用户: "那 D16s v4 呢？"
Agent: [查询价格] → 追加到结果表
用户: "对比一下这两个的价格差异"
Agent: [不查询] → 基于现有结果表分析回答
```

### 场景 2: 上下文理解
```
用户: "West US 2 的 Redis M50 价格是多少？"
Agent: [查询价格] → 显示结果表
用户: "它的 meter ID 是什么？"
Agent: [不查询] → 基于上下文回答（从结果表中提取）
```

### 场景 3: 新会话
```
用户: [点击 Clear 按钮]
系统: 重置所有状态
用户: "查询 East US 的 VM 价格"
Agent: [新会话开始] → 全新查询
```

## 技术细节

### SSE 消息类型
- `response_id`: 会话 ID，用于下一轮对话
- `step_update`: 执行步骤更新
- `price_data`: 价格数据（触发结果表更新）
- `ai_response_chunk`: AI 响应片段
- `ai_response_complete`: AI 响应完成
- `direct_response`: 直接响应（无工具调用）
- `error`: 错误消息

### 结果表更新逻辑
- 首次 `price_data`: 替换结果 (`append: false`)
- 后续 `price_data`: 追加结果 (`append: true`)
- 无 `price_data`: 结果表保持不变

## 测试建议

1. **基础对话**: 单次查询 → 查看结果
2. **追问**: 第一次查询 → 追问上下文问题 → 验证结果表不变
3. **多次查询**: 查询 A → 查询 B → 验证结果表追加
4. **会话清除**: 查询后 → Clear → 验证所有状态重置
5. **错误恢复**: 查询失败 → 再次查询 → 验证会话继续

## 注意事项

- 会话上下文由 Azure OpenAI 维护，不在客户端存储完整历史
- `previous_response_id` 是服务端会话标识
- 结果表保持逻辑确保用户可以参考之前的查询结果
- Clear 操作是唯一清除会话的方式
