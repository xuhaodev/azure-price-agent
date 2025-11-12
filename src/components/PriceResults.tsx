'use client';

import { PricingItem } from '@/lib/price-api';
import { getRegionDisplayName } from '@/lib/azure-regions';
import { useState, useMemo, useRef, useEffect } from 'react';

type SortField = 'price' | 'product' | 'sku' | 'region' | '';
type SortDirection = 'asc' | 'desc';

export default function PriceResults({ items, height }: { items: PricingItem[], height?: string }) {
  const [sortField, setSortField] = useState<SortField>('price');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchTerm, setSearchTerm] = useState('');
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const previousItemsLengthRef = useRef(0);

  // Sort and filter items - move useMemo before conditional check
  const sortedAndFilteredItems = useMemo(() => {
    if (!items.length) return [];
    
    let filteredItems = items;
    
    // Apply search filter if any
    if (searchTerm.trim()) {
      const lowerSearchTerm = searchTerm.toLowerCase().trim();
      filteredItems = items.filter(item => 
        item.armSkuName?.toLowerCase().includes(lowerSearchTerm) || 
        item.meterName?.toLowerCase().includes(lowerSearchTerm) ||
        item.productName?.toLowerCase().includes(lowerSearchTerm) ||
        item.armRegionName?.toLowerCase().includes(lowerSearchTerm) ||
        getRegionDisplayName(item.armRegionName)?.toLowerCase().includes(lowerSearchTerm)
      );
    }
    
    // Apply sorting
    return [...filteredItems].sort((a, b) => {
      if (sortField === 'price') {
        const priceA = typeof a.retailPrice === 'number' ? a.retailPrice : 0;
        const priceB = typeof b.retailPrice === 'number' ? b.retailPrice : 0;
        return sortDirection === 'asc' ? priceA - priceB : priceB - priceA;
      } else if (sortField === 'product') {
        return sortDirection === 'asc' 
          ? (a.productName || '').localeCompare(b.productName || '')
          : (b.productName || '').localeCompare(a.productName || '');
      } else if (sortField === 'sku') {
        return sortDirection === 'asc' 
          ? (a.armSkuName || '').localeCompare(b.armSkuName || '')
          : (b.armSkuName || '').localeCompare(a.armSkuName || '');
      } else if (sortField === 'region') {
        const regionA = getRegionDisplayName(a.armRegionName);
        const regionB = getRegionDisplayName(b.armRegionName);
        return sortDirection === 'asc' 
          ? (regionA || '').localeCompare(regionB || '')
          : (regionB || '').localeCompare(regionA || '');
      }
      return 0;
    });
  }, [items, sortField, sortDirection, searchTerm]);

  // When new content is appended, auto-scroll to bottom to show latest content
  useEffect(() => {
    if (items.length > previousItemsLengthRef.current && tableContainerRef.current) {
      // Use smooth scroll to bottom
      tableContainerRef.current.scrollTo({
        top: tableContainerRef.current.scrollHeight,
        behavior: 'smooth'
      });
    }
    previousItemsLengthRef.current = items.length;
  }, [items.length]);

  // Don't return null - always show the card even when empty

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      // Toggle direction if same field
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      // New field, default to ascending
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Get sorting icon based on current state
  const getSortIcon = (field: SortField) => {
    if (sortField !== field) return null;
    
    return sortDirection === 'asc' ? (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 inline-block">
        <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
      </svg>
    ) : (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 inline-block">
        <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" />
      </svg>
    );
  };

  // Download CSV function
  const downloadCSV = () => {
    // Prepare CSV headers
    const headers = ['SKU', 'Meter Name', 'Product', 'Region', 'Meter ID', 'Price', 'Unit', 'Savings'];
    
    // Prepare CSV rows
    const rows = sortedAndFilteredItems.map(item => {
      let savingsPlanText = '-';
      if (item.type === 'Reservation') {
        savingsPlanText = 'Reservation';
      } else if (item.savingsPlan && Array.isArray(item.savingsPlan) && item.savingsPlan.length > 0) {
        savingsPlanText = item.savingsPlan.map(plan => `${plan.term}: $${plan.retailPrice}`).join('; ');
      }
      
      return [
        item.armSkuName || '',
        item.meterName || '',
        item.productName || '',
        getRegionDisplayName(item.armRegionName) || '',
        item.meterId || '',
        typeof item.retailPrice === 'number' ? item.retailPrice.toFixed(4) : item.retailPrice,
        item.unitOfMeasure || '',
        savingsPlanText
      ];
    });
    
    // Convert to CSV format
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => {
        // Escape cells containing commas, quotes, or newlines
        const cellStr = String(cell);
        if (cellStr.includes(',') || cellStr.includes('"') || cellStr.includes('\n')) {
          return `"${cellStr.replace(/"/g, '""')}"`;
        }
        return cellStr;
      }).join(','))
    ].join('\n');
    
    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `azure-price-results-${new Date().toISOString().slice(0, 10)}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    URL.revokeObjectURL(url);
  };

  return (
    <div className="backdrop-blur-xl bg-white/95 rounded-2xl shadow-2xl overflow-hidden border border-white/20 flex flex-col" style={{ height: height || 'auto' }}>
      <div className="p-3 border-b border-blue-200/50 bg-gradient-to-r from-blue-50/80 to-indigo-50/80 backdrop-blur-sm flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gradient-to-r from-emerald-400 to-cyan-500 animate-pulse shadow-lg shadow-emerald-500/50"></div>
            <h2 className="text-lg font-bold bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent flex items-center">
              Price Results
            </h2>
            <span className="text-xs font-bold px-2.5 py-1 bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-700 rounded-full border border-cyan-300/50 shadow-sm">
              {sortedAndFilteredItems.length}
            </span>
            {sortedAndFilteredItems.length > 0 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 border border-emerald-300/30 font-medium">Live</span>
            )}
          </div>
          
          <div className="relative">
            <input
              type="text"
              placeholder="🔍 Filter results..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 pr-8 py-1.5 text-sm border border-gray-300/50 rounded-lg focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 w-full sm:w-52 bg-white/80 backdrop-blur-sm shadow-sm hover:shadow-md transition-all placeholder:text-gray-400"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-3 top-1/2 transform -translate-y-1/2 text-cyan-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-2.5 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                title="Clear filter"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>
      
      <div ref={tableContainerRef} className="overflow-x-auto overflow-y-auto flex-1">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gradient-to-r from-blue-50 via-indigo-50 to-purple-50 backdrop-blur-sm">
              <th 
                className="px-2 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight cursor-pointer hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all group"
                style={{ width: '120px', minWidth: '110px' }}
                onClick={() => handleSort('sku')}
              >
                <span className="flex items-center gap-0.5">
                  SKU 
                  <span className={sortField === 'sku' ? 'text-cyan-600' : 'text-gray-400 group-hover:text-gray-600'}>
                    {getSortIcon('sku')}
                  </span>
                </span>
              </th>
              <th className="px-2 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight"
                  style={{ width: '115px', minWidth: '105px' }}>
                Meter Name
              </th>
              <th 
                className="px-2 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight cursor-pointer hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all group"
                style={{ width: '115px', minWidth: '105px' }}
                onClick={() => handleSort('product')}
              >
                <span className="flex items-center gap-0.5">
                  Product 
                  <span className={sortField === 'product' ? 'text-cyan-600' : 'text-gray-400 group-hover:text-gray-600'}>
                    {getSortIcon('product')}
                  </span>
                </span>
              </th>
              <th 
                className="px-2 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight cursor-pointer hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all group"
                style={{ width: '95px', minWidth: '90px' }}
                onClick={() => handleSort('region')}
              >
                <span className="flex items-center gap-0.5">
                  Region 
                  <span className={sortField === 'region' ? 'text-cyan-600' : 'text-gray-400 group-hover:text-gray-600'}>
                    {getSortIcon('region')}
                  </span>
                </span>
              </th>
              <th className="px-2 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight"
                  style={{ width: '110px', minWidth: '100px' }}>
                Meter ID
              </th>
              <th 
                className="px-2 py-1.5 text-right text-[10px] font-bold text-gray-700 uppercase tracking-tight cursor-pointer hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all group"
                style={{ width: '70px', minWidth: '65px' }}
                onClick={() => handleSort('price')}
              >
                <span className="flex items-center justify-end gap-0.5">
                  Price 
                  <span className={sortField === 'price' ? 'text-cyan-600' : 'text-gray-400 group-hover:text-gray-600'}>
                    {getSortIcon('price')}
                  </span>
                </span>
              </th>
              <th className="px-1.5 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight"
                  style={{ width: '55px', minWidth: '50px' }}>
                Unit
              </th>
              <th className="px-2 py-1.5 text-left text-[10px] font-bold text-gray-700 uppercase tracking-tight"
                  style={{ width: '90px', minWidth: '85px' }}>
                Savings
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedAndFilteredItems.map((item, index) => (
              <tr 
                key={index} 
                className={`${
                  index % 2 === 0 ? 'bg-white/50' : 'bg-gray-50/50'
                } hover:bg-gradient-to-r hover:from-cyan-50 hover:to-blue-50 transition-all hover:shadow-md`}
              >
                <td className="px-2 py-2 text-[10px] font-medium text-cyan-600 hover:text-blue-700 transition-colors" title={item.armSkuName}>
                  <div className="whitespace-normal break-words font-semibold" style={{ maxWidth: '115px' }}>
                    {item.armSkuName}
                  </div>
                </td>
                <td className="px-2 py-2 text-[10px] text-gray-700 font-medium" title={item.meterName}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '110px' }}>
                    {item.meterName}
                  </div>
                </td>
                <td className="px-2 py-2 text-[10px] text-gray-700 font-medium" title={item.productName}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '110px' }}>
                    {item.productName}
                  </div>
                </td>
                <td className="px-2 py-2 text-[10px] font-semibold" title={getRegionDisplayName(item.armRegionName)}>
                  <div className="whitespace-normal break-words flex items-center gap-0.5" style={{ maxWidth: '92px' }}>
                    <span className="text-[9px]">🌍</span>
                    <span className="text-indigo-700">{getRegionDisplayName(item.armRegionName)}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-[9px] text-gray-500 font-mono" title={item.meterId}>
                  <div className="whitespace-normal break-all bg-gray-50 px-1 py-0.5 rounded border border-gray-200" style={{ maxWidth: '105px' }}>
                    {item.meterId || <span className="text-gray-400">—</span>}
                  </div>
                </td>
                <td className="px-2 py-2 text-[10px] font-bold text-gray-900 text-right tabular-nums whitespace-nowrap">
                  <span className="bg-gradient-to-r from-cyan-600 to-blue-600 bg-clip-text text-transparent">
                    ${typeof item.retailPrice === 'number' ? item.retailPrice.toFixed(4) : item.retailPrice}
                  </span>
                </td>
                <td className="px-1.5 py-2 text-[9px] text-gray-600" title={item.unitOfMeasure}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '53px' }}>
                    <span className="px-1 py-0.5 rounded bg-gray-100 text-gray-700 font-medium text-[9px] border border-gray-200">
                      {item.unitOfMeasure}
                    </span>
                  </div>
                </td>
                <td className="px-2 py-2 text-[9px] text-gray-700">
                  {item.type === 'Reservation' ? (
                    <span className="px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-700 font-semibold border border-purple-300/30 text-[9px] inline-block">Reservation</span>
                  ) : item.savingsPlan && Array.isArray(item.savingsPlan) && item.savingsPlan.length > 0 ? (
                    <div className="flex flex-col space-y-0.5">
                      {item.savingsPlan.map((plan, idx) => (
                        <div key={idx} className="text-[9px] whitespace-nowrap flex items-center gap-0.5">
                          <span className="px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-700 font-semibold border border-emerald-300/30">{plan.term}</span>
                          <span className="font-bold text-emerald-700">${plan.retailPrice}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400 text-center block">—</span>
                  )}
                </td>
              </tr>
            ))}
            
            {sortedAndFilteredItems.length === 0 && (
              <tr>
                <td colSpan={8} className="px-3 py-8 text-center">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-16 h-16 rounded-full bg-gradient-to-br from-gray-100 to-gray-200 flex items-center justify-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                      </svg>
                    </div>
                    <div className="text-sm font-medium text-gray-600">No matching records found</div>
                    <div className="text-xs text-gray-500">Try adjusting your filter or search criteria</div>
                  </div>
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {sortedAndFilteredItems.length > 0 && (
        <div className="border-t border-blue-200/50 px-3 py-2.5 bg-gradient-to-r from-gray-50/80 to-blue-50/80 backdrop-blur-sm text-right flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="text-xs font-semibold text-gray-700 flex items-center gap-1.5">
              {searchTerm && sortedAndFilteredItems.length !== items.length ? (
                <>
                  <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-cyan-500/20 to-blue-500/20 text-cyan-700 border border-cyan-300/50">
                    {sortedAndFilteredItems.length}
                  </span>
                  <span className="text-gray-500">of</span>
                  <span className="px-2 py-0.5 rounded-full bg-gray-200/50 text-gray-600">
                    {items.length}
                  </span>
                </>
              ) : (
                <>
                  <span className="text-gray-500">Total:</span>
                  <span className="px-2 py-0.5 rounded-full bg-gradient-to-r from-emerald-500/20 to-cyan-500/20 text-emerald-700 border border-emerald-300/50">
                    {items.length}
                  </span>
                </>
              )}
            </div>
          </div>
          <div>
            <button 
              onClick={downloadCSV} 
              className="text-xs font-medium px-3 py-1.5 rounded-lg bg-gradient-to-r from-cyan-500 to-blue-600 text-white hover:from-cyan-600 hover:to-blue-700 transition-all shadow-md hover:shadow-lg hover:shadow-cyan-500/50 hover:scale-105 transform active:scale-95 flex items-center gap-1.5 border border-cyan-400/30"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Download CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}