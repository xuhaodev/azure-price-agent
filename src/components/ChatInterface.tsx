'use client';

import { useState, useRef, useEffect } from 'react';
import { PricingItem } from '@/lib/price-api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

type Message = {
  role: 'user' | 'assistant';
  content: string;
  id?: string; // Add unique identifier for messages
};

type ResultsData = {
  items: PricingItem[];
  filter: string;
  aiResponse?: string;
  append?: boolean;
};

export default function ChatInterface({ onResults }: { onResults: (data: ResultsData) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [typingAnimation, setTypingAnimation] = useState(false);
  const [streamingResponse, setStreamingResponse] = useState('');
  const [executionSteps, setExecutionSteps] = useState<string[]>([]);
  const [visibleStepsCount, setVisibleStepsCount] = useState(0); // 控制可见步骤数量
  const [activityCompleted, setActivityCompleted] = useState(false); // 跟踪 Agent Activity 是否完成
  const [sessionResponseId, setSessionResponseId] = useState<string | null>(null); // 维护会话上下文
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null); // Agent Activity 滚动容器

  useEffect(() => {
    // Add initial message
    setMessages([
      {
        role: 'assistant',
        content: 'Hello, great to connect. I’m here to answer any questions you have about Azure.',
        id: 'welcome-message'
      }
    ]);
  }, []);

  useEffect(() => {
    // 修改滚动逻辑,仅在聊天容器内部滚动,而不是整个页面
    if (messagesEndRef.current && chatContainerRef.current) {
      const chatContainer = chatContainerRef.current.querySelector('.overflow-y-auto');
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }
  }, [messages, streamingResponse, executionSteps]);

  // 当可见步骤更新时，自动滚动 Agent Activity 到最新内容
  useEffect(() => {
    if (activityScrollRef.current && visibleStepsCount > 0) {
      // 使用 smooth 滚动，创造更优雅的效果
      activityScrollRef.current.scrollTo({
        top: activityScrollRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
  }, [visibleStepsCount]);

  // 优雅地逐步显示执行步骤
  useEffect(() => {
    if (executionSteps.length > visibleStepsCount) {
      const timer = setTimeout(() => {
        setVisibleStepsCount(prev => prev + 1);
      }, 200); // 每个步骤延迟200ms显示，快速而优雅
      
      return () => clearTimeout(timer);
    }
  }, [executionSteps, visibleStepsCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    
    // Generate a unique ID for the message
    const userMessageId = `user-${Date.now()}`;
    
    // Add user message with unique ID
    setMessages(prev => [...prev, { 
      role: 'user', 
      content: userMessage,
      id: userMessageId
    }]);
    
    // Force immediate update to display user message
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Add loading message
    const loadingMsgId = `assistant-${Date.now()}`;
    setMessages(prev => [...prev, { 
      role: 'assistant', 
      content: 'Searching...',
      id: loadingMsgId
    }]);
    setLoading(true);
    setTypingAnimation(true);
    setStreamingResponse('');
    setExecutionSteps([]);
    setVisibleStepsCount(0); // 重置可见步骤计数
    setActivityCompleted(false); // 重置完成状态

    // 注意:不再自动清空结果表,只有当收到新的 price_data 时才更新

    try {
      // 使用流式API，传递 previous_response_id 以维护对话上下文
      const response = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: userMessage,
          previous_response_id: sessionResponseId // 传递上一轮的 response_id
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Query failed');
      }

      // 处理SSE流响应
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to get reader from response');
      
      const decoder = new TextDecoder();
      let priceDataReceived = false;
      let aiResponseComplete = false;
      let fullAiResponse = '';
      let buffer = ''; // 添加缓冲区用于处理不完整的 JSON
      let priceDataCount = 0; // 追踪已收到的 price_data 数量

      // 读取流式响应
      while (!aiResponseComplete) {
        const { value, done } = await reader.read();
        if (done) break;
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        // 寻找完整的 SSE 消息
        const messages = [];
        let match;
        // 移除 's' 标志，使用更兼容的方式处理换行符
        const messageRegex = /data: ({.*?})\n\n/g;
        
        // 提取所有完整的消息
        while ((match = messageRegex.exec(buffer)) !== null) {
          messages.push(match[1]);
        }
        
        if (messages.length > 0) {
          // 更新缓冲区，只保留未完成的部分
          const lastIndex = buffer.lastIndexOf('data: {');
          const lastComplete = buffer.lastIndexOf('\n\n', lastIndex) + 2;
          buffer = lastIndex > lastComplete ? buffer.substring(lastIndex) : '';
          
          // 处理提取出的完整消息
          for (const messageJson of messages) {
            try {
              const data = JSON.parse(messageJson);
              
              // 处理不同类型的消息
              switch(data.type) {
                case 'response_id':
                  // 更新会话的 response_id
                  if (data.data.response_id) {
                    setSessionResponseId(data.data.response_id);
                  }
                  break;

                case 'step_update':
                  // 收到执行步骤更新
                  setExecutionSteps(prev => [...prev, data.data.message]);
                  break;

                case 'price_data':
                  // 收到价格数据，以追加方式显示给用户
                  priceDataReceived = true;
                  priceDataCount++;
                  
                  onResults({
                    items: data.data.Items,
                    filter: data.data.filter,
                    aiResponse: undefined, // 先不设置AI响应，因为还在流式处理中
                    append: priceDataCount > 1 // 第一次替换，后续追加
                  });
                  break;
                  
                case 'ai_response_chunk':
                  // 收到AI响应的一部分，追加到已有的流响应中
                  if (priceDataReceived && data.data.content) {
                    fullAiResponse += data.data.content;
                    setStreamingResponse(fullAiResponse);
                  }
                  break;
                  
                case 'ai_response_complete':
                  // AI响应完成
                  aiResponseComplete = true;
                  if (priceDataReceived) {
                    // 隐藏流式响应，避免重复显示
                    setStreamingResponse('');
                    
                    // 更新最终的消息
                    setMessages(prev => prev.map(msg => 
                      msg.id === loadingMsgId 
                        ? { ...msg, content: fullAiResponse || data.data.content } 
                        : msg
                    ));
                    
                    // 最终更新不需要追加（因为数据已经在之前追加过了）
                    // 这里只是更新 aiResponse
                  }
                  break;
                
                case 'direct_response':
                  // 直接响应（无function call时）
                  aiResponseComplete = true;
                  
                  // 更新消息内容
                  setMessages(prev => prev.map(msg => 
                    msg.id === loadingMsgId 
                      ? { ...msg, content: data.data.content } 
                      : msg
                  ));
                  
                  // 清空结果（因为没有价格数据）
                  onResults({
                    items: [],
                    filter: '',
                    aiResponse: data.data.content,
                    append: false
                  });
                  break;
                  
                case 'error':
                  throw new Error(data.data.message || 'Unknown error in stream');
              }
            } catch (err) {
              console.error('Error parsing SSE JSON:', err, messageJson);
              // 如果是关键消息解析失败，尝试保持过程继续但记录错误
              if (messageJson.includes('"type":"error"')) {
                // 尝试提取错误信息，即使JSON解析失败
                const errorMatch = messageJson.match(/"message"\s*:\s*"([^"]+)"/);
                const errorMsg = errorMatch ? errorMatch[1] : 'Malformed error data from server';
                throw new Error(errorMsg);
              }
            }
          }
        }
      }
      
      // 如果流结束但未收到完成消息，完成处理
      if (!aiResponseComplete && priceDataReceived) {
        // 更新最终消息
        setMessages(prev => prev.map(msg => 
          msg.id === loadingMsgId 
            ? { ...msg, content: fullAiResponse || "Response processing completed" } 
            : msg
        ));

        setTypingAnimation(false);
        setStreamingResponse('');
        setExecutionSteps([]);
      }
      
    } catch (error) {
      console.error('Error:', error);
      
      setTypingAnimation(false);
      setStreamingResponse('');
      
      // Update error message - find the loading message by ID and replace it
      setMessages(prev => prev.map(msg => 
        msg.id === loadingMsgId 
          ? { ...msg, content: `Query error: ${error instanceof Error ? error.message : 'Unknown error'}` }
          : msg
      ));
    } finally {
      setLoading(false);
      // 延迟设置完成状态,让用户能看到完整的步骤列表
      // 使用 setTimeout 确保在状态更新后执行
      setTimeout(() => {
        setActivityCompleted(true);
      }, 300);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content: 'Hello, great to connect. I’m here to answer any questions you have about Azure',
        id: 'welcome-message'
      }
    ]);
    setInput('');
    setStreamingResponse('');
    setExecutionSteps([]);
    setVisibleStepsCount(0); // 重置可见步骤计数
    setActivityCompleted(false); // 重置完成状态
    setSessionResponseId(null); // 重置会话上下文
    onResults({ items: [], filter: '', append: false });
  };

  return (
    <div ref={chatContainerRef} className="flex flex-col backdrop-blur-xl bg-white/95 rounded-xl shadow-2xl overflow-hidden h-full border border-white/20">
      {/* Header with Clear Chat button */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-blue-200/50 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse shadow-lg shadow-cyan-500/50"></div>
          <h3 className="text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Chat</h3>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-cyan-500/10 to-blue-500/10 text-cyan-700 border border-cyan-300/30 font-medium">GPT-5</span>
        </div>
        <button
          onClick={handleClearChat}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white/60 hover:bg-gradient-to-r hover:from-red-50 hover:to-pink-50 text-gray-600 hover:text-red-600 rounded-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed border border-gray-200/50 hover:border-red-300/50 shadow-sm hover:shadow-md transform hover:scale-105 backdrop-blur-sm"
          title="Clear chat history"
        >
          <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3.5 h-3.5">
            <path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 006 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 10.23 1.482l.149-.022.841 10.518A2.75 2.75 0 007.596 19h4.807a2.75 2.75 0 002.742-2.53l.841-10.52.149.023a.75.75 0 00.23-1.482A41.03 41.03 0 0014 4.193V3.75A2.75 2.75 0 0011.25 1h-2.5zM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4zM8.58 7.72a.75.75 0 00-1.5.06l.3 7.5a.75.75 0 101.5-.06l-.3-7.5zm4.34.06a.75.75 0 10-1.5-.06l-.3 7.5a.75.75 0 101.5.06l.3-7.5z" clipRule="evenodd" />
          </svg>
          Clear
        </button>
      </div>
      
      {/* Message display area */}
      <div className="flex-1 p-4 overflow-y-auto">
        {messages.map((msg, index) => (
          <div key={msg.id || index}>
            {/* User messages - always display normally */}
            {msg.role === 'user' && (
              <div className="mb-4 flex justify-end" data-role={msg.role}>
                <div 
                  className="relative max-w-[85%] ml-auto animate-fadeIn"
                  style={{
                    animationDelay: `${index * 0.1}s`,
                    animationFillMode: 'backwards'
                  }}
                >
                  <div className="p-3.5 rounded-2xl shadow-lg bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-blue-500/50">
                    <div className="whitespace-pre-wrap text-sm md:text-base">{msg.content}</div>
                  </div>
                  
                  <div className="text-xs mt-1.5 px-1 flex items-center gap-1.5 justify-end">
                    <span className="text-gray-500 font-medium">You</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                  </div>
                  
                  <div className="absolute w-2 h-2 right-0 -mr-1 bg-blue-500 bottom-[16px] transform rotate-45"></div>
                </div>
              </div>
            )}

            {/* Assistant messages - show unified card when processing/has activity, otherwise normal display */}
            {msg.role === 'assistant' && (
              <>
                {/* Show unified activity + response card for the last message when there are execution steps or streaming */}
                {index === messages.length - 1 && (executionSteps.length > 0 || streamingResponse) ? (
                  <div className="mb-4 flex justify-start">
                    <div className="relative max-w-[85%] mr-auto w-full" style={{ maxWidth: '85%' }}>
                      {/* Unified card with gradient background */}
                      <div className="rounded-2xl shadow-xl bg-gradient-to-br from-white/95 via-blue-50/30 to-cyan-50/40 border border-blue-200/40 backdrop-blur-sm overflow-hidden">
                        
                        {/* Agent Activity Section - fixed 3 lines with scroll */}
                        {executionSteps.length > 0 && (
                          <div className={`transition-all duration-300 ${streamingResponse || (activityCompleted && msg.content !== 'Searching...') ? 'border-b border-blue-200/30' : ''}`}>
                            <div className="p-3">
                              {/* Activity Header */}
                              <div className="flex items-center gap-2 mb-2">
                                <div className={`w-2 h-2 rounded-full ${activityCompleted ? 'bg-green-500' : 'bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse'}`}></div>
                                <div className="text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-700 bg-clip-text text-transparent">
                                  {activityCompleted ? 'Task Completed' : 'Agent Activity'}
                                </div>
                                <div className="flex-1"></div>
                                {!activityCompleted && <div className="w-1 h-1 rounded-full bg-cyan-400 animate-ping"></div>}
                                {activityCompleted && (
                                  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-green-500">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.857-9.809a.75.75 0 00-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 10-1.06 1.061l2.5 2.5a.75.75 0 001.137-.089l4-5.5z" clipRule="evenodd" />
                                  </svg>
                                )}
                              </div>
                              
                              {/* Activity Steps - strictly 3 lines max with scroll */}
                              <div 
                                ref={activityScrollRef}
                                className="agent-activity-scroll overflow-y-auto overflow-x-hidden space-y-0.5"
                                style={{ 
                                  maxHeight: 'calc(3 * 1.75rem)', // Exactly 3 lines
                                }}
                              >
                                {executionSteps.slice(0, visibleStepsCount).map((step, idx) => (
                                  <div 
                                    key={idx} 
                                    className="flex items-start gap-2 text-xs text-gray-700 animate-slideInFromTop leading-[1.75rem] hover:bg-white/50 rounded px-2 py-0.5 -mx-2 transition-all"
                                  >
                                    <span className={`flex-shrink-0 font-bold text-[10px] ${
                                      idx === visibleStepsCount - 1 && idx === executionSteps.length - 1 && !activityCompleted
                                        ? 'text-cyan-500 animate-pulse' 
                                        : idx === visibleStepsCount - 1 && !activityCompleted
                                        ? 'text-cyan-500 animate-pulse'
                                        : 'text-green-500'
                                    }`}>
                                      {idx === visibleStepsCount - 1 && !activityCompleted ? '▸' : '✓'}
                                    </span>
                                    <span className="flex-1 font-medium">{step}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Processing Animation - show below activity while processing */}
                        {executionSteps.length > 0 && !streamingResponse && msg.content === 'Searching...' && (
                          <div className="px-3.5 py-3 border-t border-blue-200/30">
                            <div className="flex justify-center items-center">
                              <div className="flex space-x-1.5">
                                <div className="w-2 h-2 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                                <div className="w-2 h-2 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                                <div className="w-2 h-2 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Final Response Section - only show when streaming or completed */}
                        {(streamingResponse || (activityCompleted && msg.content !== 'Searching...')) && (
                          <div className="p-3.5 border-t border-blue-200/30">
                            {/* Content */}
                            <div className="markdown-content">
                              <ReactMarkdown 
                                remarkPlugins={[remarkGfm]}
                                skipHtml={true}
                                components={{
                                  pre: (props) => <pre className="bg-gray-800 text-white p-2.5 rounded-md overflow-auto my-1.5 text-xs" {...props} />,
                                  code: (props) => <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono" {...props} />,
                                  p: (props) => <p className="text-xs md:text-sm mb-1.5 last:mb-0" {...props} />,
                                  h1: (props) => <h1 className="text-base font-bold mb-2" {...props} />,
                                  h2: (props) => <h2 className="text-sm font-bold mb-1.5" {...props} />,
                                  h3: (props) => <h3 className="text-sm font-semibold mb-1" {...props} />,
                                  ul: (props) => <ul className="text-xs md:text-sm list-disc ml-4 mb-1.5" {...props} />,
                                  ol: (props) => <ol className="text-xs md:text-sm list-decimal ml-4 mb-1.5" {...props} />,
                                  li: (props) => <li className="mb-0.5" {...props} />,
                                  table: (props) => (
                                    <div className="overflow-x-auto my-1.5 rounded-lg shadow-sm">
                                      <table className="w-full text-[10px] border-collapse border border-gray-300 bg-white" {...props} />
                                    </div>
                                  ),
                                  thead: (props) => <thead className="bg-gradient-to-r from-gray-100 to-gray-200" {...props} />,
                                  th: (props) => <th className="border border-gray-300 px-2 py-1.5 text-left font-bold text-gray-700 whitespace-normal break-words" style={{ maxWidth: '200px', minWidth: '80px' }} {...props} />,
                                  td: (props) => <td className="border border-gray-300 px-2 py-1.5 text-gray-600 whitespace-normal break-words align-top" style={{ maxWidth: '200px', minWidth: '80px' }} {...props} />
                                }}
                              >
                                {streamingResponse || msg.content}
                              </ReactMarkdown>
                            </div>
                          </div>
                        )}
                      </div>
                      
                      {/* Status indicator below card */}
                      <div className="flex items-center gap-1.5 text-xs mt-1.5 px-1">
                        <div className={`w-1.5 h-1.5 rounded-full ${
                          activityCompleted && !streamingResponse && msg.content !== 'Searching...'
                            ? 'bg-green-500'
                            : 'bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse'
                        }`}></div>
                        <span className="text-gray-500 font-medium bg-gradient-to-r from-gray-600 to-gray-500 bg-clip-text text-transparent">
                          Azure Prices Agent
                        </span>
                        {!activityCompleted && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-300/30 animate-pulse">
                            Processing...
                          </span>
                        )}
                        {activityCompleted && (streamingResponse || msg.content === 'Searching...') && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 border border-cyan-300/30 animate-pulse">
                            Typing...
                          </span>
                        )}
                        {activityCompleted && !streamingResponse && msg.content !== 'Searching...' && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-green-500/10 text-green-600 border border-green-300/30">
                            Completed
                          </span>
                        )}
                      </div>
                      
                      {/* Message tail */}
                      <div className="absolute w-2 h-2 left-0 -ml-1 bg-white/95 bottom-[20px] transform rotate-45 border-l border-b border-blue-200/40"></div>
                    </div>
                  </div>
                ) : (
                  /* Normal assistant message display (for non-active messages or when no activity) */
                  <div className="mb-4 flex justify-start" data-role={msg.role}>
                    <div 
                      className="relative max-w-[85%] mr-auto animate-fadeIn"
                      style={{
                        animationDelay: `${index * 0.1}s`,
                        animationFillMode: 'backwards'
                      }}
                    >
                      <div className="p-3.5 rounded-2xl shadow-lg bg-white/90 text-gray-800 border border-gray-200/50 backdrop-blur-sm">
                        <div className={`markdown-content ${typingAnimation && msg.content === 'Searching...' ? 'animate-pulse' : ''}`}>
                          {typingAnimation && msg.content === 'Searching...' ? (
                            <div className="flex items-center space-x-1.5 h-6">
                              <div className="w-2.5 h-2.5 bg-gradient-to-r from-cyan-400 to-blue-500 rounded-full animate-bounce shadow-md shadow-cyan-500/50" style={{ animationDelay: '0ms' }}></div>
                              <div className="w-2.5 h-2.5 bg-gradient-to-r from-blue-400 to-indigo-500 rounded-full animate-bounce shadow-md shadow-blue-500/50" style={{ animationDelay: '150ms' }}></div>
                              <div className="w-2.5 h-2.5 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full animate-bounce shadow-md shadow-indigo-500/50" style={{ animationDelay: '300ms' }}></div>
                            </div>
                          ) : (
                            <ReactMarkdown 
                              remarkPlugins={[remarkGfm]}
                              skipHtml={true}
                              components={{
                                pre: (props) => <pre className="bg-gray-800 text-white p-2.5 rounded-md overflow-auto my-1.5 text-xs" {...props} />,
                                code: (props) => <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono" {...props} />,
                                p: (props) => <p className="text-xs md:text-sm mb-1.5 last:mb-0" {...props} />,
                                h1: (props) => <h1 className="text-base font-bold mb-2" {...props} />,
                                h2: (props) => <h2 className="text-sm font-bold mb-1.5" {...props} />,
                                h3: (props) => <h3 className="text-sm font-semibold mb-1" {...props} />,
                                ul: (props) => <ul className="text-xs md:text-sm list-disc ml-4 mb-1.5" {...props} />,
                                ol: (props) => <ol className="text-xs md:text-sm list-decimal ml-4 mb-1.5" {...props} />,
                                li: (props) => <li className="mb-0.5" {...props} />,
                                table: (props) => (
                                  <div className="overflow-x-auto my-1.5 rounded-lg shadow-sm">
                                    <table className="w-full text-[10px] border-collapse border border-gray-300 bg-white" {...props} />
                                  </div>
                                ),
                                thead: (props) => <thead className="bg-gradient-to-r from-gray-100 to-gray-200" {...props} />,
                                th: (props) => <th className="border border-gray-300 px-2 py-1.5 text-left font-bold text-gray-700 whitespace-normal break-words" style={{ maxWidth: '200px', minWidth: '80px' }} {...props} />,
                                td: (props) => <td className="border border-gray-300 px-2 py-1.5 text-gray-600 whitespace-normal break-words align-top" style={{ maxWidth: '200px', minWidth: '80px' }} {...props} />
                              }}
                            >
                              {msg.content}
                            </ReactMarkdown>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-xs mt-1.5 px-1 flex items-center gap-1.5">
                        <div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse"></div>
                        <span className="text-gray-500 font-medium bg-gradient-to-r from-gray-600 to-gray-500 bg-clip-text text-transparent">Azure Prices Agent</span>
                      </div>
                      
                      <div className="absolute w-2 h-2 left-0 -ml-1 bg-gray-100 bottom-[16px] transform rotate-45"></div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <form 
        onSubmit={handleSubmit} 
        className="border-t border-blue-200/30 p-3 md:p-4 bg-gradient-to-r from-blue-50/50 to-indigo-50/50 backdrop-blur-sm"
      >
        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="💬 Ask me anything about Azure pricing..."
              className="w-full p-3 pr-10 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all shadow-lg text-sm md:text-base bg-white/90 backdrop-blur-sm placeholder:text-gray-400"
              disabled={loading}
              spellCheck={false}
              autoFocus
            />
            {input.trim() && !loading && (
              <button 
                type="button"
                onClick={() => setInput('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            )}
          </div>
          <button 
            type="submit"
            disabled={loading || !input.trim()}
            className="px-5 py-3 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 text-white rounded-xl hover:from-cyan-600 hover:via-blue-600 hover:to-indigo-700 disabled:from-blue-300 disabled:to-indigo-400 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-cyan-500/50 transform hover:scale-105 active:scale-95 flex items-center group"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                <span className="text-xs font-medium">Processing...</span>
              </span>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5 group-hover:translate-x-0.5 transition-transform">
                <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z" />
              </svg>
            )}
          </button>
        </div>
        
        {/* Example queries - small suggestions */}
        <div className="mt-2 flex flex-wrap gap-2">
          <button 
            type="button" 
            onClick={() => setInput("Which US Azure region offers the lowest price for the Standard D8s v4 VM?")}
            disabled={loading}
            className="text-xs bg-white/90 backdrop-blur-sm py-1 px-2 rounded-full border border-cyan-200/50 text-gray-600 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 hover:border-cyan-300 transition-all shadow-sm hover:shadow-md transform hover:scale-105"
          >
            find cheapest D8s v4
          </button>
          <button 
            type="button" 
            onClick={() => setInput("What are meter id for Azure managed redis X series in West US 2?")}
            disabled={loading}
            className="text-xs bg-white/90 backdrop-blur-sm py-1 px-2 rounded-full border border-cyan-200/50 text-gray-600 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 hover:border-cyan-300 transition-all shadow-sm hover:shadow-md transform hover:scale-105"
          >
            meter id of AMR X series
          </button>
                    <button 
            type="button" 
            onClick={() => setInput("What are the yearly costs of running 2 NC40 H100 VMs for inference in East US 2?")}
            disabled={loading}
            className="text-xs bg-white/90 backdrop-blur-sm py-1 px-2 rounded-full border border-cyan-200/50 text-gray-600 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 hover:border-cyan-300 transition-all shadow-sm hover:shadow-md transform hover:scale-105"
          >
            annual cost of NC H100 VMs
          </button>
        </div>
      </form>
    </div>
  );
}