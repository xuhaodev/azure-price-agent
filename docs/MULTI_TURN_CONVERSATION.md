# 多轮对话功能实现说明

## 功能概述

已成功实现多轮对话功能，支持基于单一会话上下文的连续交互。整个会话过程中，所有对话都基于同一个 response_id，不会创建新的对话线程。

## 核心实现

### 1. 单一会话上下文管理 (Single Session Context)

- **状态维护**: `ChatInterface` 组件维护单一 `sessionResponseId` 状态
- **会话建立**: 首次交互时设置 response_id，后续对话继续使用相同的 response_id
- **上下文延续**: 所有消息都在同一个 Azure OpenAI Response 线程中处理
- **会话清除**: 只有用户点击 "Clear" 按钮才会重置会话并开始新的线程

### 2. Agent 自主决策 (Agent Decision Making)

- **工具调用**: Agent 根据查询内容自行决定是否需要调用 `odata_query` 工具
- **上下文理解**: Agent 可以基于对话历史回答问题，无需每次都查询价格
- **智能响应**: 
  - 需要价格数据时 → 调用工具 → 返回价格结果
  - 询问已有信息时 → 直接回答 → 不调用工具

### 3. 价格查询结果保持 (Price Results Persistence)

- **按需更新**: 只有当 agent 调用 `odata_query` 工具时才更新结果表
- **结果保留**: 如果 agent 没有查询价格（仅基于上下文回答），结果表保持不变
- **追加模式**: 多次查询的结果会追加显示，不会替换之前的结果
- **可见性**: 用户可以在整个会话中持续参考所有已查询的价格数据

### 4. 会话清除 (Session Clear)

- **Clear 按钮**: 用户可以点击 "Clear" 按钮清除会话
- **状态重置**: 清除操作会重置：
  - 聊天消息历史
  - 会话 response_id（下次查询将创建新会话）
  - 价格查询结果
  - 执行步骤
- **新会话**: 清除后的下一次查询将开启全新的对话线程

## 工作流程

```
用户输入 Query 1 (关于价格)
  ↓
Agent 判断需要价格数据 → 调用工具查询价格
  ↓
返回结果 + 设置 response_id_1
  ↓
【会话已建立，response_id = response_id_1】
  ↓
用户输入 Query 2 (追问上下文问题)
  ↓
使用相同的 response_id_1 发送请求
  ↓
Agent 判断可基于上下文回答 → 不调用工具 → 直接回答
  ↓
价格结果表保持 Query 1 的数据不变
  ↓
【仍在同一会话，response_id = response_id_1】
  ↓
用户输入 Query 3 (新的价格查询)
  ↓
使用相同的 response_id_1 发送请求
  ↓
Agent 判断需要新数据 → 调用工具查询价格
  ↓
新结果追加到结果表
  ↓
【仍在同一会话，response_id = response_id_1】
  ↓
用户点击 Clear 按钮
  ↓
重置所有状态，response_id = null
  ↓
【会话结束，下次将创建新会话】
```

## 代码修改

### 1. ChatInterface.tsx
- 添加 `sessionResponseId` 状态维护单一会话 ID
- 修改 response_id 更新逻辑：只在首次设置，后续保持不变
- 修改 API 调用传递相同的 `previous_response_id`
- 移除 `direct_response` 中清空结果表的逻辑
- 只在 `price_data` 事件时更新结果表
- 更新 `handleClearChat` 重置会话状态

### 2. route.ts (API)
- 接收 `previous_response_id` 参数
- 传递给 `queryPricingWithStreamingResponse` 以维持会话
- 添加注释说明 agent 自行决定工具调用

### 3. price-api.ts
- `executePricingWorkflow` 接收 `previousResponseId` 参数
- 在创建 Response 时传递 `previous_response_id` 维持对话线程
- Agent 根据对话上下文自行决定是否调用工具
- 返回 `responseId` 用于会话维护
- 在 SSE 流中发送 `response_id` 给客户端（仅用于首次建立会话）
- 添加注释说明会话延续机制

### 4. page.tsx
- `handleResults` 支持 `append` 参数
- 根据 `append` 决定是追加还是替换结果

## 使用场景

