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

  // 当 executionSteps 更新时，自动滚动 Agent Activity 到最新内容
  useEffect(() => {
    if (activityScrollRef.current) {
      activityScrollRef.current.scrollTop = activityScrollRef.current.scrollHeight;
    }
  }, [executionSteps]);

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
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gradient-to-r from-cyan-500/10 to-blue-500/10 text-cyan-700 border border-cyan-300/30 font-medium">Azure OpenAI GPT-5-Codex</span>
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
          <div 
            key={msg.id || index} 
            className={`mb-4 ${msg.role === 'user' ? 'flex justify-end' : 'flex justify-start'}`}
            data-role={msg.role}
          >
            <div 
              className={`relative max-w-[85%] animate-fadeIn ${
                msg.role === 'user' 
                  ? 'ml-auto' 
                  : 'mr-auto'
              }`}
              style={{
                animationDelay: `${index * 0.1}s`,
                animationFillMode: 'backwards'
              }}
            >
              <div 
                className={`p-3.5 rounded-2xl shadow-lg ${
                  msg.role === 'user' 
                    ? 'bg-gradient-to-br from-blue-500 via-blue-600 to-indigo-600 text-white shadow-blue-500/50' 
                    : 'bg-white/90 text-gray-800 border border-gray-200/50 backdrop-blur-sm'
                }`}
              >
                {msg.role === 'user' ? (
                  // User messages displayed as plain text
                  <div className="whitespace-pre-wrap text-sm md:text-base">{msg.content}</div>
                ) : (
                  // Assistant messages rendered as Markdown
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
                          pre: (props) => <pre className="bg-gray-800 text-white p-3 rounded-md overflow-auto my-2 text-sm" {...props} />,
                          code: (props) => <code className="bg-gray-100 px-1 py-0.5 rounded text-sm font-mono" {...props} />,
                          p: (props) => <p className="text-sm md:text-base mb-2 last:mb-0" {...props} />,
                          table: (props) => (
                            <div className="overflow-x-auto my-2">
                              <table className="min-w-full text-xs border-collapse border border-gray-300" {...props} />
                            </div>
                          ),
                          thead: (props) => <thead className="bg-gray-200" {...props} />,
                          th: (props) => <th className="border border-gray-300 px-2 py-1 text-left font-semibold" {...props} />,
                          td: (props) => <td className="border border-gray-300 px-2 py-1" {...props} />
                        }}
                      >
                        {msg.content}
                      </ReactMarkdown>
                    )}
                  </div>
                )}
              </div>
              
              <div 
                className={`text-xs mt-1.5 px-1 flex items-center gap-1.5 ${
                  msg.role === 'user' ? 'justify-end' : 'justify-start'
                }`}
              >
                {msg.role === 'user' ? (
                  <>
                    <span className="text-gray-500 font-medium">You</span>
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                  </>
                ) : (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse"></div>
                    <span className="text-gray-500 font-medium bg-gradient-to-r from-gray-600 to-gray-500 bg-clip-text text-transparent">Azure Price Agent</span>
                  </>
                )}
              </div>
              
              {/* Message tail */}
              <div
                className={`absolute w-2 h-2 ${
                  msg.role === 'user'
                    ? 'right-0 -mr-1 bg-blue-500'
                    : 'left-0 -ml-1 bg-gray-100'
                } bottom-[16px] transform rotate-45`}
              ></div>
            </div>
          </div>
        ))}
        
        {/* Agent Activity - 优先显示在最上方，固定3行高度 */}
        {executionSteps.length > 0 && (
          <div className="mb-4 flex justify-start">
            <div className="relative max-w-[85%] mr-auto w-full" style={{ maxWidth: '85%' }}>
              <div className="p-2.5 rounded-xl shadow-lg bg-gradient-to-br from-cyan-50/90 to-blue-50/90 border border-cyan-300/50 backdrop-blur-sm">
                <div className="flex items-center gap-2 mb-1.5">
                  <div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-500 to-blue-500 animate-pulse"></div>
                  <div className="text-xs font-bold bg-gradient-to-r from-cyan-600 to-blue-700 bg-clip-text text-transparent">Agent Activity</div>
                  <div className="flex-1"></div>
                  <div className="w-1 h-1 rounded-full bg-cyan-400 animate-ping"></div>
                </div>
                <div 
                  ref={activityScrollRef}
                  className="agent-activity-scroll overflow-y-auto overflow-x-hidden space-y-1"
                  style={{ 
                    maxHeight: 'calc(3 * 1.5rem)', // 3行高度
                  }}
                >
                  {executionSteps.map((step, index) => (
                    <div 
                      key={index} 
                      className="flex items-start gap-2 text-xs text-gray-700 animate-fadeIn leading-6 hover:bg-white/40 rounded px-1 -mx-1 transition-all"
                      style={{
                        animationDelay: `${index * 0.05}s`,
                        animationFillMode: 'backwards'
                      }}
                    >
                      <span className={`mt-0.5 flex-shrink-0 font-bold ${
                        index === executionSteps.length - 1 
                          ? 'text-cyan-500 animate-pulse' 
                          : 'text-blue-500'
                      }`}>
                        {index === executionSteps.length - 1 ? '▸' : '✓'}
                      </span>
                      <span className="flex-1 font-medium">{step}</span>
                    </div>
                  ))}
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 text-xs mt-1.5 px-1">
                {activityCompleted ? (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-green-500"></div>
                    <span className="text-gray-500 font-medium">Done</span>
                  </>
                ) : (
                  <>
                    <div className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse"></div>
                    <span className="text-gray-500 font-medium">Processing</span>
                  </>
                )}
              </div>
              
              {/* Message tail */}
              <div className="absolute w-2 h-2 left-0 -ml-1 bg-blue-50 bottom-[16px] transform rotate-45 border-l border-b border-blue-200"></div>
            </div>
          </div>
        )}
        
        {/* 流式响应 - 显示在 Agent Activity 之后 */}
        {streamingResponse && (
          <div className="mb-4 flex justify-start">
            <div className="relative max-w-[85%] mr-auto w-full" style={{ maxWidth: '85%' }}>
              <div className="p-3.5 rounded-2xl shadow-lg bg-white/90 text-gray-800 border border-gray-200/50 backdrop-blur-sm">
                <div className="markdown-content">
                  <ReactMarkdown 
                    remarkPlugins={[remarkGfm]}
                    skipHtml={true}
                    components={{
                      pre: (props) => <pre className="bg-gray-800 text-white p-3 rounded-md overflow-auto my-2 text-sm" {...props} />,
                      code: (props) => <code className="bg-gray-100 px-1 py-0.5 rounded text-sm" {...props} />,
                      p: (props) => <p className="text-sm md:text-base mb-2 last:mb-0" {...props} />,
                      table: (props) => (
                        <div className="overflow-x-auto my-2">
                          <table className="min-w-full text-xs border-collapse border border-gray-300" {...props} />
                        </div>
                      ),
                      thead: (props) => <thead className="bg-gray-200" {...props} />,
                      th: (props) => <th className="border border-gray-300 px-2 py-1 text-left font-semibold" {...props} />,
                      td: (props) => <td className="border border-gray-300 px-2 py-1" {...props} />
                    }}
                  >
                    {streamingResponse}
                  </ReactMarkdown>
                </div>
              </div>
              
              <div className="flex items-center gap-1.5 text-xs mt-1.5 px-1">
                <div className="w-1.5 h-1.5 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse"></div>
                <span className="text-gray-500 font-medium">AI Assistant</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 border border-cyan-300/30">Typing...</span>
              </div>
              
              {/* Message tail */}
              <div className="absolute w-2 h-2 left-0 -ml-1 bg-white/90 bottom-[20px] transform rotate-45 border-l border-b border-gray-200/50"></div>
            </div>
          </div>
        )}
        
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
            find cheapest D8s v4 in US
          </button>
          <button 
            type="button" 
            onClick={() => setInput("What is meter id for Azure managed redis M50 in West US 2?")}
            disabled={loading}
            className="text-xs bg-white/90 backdrop-blur-sm py-1 px-2 rounded-full border border-cyan-200/50 text-gray-600 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 hover:border-cyan-300 transition-all shadow-sm hover:shadow-md transform hover:scale-105"
          >
            meter id of AMR M50 in West US 2
          </button>
        </div>
      </form>
    </div>
  );
}