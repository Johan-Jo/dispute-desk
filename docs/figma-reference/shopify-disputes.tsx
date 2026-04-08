import React, { useState } from 'react';
import { FileText, Search, Filter, Download, ChevronRight } from 'lucide-react';

interface ShopifyDisputesProps {
  onNavigate?: (path: string) => void;
}

export default function ShopifyDisputes({ onNavigate }: ShopifyDisputesProps) {
  const [searchQuery, setSearchQuery] = useState('');

  const disputes = [
    { id: 'DP-2401', orderId: '#1234', reason: 'Fraudulent', amount: '$145.00', status: 'In Review', date: 'Mar 12, 2026', dueDate: 'Mar 19, 2026' },
    { id: 'DP-2402', orderId: '#1235', reason: 'Product not received', amount: '$89.50', status: 'Won', date: 'Mar 11, 2026', dueDate: 'Mar 18, 2026' },
    { id: 'DP-2403', orderId: '#1236', reason: 'Product issue', amount: '$312.00', status: 'In Review', date: 'Mar 10, 2026', dueDate: 'Mar 17, 2026' },
    { id: 'DP-2404', orderId: '#1237', reason: 'Fraudulent', amount: '$67.99', status: 'Open', date: 'Mar 9, 2026', dueDate: 'Mar 16, 2026' },
    { id: 'DP-2405', orderId: '#1238', reason: 'Not as described', amount: '$234.50', status: 'Lost', date: 'Mar 8, 2026', dueDate: 'Mar 15, 2026' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#202223] mb-2">Disputes</h1>
        <p className="text-sm text-[#6D7175]">
          View and manage all your chargebacks and disputes
        </p>
      </div>

      {/* Actions Bar */}
      <div className="bg-white border border-[#E1E3E5] rounded-lg p-4 mb-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#6D7175]" />
            <input
              type="text"
              placeholder="Search disputes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-[#E1E3E5] rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#1D4ED8] focus:border-transparent"
            />
          </div>
          <button className="flex items-center gap-2 px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-[#F7F8FA] transition-colors">
            <Filter className="w-4 h-4" />
            Filter
          </button>
          <button className="flex items-center gap-2 px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-[#F7F8FA] transition-colors">
            <Download className="w-4 h-4" />
            Export
          </button>
        </div>
      </div>

      {/* Disputes Table */}
      <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#F7F8FA] border-b border-[#E1E3E5]">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  Dispute ID
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  Order
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  Reason
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  Amount
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  Status
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  Due Date
                </th>
                <th className="px-5 py-3 text-left text-xs font-medium text-[#6D7175] uppercase tracking-wider">
                  
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E1E3E5]">
              {disputes.map((dispute) => (
                <tr key={dispute.id} className="hover:bg-[#F7F8FA] transition-colors">
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="text-sm font-semibold text-[#202223]">{dispute.id}</span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="text-sm text-[#1D4ED8] hover:underline cursor-pointer">{dispute.orderId}</span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="text-sm text-[#6D7175]">{dispute.reason}</span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="text-sm font-medium text-[#202223]">{dispute.amount}</span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className={`px-2 py-1 rounded-md text-xs font-medium ${
                      dispute.status === 'Won' 
                        ? 'bg-[#D1FAE5] text-[#065F46]'
                        : dispute.status === 'Lost'
                        ? 'bg-[#FEE2E2] text-[#991B1B]'
                        : dispute.status === 'In Review'
                        ? 'bg-[#FFF4E5] text-[#92400E]'
                        : 'bg-[#E1E3E5] text-[#202223]'
                    }`}>
                      {dispute.status}
                    </span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap">
                    <span className="text-sm text-[#6D7175]">{dispute.dueDate}</span>
                  </td>
                  <td className="px-5 py-4 whitespace-nowrap text-right">
                    <button
                      onClick={() => onNavigate && onNavigate(`/shopify/disputes/${dispute.id}`)}
                      className="text-[#1D4ED8] hover:text-[#1e40af] transition-colors"
                    >
                      <ChevronRight className="w-5 h-5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
