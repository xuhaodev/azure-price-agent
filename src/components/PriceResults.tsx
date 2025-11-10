'use client';

import { PricingItem } from '@/lib/price-api';
import { getRegionDisplayName } from '@/lib/azure-regions';
import { useState, useMemo } from 'react';

type SortField = 'price' | 'product' | 'sku' | 'region' | '';
type SortDirection = 'asc' | 'desc';

export default function PriceResults({ items, height }: { items: PricingItem[], height?: string }) {
  const [sortField, setSortField] = useState<SortField>('price');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [searchTerm, setSearchTerm] = useState('');

  // Sort and filter items - 将 useMemo 移到条件判断之前
  const sortedAndFilteredItems = useMemo(() => {
    if (!items.length) return [];
    
    let filteredItems = items;
    
    // Apply search filter if any
    if (searchTerm.trim()) {
      const lowerSearchTerm = searchTerm.toLowerCase().trim();
      filteredItems = items.filter(item => 
        item.armSkuName?.toLowerCase().includes(lowerSearchTerm) || 
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

  // 早期返回放在 useMemo 之后
  if (!items.length) return null;

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
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 inline-block ml-1">
        <path fillRule="evenodd" d="M10 3a.75.75 0 01.75.75v10.638l3.96-4.158a.75.75 0 111.08 1.04l-5.25 5.5a.75.75 0 01-1.08 0l-5.25-5.5a.75.75 0 111.08-1.04l3.96 4.158V3.75A.75.75 0 0110 3z" clipRule="evenodd" />
      </svg>
    ) : (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 inline-block ml-1">
        <path fillRule="evenodd" d="M10 17a.75.75 0 01-.75-.75V5.612L5.29 9.77a.75.75 0 01-1.08-1.04l5.25-5.5a.75.75 0 011.08 0l5.25 5.5a.75.75 0 11-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0110 17z" clipRule="evenodd" />
      </svg>
    );
  };

  // Download CSV function
  const downloadCSV = () => {
    // Prepare CSV headers
    const headers = ['SKU', 'Price', 'Unit', 'Meter ID', 'Meter Name', 'RI', 'Savings Plan', 'Product', 'Region'];
    
    // Prepare CSV rows
    const rows = sortedAndFilteredItems.map(item => {
      const savingsPlanText = item.savingsPlan && Array.isArray(item.savingsPlan) && item.savingsPlan.length > 0
        ? item.savingsPlan.map(plan => `${plan.term}: $${plan.retailPrice}`).join('; ')
        : '-';
      
      return [
        item.armSkuName || '',
        typeof item.retailPrice === 'number' ? item.retailPrice.toFixed(4) : item.retailPrice,
        item.unitOfMeasure || '',
        item.meterId || '',
        item.meterName || '',
        item.reservationTerm || '-',
        savingsPlanText,
        item.productName || '',
        getRegionDisplayName(item.armRegionName) || ''
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
    <div className="bg-white rounded-2xl shadow-xl overflow-hidden border border-gray-100 flex flex-col" style={{ height: height || 'auto' }}>
      <div className="p-3 border-b border-gray-200 bg-gradient-to-r from-blue-50 to-indigo-50 flex-shrink-0">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-gray-800 flex items-center">
            Price Results 
            <span className="ml-2 text-xs font-medium px-2 py-0.5 bg-blue-100 text-blue-800 rounded-full">
              {sortedAndFilteredItems.length}
            </span>
          </h2>
          
          <div className="relative">
            <input
              type="text"
              placeholder="Filter..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-8 pr-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-400 focus:border-blue-400 w-full sm:w-48"
            />
            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </div>
        </div>
      </div>
      
      <div className="overflow-x-auto overflow-y-auto flex-1">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="sticky top-0 z-10">
            <tr className="bg-gradient-to-r from-gray-50 to-gray-100">
              <th 
                className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200/50 transition-colors"
                style={{ width: '180px', minWidth: '150px' }}
                onClick={() => handleSort('sku')}
              >
                SKU {getSortIcon('sku')}
              </th>
              <th 
                className="px-3 py-2.5 text-right text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200/50 transition-colors"
                style={{ width: '100px', minWidth: '90px' }}
                onClick={() => handleSort('price')}
              >
                Price {getSortIcon('price')}
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider"
                  style={{ width: '80px', minWidth: '70px' }}>
                Unit
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider"
                  style={{ width: '160px', minWidth: '140px' }}>
                Meter ID
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider"
                  style={{ width: '160px', minWidth: '140px' }}>
                Meter Name
              </th>
              <th className="px-3 py-2.5 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider"
                  style={{ width: '60px', minWidth: '50px' }}>
                RI
              </th>
              <th className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider"
                  style={{ width: '100px', minWidth: '90px' }}>
                Savings
              </th>
              <th 
                className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200/50 transition-colors"
                style={{ width: '160px', minWidth: '140px' }}
                onClick={() => handleSort('product')}
              >
                Product {getSortIcon('product')}
              </th>
              <th 
                className="px-3 py-2.5 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider cursor-pointer hover:bg-gray-200/50 transition-colors"
                style={{ width: '120px', minWidth: '100px' }}
                onClick={() => handleSort('region')}
              >
                Region {getSortIcon('region')}
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedAndFilteredItems.map((item, index) => (
              <tr 
                key={index} 
                className={`${
                  index % 2 === 0 ? 'bg-white' : 'bg-gray-50'
                } hover:bg-blue-50 transition-colors`}
              >
                <td className="px-3 py-3 text-xs font-medium text-blue-600" title={item.armSkuName}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '170px' }}>
                    {item.armSkuName}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs font-semibold text-gray-900 text-right tabular-nums whitespace-nowrap">
                  ${typeof item.retailPrice === 'number' ? item.retailPrice.toFixed(4) : item.retailPrice}
                </td>
                <td className="px-3 py-3 text-xs text-gray-600" title={item.unitOfMeasure}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '75px' }}>
                    {item.unitOfMeasure}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-gray-500 font-mono" title={item.meterId}>
                  <div className="whitespace-normal break-all" style={{ maxWidth: '150px', fontSize: '10px' }}>
                    {item.meterId || '-'}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-gray-700" title={item.meterName}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '155px' }}>
                    {item.meterName}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-gray-600 text-center whitespace-nowrap" title={item.reservationTerm || 'Pay-as-you-go'}>
                  {item.reservationTerm || '-'}
                </td>
                <td className="px-3 py-3 text-xs text-gray-700">
                  {item.savingsPlan && Array.isArray(item.savingsPlan) && item.savingsPlan.length > 0 ? (
                    <div className="flex flex-col space-y-0.5">
                      {item.savingsPlan.map((plan, idx) => (
                        <div key={idx} className="text-[10px] whitespace-nowrap">
                          <span className="font-medium text-gray-600">{plan.term}:</span>
                          <span className="ml-1 text-gray-800">${plan.retailPrice}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <span className="text-gray-400">-</span>
                  )}
                </td>
                <td className="px-3 py-3 text-xs text-gray-700" title={item.productName}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '155px' }}>
                    {item.productName}
                  </div>
                </td>
                <td className="px-3 py-3 text-xs text-gray-700 font-medium" title={getRegionDisplayName(item.armRegionName)}>
                  <div className="whitespace-normal break-words" style={{ maxWidth: '115px' }}>
                    {getRegionDisplayName(item.armRegionName)}
                  </div>
                </td>
              </tr>
            ))}
            
            {sortedAndFilteredItems.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-4 text-center text-gray-500 italic">
                  No matching records found. Try adjusting your filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      
      {sortedAndFilteredItems.length > 0 && (
        <div className="border-t border-gray-200 px-3 py-2 bg-gray-50 text-right flex items-center justify-between flex-shrink-0">
          <div className="text-xs text-gray-600">
            {searchTerm && sortedAndFilteredItems.length !== items.length ? 
              `${sortedAndFilteredItems.length} of ${items.length}` : 
              `${items.length} total`}
          </div>
          <div>
            <button 
              onClick={downloadCSV} 
              className="text-xs px-3 py-1 rounded-lg border border-blue-500 bg-blue-500 text-white hover:bg-blue-600 transition-colors flex items-center gap-1.5"
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