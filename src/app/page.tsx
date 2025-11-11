'use client';

import { useState, useEffect } from 'react';
import { PricingItem } from '@/lib/price-api';
import ChatInterface from '@/components/ChatInterface';
import PriceResults from '@/components/PriceResults';
import Image from 'next/image';

export default function Home() {
  const [results, setResults] = useState<PricingItem[]>([]);
  const [chatHeight, setChatHeight] = useState('450px');

  // Dynamically adjust card height based on screen height, fully responsive
  useEffect(() => {
    const updateChatHeight = () => {
      const vh = window.innerHeight;
      // Calculate available height: viewport height - header area - top padding - bottom padding - gap
      const headerHeight = 120; // Actual header area height (including padding and margin)
      const topPadding = 12; // py-3 = 12px
      const bottomPadding = 12;
      const gap = 16; // gap-4 = 16px
      const availableHeight = vh - headerHeight - topPadding - bottomPadding - gap;
      
      // Set minimum height to ensure basic usability
      const minHeight = 400;
      const calculatedHeight = Math.max(minHeight, availableHeight);
      
      setChatHeight(`${calculatedHeight}px`);
    };

    // Initialize and update height on window resize
    updateChatHeight();
    window.addEventListener('resize', updateChatHeight);
    return () => window.removeEventListener('resize', updateChatHeight);
  }, []);

  const handleResults = ({items, filter, append = false}: {items: PricingItem[], filter: string, append?: boolean}) => {
    if (append) {
      // Append mode: accumulate results in same session
      setResults(prev => [...prev, ...items]);
    } else {
      // Replace mode: new session starts, clear and set new data
      setResults(items);
    }
    console.log('OData Query Filter:', filter, `(${append ? 'appended' : 'replaced'} ${items.length} items)`);
  };

  return (
    <main className="min-h-screen bg-gradient-to-br from-slate-900 via-blue-900 to-indigo-900 py-3 px-4 md:py-4 relative overflow-hidden">
      {/* 背景动画效果 */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-0 -left-4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob"></div>
        <div className="absolute top-0 -right-4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-2000"></div>
        <div className="absolute -bottom-8 left-20 w-96 h-96 bg-indigo-500 rounded-full mix-blend-multiply filter blur-3xl opacity-20 animate-blob animation-delay-4000"></div>
      </div>
      
      <div className="w-full mx-auto relative z-10">
        {/* 紧凑化的标题区域 - 玻璃态设计 */}
        <div className="relative backdrop-blur-xl bg-white/10 rounded-2xl shadow-2xl overflow-hidden mb-4 border border-white/20">
          <div className="absolute inset-0 bg-gradient-to-br from-blue-500/10 via-purple-500/10 to-pink-500/10 z-0"></div>
          
          <div className="relative z-10 p-3 md:p-4">
            {/* 更紧凑的顶部布局，结合标题和图标 */}
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <div className="flex -space-x-1">
                  <div className="rounded-full bg-gradient-to-r from-cyan-400 to-blue-500 p-0.5 z-10 shadow-lg shadow-cyan-500/50 animate-pulse-glow">
                    <div className="bg-white rounded-full p-1">
                      <Image src="/globe.svg" alt="Azure" width={18} height={18} className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="rounded-full bg-gradient-to-r from-purple-400 to-indigo-500 p-0.5 z-0 shadow-lg shadow-purple-500/50 animate-pulse-glow animation-delay-2000">
                    <div className="bg-white rounded-full p-1">
                      <Image src="/window.svg" alt="Azure" width={18} height={18} className="w-4 h-4" />
                    </div>
                  </div>
                </div>
                <h1 className="text-xl md:text-2xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-cyan-300 via-blue-400 to-purple-400 drop-shadow-lg">
                  Azure Prices Agent —— an agentic approach for Azure Retail Prices API
                </h1>
              </div>
              
              {/* 更紧凑的链接区 */}
              <div className="flex items-center text-xs gap-3 text-gray-200">
                <a href="https://learn.microsoft.com/en-us/rest/api/cost-management/retail-prices/azure-retail-prices" 
                   className="flex items-center hover:text-cyan-300 transition-all hover:scale-110" 
                   target="_blank" 
                   rel="noopener noreferrer">
                  <svg className="w-3 h-3 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                  </svg>
                  API
                </a>
                
                <a href="https://github.com/xuhaoruins/azurepricesearch" 
                   className="flex items-center hover:text-cyan-300 transition-all hover:scale-110"
                   target="_blank" 
                   rel="noopener noreferrer">
                  <svg className="w-3 h-3 mr-1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
                  </svg>
                  GitHub
                </a>
                
                <span className="text-gray-400">|</span>
                
                <a href="mailto:haxu@microsoft.com" 
                   className="flex items-center hover:text-cyan-300 transition-all hover:scale-110"
                   title="Business Contact">
                  <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z"></path>
                    <polyline points="22,6 12,13 2,6"></polyline>
                  </svg>
                </a>
                
                <a href="mailto:xuhaoruins@hotmail.com" 
                   className="flex items-center hover:text-purple-300 transition-all hover:scale-110"
                   title="Personal Contact">
                  <svg className="w-3 h-3" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="4"></circle>
                    <path d="M16 8v5a3 3 0 0 0 6 0v-1a10 10 0 1 0-3.92 7.94"></path>
                  </svg>
                </a>
              </div>
            </div>
            
            {/* 短小介绍线 */}
            <p className="text-xs text-gray-300 mb-2">
              Find prices, meters, compare options, estimate costs and more — built with GitHub Copilot and powered by Azure AI Foundry, and Azure WebApp
            </p>
          </div>
        </div>
        
        {/* Chat interface and results in the same row */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          {/* Results section - takes 7 columns on large screens, now on the left */}
          <div className="lg:col-span-7">
            <PriceResults items={results} height={chatHeight} />
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