### 场景 1: 单会话中的多次查询和追问
```
用户: "US 地区最便宜的 D8s v4 在哪里？"
Agent: [调用工具查询价格] → 显示结果表
【会话建立，response_id 已设置】

用户: "那 D16s v4 呢？"
Agent: [判断需要新数据，调用工具] → 追加到结果表
【相同会话，response_id 保持不变】

用户: "对比一下这两个的价格差异"
Agent: [基于已有数据分析] → 不调用工具 → 结果表保持
【相同会话，response_id 保持不变】

用户: "它们的 meter ID 是什么？"
Agent: [从已查询数据中提取] → 不调用工具 → 结果表保持
【相同会话，response_id 保持不变】
```

### 场景 2: 上下文理解（无需重复查询）
```
用户: "West US 2 的 Redis M50 价格是多少？"
Agent: [调用工具查询] → 显示结果表
【会话建立】

用户: "这个价格贵吗？"
Agent: [基于上下文理解并回答] → 不调用工具 → 结果表保持
【相同会话】

用户: "有没有更便宜的选项？"
Agent: [可能调用工具查询其他型号] → 追加新结果
【相同会话】
```

### 场景 3: 会话重置
```
用户: [点击 Clear 按钮]
系统: 重置所有状态，response_id = null
【会话结束】

用户: "查询 East US 的 VM 价格"
Agent: [新会话开始，调用工具] → 全新查询
【新会话建立，获得新的 response_id】
```

## 技术细节

### 会话管理
- **单一 response_id**: 整个会话使用一个 response_id
- **首次设置**: 第一次交互时从服务器获取并设置
- **持续使用**: 后续所有请求都传递这个 response_id
- **上下文累积**: Azure OpenAI 在服务端维护完整对话历史
- **会话清除**: 只有 Clear 按钮会重置 response_id

### Agent 决策机制
- **自主判断**: Agent 根据 prompt 指令和对话上下文决定是否调用工具
- **工具可用**: 工具始终可用，但由 agent 决定是否使用
- **响应类型**:
  - 调用工具 → `price_data` 事件 → 更新结果表
  - 不调用工具 → `direct_response` 事件 → 结果表保持

### SSE 消息类型
- `response_id`: 会话 ID（首次建立会话时发送）
- `step_update`: 执行步骤更新
- `price_data`: 价格数据（agent 调用工具时发送，触发结果表更新）
- `ai_response_chunk`: AI 响应片段（流式输出）
- `ai_response_complete`: AI 响应完成
- `direct_response`: 直接响应（agent 未调用工具时，结果表不变）
- `error`: 错误消息

### 结果表更新逻辑
- **首次 price_data**: 替换结果 (`append: false`)
- **后续 price_data**: 追加结果 (`append: true`)
- **无 price_data**: 结果表保持不变（agent 基于上下文回答）

## 优势

1. **真正的多轮对话**: 不会因为每次交互而丢失上下文
2. **Agent 智能化**: Agent 自行判断是否需要查询新数据
3. **用户体验优化**: 
   - 不需要重复查询已知信息
   - 历史查询结果持续可见
   - 自然的对话流程
4. **性能优化**: 减少不必要的 API 调用和数据查询
5. **简洁实现**: 无需功能开关或向后兼容逻辑

## 测试建议

1. **单会话多轮对话**: 
   - 查询 A → 追问细节 → 查询 B → 对比分析
   - 验证 response_id 保持不变
   - 验证结果表正确追加

2. **Agent 智能判断**:
   - 提出可从上下文回答的问题
   - 验证不会触发不必要的工具调用
   - 验证结果表保持不变

3. **会话清除**:
   - 进行对话 → Clear → 新对话
   - 验证所有状态正确重置

4. **错误恢复**:
   - 查询失败 → 重试
   - 验证会话继续，不会中断

## 注意事项

- **会话上下文**: 由 Azure OpenAI Responses API 在服务端维护
- **response_id 持久性**: 在客户端会话期间持续存储
- **结果表累积**: 所有查询结果在会话期间持续可见
- **会话重置**: Clear 是唯一清除会话的方式
- **无向后兼容**: 由于应用未发布，直接实现新逻辑，无需兼容旧版本
