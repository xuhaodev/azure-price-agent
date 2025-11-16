'use client';

import { useState, useRef, useEffect } from 'react';
import { PricingItem } from '@/lib/price-api';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Multi-turn conversation with single session context
 * - All queries in the same session append data to the price results table
 * - Only Clear button resets session and clears table
 * - Agent autonomously decides whether to call tools based on context
 */

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
  const [visibleStepsCount, setVisibleStepsCount] = useState(0); // Control visible step count
  const [activityCompleted, setActivityCompleted] = useState(false); // Track if Agent Activity is completed
  const [aiResponseCompleted, setAiResponseCompleted] = useState(false); // Track if AI response streaming is completed
  const [sessionResponseId, setSessionResponseId] = useState<string | null>(null); // Maintain session context
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const activityScrollRef = useRef<HTMLDivElement>(null); // Agent Activity scroll container

  useEffect(() => {
    // Add initial message
    setMessages([
      {
        role: 'assistant',
        content: 'Hello! I\'m your Azure Pricing Agent.',
        id: 'welcome-message'
      }
    ]);
  }, []);

  useEffect(() => {
    // Modify scroll logic to only scroll within chat container, not the entire page
    if (messagesEndRef.current && chatContainerRef.current) {
      const chatContainer = chatContainerRef.current.querySelector('.overflow-y-auto');
      if (chatContainer) {
        chatContainer.scrollTop = chatContainer.scrollHeight;
      }
    }
  }, [messages, streamingResponse, executionSteps]);

  // Auto-scroll Agent Activity to show the latest step when visible steps count increases
  useEffect(() => {
    if (activityScrollRef.current && visibleStepsCount > 0) {
      // Small delay to ensure DOM is updated with the new step
      requestAnimationFrame(() => {
        if (activityScrollRef.current) {
          // Scroll to bottom to show the newest step
          activityScrollRef.current.scrollTo({
            top: activityScrollRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      });
    }
  }, [visibleStepsCount]);

  // Also scroll when executionSteps content changes (for in-place updates like progress bars)
  useEffect(() => {
    if (activityScrollRef.current && executionSteps.length > 0) {
      // Use requestAnimationFrame to ensure DOM has updated
      requestAnimationFrame(() => {
        if (activityScrollRef.current) {
          activityScrollRef.current.scrollTo({
            top: activityScrollRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      });
    }
  }, [executionSteps]);

  // Ensure the final state is visible at the bottom when activity completes
  useEffect(() => {
    if (activityCompleted && activityScrollRef.current) {
      // Delay to ensure all DOM updates and animations are complete
      setTimeout(() => {
        if (activityScrollRef.current) {
          // Final scroll to show the completion status
          activityScrollRef.current.scrollTo({
            top: activityScrollRef.current.scrollHeight,
            behavior: 'smooth'
          });
        }
      }, 150); // Slightly longer delay for completion
    }
  }, [activityCompleted]);

  // Gradually display execution steps elegantly with 250ms interval
  useEffect(() => {
    if (executionSteps.length > visibleStepsCount) {
      const timer = setTimeout(() => {
        setVisibleStepsCount(prev => prev + 1);
      }, 250); // Display each step with 250ms delay for clear visibility
      
      return () => clearTimeout(timer);
    }
  }, [executionSteps, visibleStepsCount]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || loading) return;

    const userMessage = input.trim();
    setInput('');
    
    // Reset textarea height
    if (inputRef.current) {
      inputRef.current.style.height = '48px';
    }
    
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
      content: 'Preparing query...',
      id: loadingMsgId
    }]);
    setLoading(true);
    setTypingAnimation(true);
    setStreamingResponse('');
    setExecutionSteps([]);
    setVisibleStepsCount(0); // Reset visible step count
    setActivityCompleted(false); // Reset completion status
    setAiResponseCompleted(false); // Reset AI response completion status

    // In same session, all price data is appended to table
    // Only Clear button will reset the table

    try {
      // Use streaming API, pass previous_response_id to maintain conversation context
      const response = await fetch('/api/prices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          prompt: userMessage,
          previous_response_id: sessionResponseId // Pass previous round's response_id
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.details || errorData.error || 'Query failed');
      }

      // Process SSE streaming response
      const reader = response.body?.getReader();
      if (!reader) throw new Error('Failed to get reader from response');
      
      const decoder = new TextDecoder();
      let priceDataReceived = false;
      let aiResponseComplete = false;
      let fullAiResponse = '';
      let buffer = ''; // Add buffer to handle incomplete JSON
      
      // Add timeout protection for Azure Web App
      const timeoutId = setTimeout(() => {
        if (!aiResponseComplete) {
          console.warn('[ChatInterface] Stream timeout - forcing completion');
          aiResponseComplete = true;
          reader.cancel();
        }
      }, 120000); // 2 minute timeout

      // Read streaming response
      while (!aiResponseComplete) {
        const { value, done } = await reader.read();
        if (done) {
          console.log('[ChatInterface] Stream done signal received');
          break;
        }
        
        const chunk = decoder.decode(value, { stream: true });
        buffer += chunk;
        
        console.log(`[ChatInterface] Received chunk, buffer size: ${buffer.length} bytes`);
        
        // Skip heartbeat messages
        if (buffer.includes(': heartbeat\n\n')) {
          buffer = buffer.replace(/: heartbeat\n\n/g, '');
        }
        
        // Find complete SSE messages - use a more robust approach for nested JSON
        const messages = [];
        let searchStart = 0;
        
        while (true) {
          // Find next "data: " prefix
          const dataStart = buffer.indexOf('data: ', searchStart);
          if (dataStart === -1) break;
          
          const jsonStart = dataStart + 6; // Length of "data: "
          
          // Find the matching closing brace for the JSON object
          let braceCount = 0;
          let inString = false;
          let escaped = false;
          let jsonEnd = -1;
          
          for (let i = jsonStart; i < buffer.length; i++) {
            const char = buffer[i];
            
            if (escaped) {
              escaped = false;
              continue;
            }
            
            if (char === '\\') {
              escaped = true;
              continue;
            }
            
            if (char === '"') {
              inString = !inString;
              continue;
            }
            
            if (!inString) {
              if (char === '{') braceCount++;
              if (char === '}') braceCount--;
              
              if (braceCount === 0 && buffer.substring(i + 1, i + 3) === '\n\n') {
                jsonEnd = i + 1;
                break;
              }
            }
          }
          
          if (jsonEnd === -1) {
            // Incomplete message, wait for more data
            break;
          }
          
          // Extract complete JSON message
          const messageJson = buffer.substring(jsonStart, jsonEnd);
          messages.push(messageJson);
          console.log(`[ChatInterface] Extracted message (${messageJson.length} bytes):`, messageJson.substring(0, 100));
          
          // Move search position past this message
          searchStart = jsonEnd + 2; // Skip \n\n
        }
        
        // Remove processed messages from buffer
        if (searchStart > 0) {
          buffer = buffer.substring(searchStart);
          console.log(`[ChatInterface] Processed ${messages.length} messages, buffer remaining: ${buffer.length} bytes`);
        }
        
        if (messages.length > 0) {
          for (const messageJson of messages) {
            try {
              const data = JSON.parse(messageJson);
              
              // Handle different message types
              switch(data.type) {
                case 'response_id':
                  // Update session's response_id ONLY if we don't have one yet
                  // This ensures all conversations in this session use the same response_id
                  if (data.data.response_id && !sessionResponseId) {
                    setSessionResponseId(data.data.response_id);
                  }
                  break;

                case 'step_update':
                  // Received execution step update
                  const newMessage = data.data.message;
                  
                  // Hide "Searching..." animation immediately when first step arrives
                  if (executionSteps.length === 0) {
                    setTypingAnimation(false);
                  }
                  
                  setExecutionSteps(prev => {
                    // Check for query start pattern
                    const queryStartMatch = newMessage.match(/^🔎 Query (\d+)\/(\d+)/);
                    // Check for query result pattern  
                    const queryResultMatch = newMessage.match(/^✅ Query (\d+)\/(\d+)/);
                    
                    if (queryStartMatch || queryResultMatch) {
                      // Extract query numbers
                      const match = queryStartMatch || queryResultMatch;
                      const current = parseInt(match[1]);
                      const total = parseInt(match[2]);
                      
                      // Find existing progress line
                      const progressIdx = prev.findIndex(s => s.includes('📊 Progress:') || s.includes('✅ Complete:'));
                      
                      if (current === total && queryResultMatch) {
                        // Last query completed
                        const completeLine = `✅ Complete: ${total}/${total} queries executed successfully`;
                        if (progressIdx >= 0) {
                          const updated = [...prev];
                          updated[progressIdx] = completeLine;
                          return updated;
                        }
                        return [...prev, completeLine];
                      } else if (queryResultMatch) {
                        // Query completed
                        const progressLine = `📊 Progress: ${current}/${total} queries completed (${Math.round(current/total*100)}%)`;
                        if (progressIdx >= 0) {
                          const updated = [...prev];
                          updated[progressIdx] = progressLine;
                          return updated;
                        }
                        return [...prev, progressLine];
                      } else {
                        // Query started
                        const progressLine = `📊 Progress: ${current}/${total} - Executing query...`;
                        if (progressIdx >= 0) {
                          const updated = [...prev];
                          updated[progressIdx] = progressLine;
                          return updated;
                        }
                        return [...prev, progressLine];
                      }
                    }
                    
                    // Not a query message, append normally
                    return [...prev, newMessage];
                  });
                  break;

                case 'price_data':
                  // Received price data from tool call - ALWAYS append in same session
                  // Multiple tool calls in same session should accumulate all data
                  // Only clear on new session (Clear button resets sessionResponseId to null)
                  priceDataReceived = true;
                  
                  console.log('[ChatInterface] ========== RECEIVED PRICE_DATA ==========');
                  console.log('[ChatInterface] Full data object:', JSON.stringify(data).substring(0, 500));
                  console.log('[ChatInterface] data.data exists:', !!data.data);
                  console.log('[ChatInterface] data.data.Items exists:', !!data.data?.Items);
                  console.log('[ChatInterface] data.data.Items is array:', Array.isArray(data.data?.Items));
                  console.log('[ChatInterface] Items count:', data.data?.Items?.length || 0);
                  console.log('[ChatInterface] Filter:', data.data?.filter);
                  console.log('[ChatInterface] First item:', data.data?.Items?.[0]);
                  
                  // Validate data structure
                  if (!data.data) {
                    console.error('[ChatInterface] ERROR: data.data is missing!');
                    break;
                  }
                  
                  // Ensure Items is an array before passing to onResults
                  const items = Array.isArray(data.data?.Items) ? data.data.Items : [];
                  const filter = data.data?.filter || '';
                  
                  console.log(`[ChatInterface] Prepared items array with ${items.length} items`);
                  
                  if (items.length > 0) {
                    console.log(`[ChatInterface] ✓ Calling onResults with ${items.length} items and filter: ${filter}`);
                    try {
                      onResults({
                        items,
                        filter,
                        aiResponse: undefined,
                        append: true // Always append - table only clears when Clear button is clicked
                      });
                      console.log('[ChatInterface] ✓ onResults completed successfully');
                    } catch (err) {
                      console.error('[ChatInterface] ERROR in onResults:', err);
                    }
                  } else {
                    console.warn('[ChatInterface] ⚠️ Received price_data with no items (empty result set)');
                  }
                  console.log('[ChatInterface] ==========================================');
                  break;
                  
                case 'ai_response_chunk':
                  // Received part of AI response, append to existing stream response
                  if (priceDataReceived && data.data.content) {
                    fullAiResponse += data.data.content;
                    setStreamingResponse(fullAiResponse);
                  }
                  break;
                  
                case 'ai_response_complete':
                  // AI response complete
                  console.log('[ChatInterface] Received ai_response_complete');
                  aiResponseComplete = true;
                  setAiResponseCompleted(true); // Mark AI response as completed
                  if (priceDataReceived) {
                    // Keep streaming response visible (don't clear it)
                    // This ensures the reply bubble continues to show the final content
                    
                    // Update final message
                    const finalContent = fullAiResponse || data.data?.content || 'Response completed';
                    console.log('[ChatInterface] Setting final message, length:', finalContent.length);
                    setMessages(prev => prev.map(msg => 
                      msg.id === loadingMsgId 
                        ? { ...msg, content: finalContent } 
                        : msg
                    ));
                    
                    // Final update doesn't need append (data already appended earlier)
                    // Only update aiResponse here
                  } else {
                    console.warn('[ChatInterface] ai_response_complete received but no priceDataReceived');
                  }
                  break;
                
                case 'direct_response':
                  // Direct response (when agent doesn't call tool)
                  // Do NOT clear/update price results - keep existing results visible
                  aiResponseComplete = true;
                  setAiResponseCompleted(true); // Mark AI response as completed
                  
                  // Update message content
                  setMessages(prev => prev.map(msg => 
                    msg.id === loadingMsgId 
                      ? { ...msg, content: data.data.content } 
                      : msg
                  ));
                  
                  // Don't touch onResults - price table stays as-is
                  break;
                  
                case 'error':
                  // Handle error gracefully - don't throw, just display to user
                  aiResponseComplete = true;
                  const errorMessage = data.data.message || 'Unknown error occurred';
                  console.error('Stream error:', errorMessage);
                  
                  setMessages(prev => prev.map(msg => 
                    msg.id === loadingMsgId 
                      ? { ...msg, content: `Error: ${errorMessage}` } 
                      : msg
                  ));
                  break;
              }
            } catch (err) {
              console.error('Error parsing SSE JSON:', err, messageJson);
              // If critical message parsing fails, try to continue but log error
              if (messageJson.includes('"type":"error"')) {
                // Try to extract error info even if JSON parsing fails
                const errorMatch = messageJson.match(/"message"\s*:\s*"([^"]+)"/);
                const errorMsg = errorMatch ? errorMatch[1] : 'Malformed error data from server';
                
                // Display error to user instead of throwing
                aiResponseComplete = true;
                setMessages(prev => prev.map(msg => 
                  msg.id === loadingMsgId 
                    ? { ...msg, content: `Error: ${errorMsg}` } 
                    : msg
                ));
                break; // Exit the inner loop to handle gracefully
              }
            }
          }
        }
      }
      
      // Clear timeout
      clearTimeout(timeoutId);
      
      // If stream ends but no completion message received, finalize processing
      if (!aiResponseComplete && priceDataReceived) {
        console.log('[ChatInterface] Stream ended without completion message - finalizing');
        // Update final message
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
      // Delay setting completion status to let user see complete step list
      // Use setTimeout to ensure execution after state update
      setTimeout(() => {
        setActivityCompleted(true);
      }, 300);
    }
  };

  const handleClearChat = () => {
    setMessages([
      {
        role: 'assistant',
        content: 'Hello! I\'m your Azure Pricing Assistant. I can help you find and compare prices for Azure services across different regions. Ask me about VM costs, storage pricing, or any Azure service pricing.',
        id: 'welcome-message'
      }
    ]);
    setInput('');
    setStreamingResponse('');
    setExecutionSteps([]);
    setVisibleStepsCount(0); // Reset visible step count
    setActivityCompleted(false); // Reset completion status
    setAiResponseCompleted(false); // Reset AI response completion status
    setSessionResponseId(null); // Reset session - next query will be a new session
    onResults({ items: [], filter: '', append: false }); // Clear table for new session
  };

  return (
    <div ref={chatContainerRef} className="flex flex-col backdrop-blur-xl bg-white/95 rounded-xl shadow-2xl overflow-hidden h-full border border-white/20">
      {/* Header with Clear Chat button */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-blue-200/50 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse shadow-lg shadow-cyan-500/50"></div>
          <h3 className="text-sm font-semibold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">Chat</h3>
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
                {/* Show unified activity + response card for the last message when loading, has steps, or streaming */}
                {index === messages.length - 1 && (loading || executionSteps.length > 0 || streamingResponse) ? (
                  <div className="mb-4 flex justify-start">
                    <div className="relative max-w-[85%] mr-auto w-full" style={{ maxWidth: '85%' }}>
                      {/* Unified card with gradient background */}
                      <div className="rounded-2xl shadow-xl bg-gradient-to-br from-white/95 via-blue-50/30 to-cyan-50/40 border border-blue-200/40 backdrop-blur-sm overflow-hidden">
                        
                        {/* Agent Activity Section - always show when there are steps, keep visible during streaming */}
                        {(executionSteps.length > 0 || (loading && msg.content === 'Preparing query...')) && (
                          <div className={`transition-all duration-300 ${streamingResponse ? 'border-b border-blue-200/30' : ''}`}>
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
                              
                              {/* Activity Steps - strictly 3 lines max with scroll, all steps append after initial line */}
                              <div 
                                ref={activityScrollRef}
                                className="agent-activity-scroll overflow-y-auto overflow-x-hidden space-y-0.5"
                                style={{ 
                                  maxHeight: 'calc(3 * 1.75rem)', // Exactly 3 lines
                                }}
                              >
                                {/* Always show initial line first */}
                                <div className="flex items-start text-xs text-gray-700 leading-[1.6] hover:bg-white/50 rounded px-2 py-1.5 -mx-2 transition-all mb-0.5">
                                  <span className={`flex-shrink-0 font-bold text-[10px] mt-1 w-3 ${executionSteps.length === 0 && !activityCompleted ? 'text-cyan-500 animate-pulse' : 'text-green-500'}`}>
                                    {executionSteps.length === 0 && !activityCompleted ? '▸' : '✓'}
                                  </span>
                                  <span className="flex-1 font-medium break-words leading-[1.6]">🚀 Initializing agent...</span>
                                </div>
                                {/* Append all subsequent execution steps */}
                                {executionSteps.slice(0, visibleStepsCount).map((step, idx) => (
                                  <div 
                                    key={idx} 
                                    className="flex items-start text-xs text-gray-700 animate-slideInFromTop leading-[1.6] hover:bg-white/50 rounded px-2 py-1.5 -mx-2 transition-all mb-0.5"
                                  >
                                    <span className={`flex-shrink-0 font-bold text-[10px] mt-1 w-3 ${
                                      idx === visibleStepsCount - 1 && idx === executionSteps.length - 1 && !activityCompleted
                                        ? 'text-cyan-500 animate-pulse' 
                                        : idx === visibleStepsCount - 1 && !activityCompleted
                                        ? 'text-cyan-500 animate-pulse'
                                        : 'text-green-500'
                                    }`}>
                                      {idx === visibleStepsCount - 1 && !activityCompleted ? '▸' : '✓'}
                                    </span>
                                    <span className="flex-1 font-medium break-words leading-[1.6]">{step}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          </div>
                        )}
                        
                        {/* Final Response Section - show when streaming (including final content) */}
                        {streamingResponse && (
                          <div className="p-3.5">
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
                          aiResponseCompleted
                            ? 'bg-green-500'
                            : streamingResponse
                            ? 'bg-cyan-500 animate-pulse'
                            : 'bg-gradient-to-r from-cyan-400 to-blue-500 animate-pulse'
                        }`}></div>
                        <span className="text-gray-500 font-medium bg-gradient-to-r from-gray-600 to-gray-500 bg-clip-text text-transparent">
                          Azure Prices Agent
                        </span>
                        {/* Processing: 推理查询时 (没有流式输出 且 AI 未完成) */}
                        {!streamingResponse && !aiResponseCompleted && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-blue-500/10 text-blue-600 border border-blue-300/30 animate-pulse">
                            Processing...
                          </span>
                        )}
                        {/* Typing: 流式输出时 (有流式输出 且 AI 未完成) */}
                        {streamingResponse && !aiResponseCompleted && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-600 border border-cyan-300/30 animate-pulse">
                            Typing...
                          </span>
                        )}
                        {/* Completed: 输出结束后 (AI 已完成) */}
                        {aiResponseCompleted && (
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
                        <div className={`markdown-content ${typingAnimation && msg.content === 'Preparing query...' ? 'animate-pulse' : ''}`}>
                          {typingAnimation && msg.content === 'Preparing query...' ? (
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
        <div className="flex gap-2 items-end">
          <div className="relative flex-1">
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                // Auto-resize textarea up to 3 lines
                const lineHeight = 24; // Approximate line height in pixels
                const padding = 24; // Total vertical padding (12px top + 12px bottom)
                const maxLines = 3;
                const maxHeight = lineHeight * maxLines + padding;
                
                e.target.style.height = 'auto';
                const newHeight = Math.min(e.target.scrollHeight, maxHeight);
                e.target.style.height = newHeight + 'px';
              }}
              onKeyDown={(e) => {
                // Submit on Enter (without Shift)
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmit(e as unknown as React.FormEvent);
                }
              }}
              placeholder="💬 Ask me anything about Azure pricing..."
              className="w-full p-3 pr-10 border border-gray-300/50 rounded-xl focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 transition-all shadow-lg text-sm md:text-base bg-white/90 backdrop-blur-sm placeholder:text-gray-400 resize-none overflow-y-auto leading-6"
              style={{ minHeight: '48px', maxHeight: '96px' }}
              disabled={loading}
              spellCheck={false}
              autoFocus
              rows={1}
            />
            {input.trim() && !loading && (
              <button 
                type="button"
                onClick={() => {
                  setInput('');
                  // Reset textarea height
                  if (inputRef.current) {
                    (inputRef.current as HTMLTextAreaElement).style.height = '48px';
                  }
                }}
                className="absolute right-3 top-3 text-gray-400 hover:text-gray-600"
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
            className="px-5 py-3 bg-gradient-to-r from-cyan-500 via-blue-500 to-indigo-600 text-white rounded-xl hover:from-cyan-600 hover:via-blue-600 hover:to-indigo-700 disabled:from-blue-300 disabled:to-indigo-400 disabled:cursor-not-allowed transition-all shadow-lg hover:shadow-cyan-500/50 transform hover:scale-105 active:scale-95 flex items-center group flex-shrink-0"
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
            onClick={() => setInput("Which US region offers the lowest price for the D8s v4 VM?")}
            disabled={loading}
            className="text-xs bg-white/90 backdrop-blur-sm py-1 px-2 rounded-full border border-cyan-200/50 text-gray-600 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 hover:border-cyan-300 transition-all shadow-sm hover:shadow-md transform hover:scale-105"
          >
            find cheapest D8s v4
          </button>
          <button 
            type="button" 
            onClick={() => setInput("what is gpt image 1 price in east us 2??")}
            disabled={loading}
            className="text-xs bg-white/90 backdrop-blur-sm py-1 px-2 rounded-full border border-cyan-200/50 text-gray-600 hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 hover:border-cyan-300 transition-all shadow-sm hover:shadow-md transform hover:scale-105"
          >
            price of GPT-Image-1
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