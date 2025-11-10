'use client';

import { useState, useEffect } from 'react';
import { PricingItem } from '@/lib/price-api';
import ChatInterface from '@/components/ChatInterface';
import PriceResults from '@/components/PriceResults';
import Image from 'next/image';

export default function Home() {
  const [results, setResults] = useState<PricingItem[]>([]);
  const [chatHeight, setChatHeight] = useState('450px');

  // 根据屏幕高度动态调整聊天框高度
  useEffect(() => {
    const updateChatHeight = () => {
      const vh = window.innerHeight;
      // 为聊天框分配更合理的高度，基于屏幕高度的百分比而不是固定值
      // 保留顶部标题区域和底部边距的空间
      const headerHeight = 80; // 标题区域估计高度
      const bottomMargin = 20; // 底部边距
      const availableHeight = vh - headerHeight - bottomMargin;
      
      // 确保聊天窗口有足够但不过大的高度
      const minHeight = 320;
      const maxHeight = 700;
      const calculatedHeight = Math.max(minHeight, Math.min(maxHeight, availableHeight * 0.85));
      
      setChatHeight(`${calculatedHeight}px`);
    };

    // 初始化和窗口大小改变时更新高度
    updateChatHeight();
    window.addEventListener('resize', updateChatHeight);
    return () => window.removeEventListener('resize', updateChatHeight);
  }, []);

  const handleResults = ({items, filter, append = false}: {items: PricingItem[], filter: string, append?: boolean}) => {
    if (append) {
      // 追加模式：将新数据添加到现有结果
      setResults(prev => [...prev, ...items]);
    } else {
      // 替换模式：清空并设置新数据
      setResults(items);
    }
    console.log('OData Query Filter:', filter, `(${append ? 'appended' : 'replaced'} ${items.length} items)`);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-blue-50 via-indigo-50 to-purple-50 py-3 px-4 md:py-4">
      <div className="w-full mx-auto">
        {/* 紧凑化的标题区域 */}
        <div className="relative bg-white rounded-2xl shadow-lg overflow-hidden mb-4">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-600/5 to-purple-600/5 z-0"></div>
          
          <div className="relative z-10 p-3 md:p-4">
            {/* 更紧凑的顶部布局，结合标题和图标 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-1">
                  <div className="rounded-full bg-gradient-to-r from-blue-500 to-purple-600 p-0.5 z-10">
                    <div className="bg-white rounded-full p-1">
                      <Image src="/globe.svg" alt="Azure" width={18} height={18} className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="rounded-full bg-gradient-to-r from-purple-500 to-blue-600 p-0.5 z-0">
                    <div className="bg-white rounded-full p-1">
                      <Image src="/window.svg" alt="Azure" width={18} height={18} className="w-4 h-4" />
                    </div>
                  </div>
                </div>
                <h1 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-purple-700">
                  Azure Price Agent
                </h1>
              </div>
              
              {/* 更紧凑的链接区 */}
              <div className="flex items-center text-xs gap-3">
                <a href="https://prices.azure.com/api/retail/prices?api-version=2023-01-01-preview" 
                   className="flex items-center hover:text-blue-600 transition-colors" 
                   target="_blank" 
                   rel="noopener noreferrer">
                  <svg className="w-3 h-3 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                  </svg>
                  API
                </a>
                
                <a href="https://github.com/xuhaoruins/azurepricesearch" 
                   className="flex items-center hover:text-blue-600 transition-colors"
                   target="_blank" 
                   rel="noopener noreferrer">
                  <svg className="w-3 h-3 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                  </svg>
                  GitHub
                </a>
              </div>
            </div>
            
            {/* 短小介绍线 */}
            <p className="text-xs text-gray-600 mb-2">
              Search prices, meter IDs, compare options, and more — powered by Agentic AI with Azure OpenAI Response API & GPT-5-codex
            </p>
          </div>
        </div>
        
        {/* Chat interface and results in the same row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Results section - takes 7 columns on large screens, now on the left */}
          <div className={`lg:col-span-7 transition-opacity duration-300 ${results.length > 0 ? 'opacity-100' : 'opacity-0'}`}>
            {results.length > 0 && <PriceResults items={results} height={chatHeight} />}
          </div>
          
          {/* Chat interface - takes 5 columns on large screens, now on the right */}
          <div className="lg:col-span-5">
            <div 
              style={{ height: chatHeight }} 
              className="rounded-xl overflow-hidden border border-gray-200 shadow-lg transition-all"
            >
              <ChatInterface onResults={handleResults} />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
