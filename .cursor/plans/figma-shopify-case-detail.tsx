import React, { useState } from 'react';
import { ArrowLeft, MessageSquare, AlertCircle, Calendar, CheckCircle2, Eye, Package, Clock, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';

interface ShopifyCaseDetailProps {
  onNavigate: (path: string) => void;
  caseType?: 'inquiry' | 'dispute';
}

export default function ShopifyCaseDetail({ onNavigate, caseType = 'inquiry' }: ShopifyCaseDetailProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    evidence: true,
    timeline: false,
    order: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const isInquiry = caseType === 'inquiry';

  // Mock data
  const caseData = {
    id: isInquiry ? 'INQ-1234' : 'DIS-5678',
    orderId: '#1234',
    amount: '$125.00',
    customerName: 'John Smith',
    customerEmail: 'john@example.com',
    reason: isInquiry ? 'Customer requesting delivery proof' : 'Product not received',
    receivedAt: '2 hours ago',
    dueDate: isInquiry ? '6 days' : '12 days',
    status: 'pending',
  };

  const evidenceItems = [
    { name: 'Order details', status: 'complete', source: 'Shopify', automatic: true },
    { name: 'Customer details', status: 'complete', source: 'Shopify', automatic: true },
    { name: 'Shipping address', status: 'complete', source: 'Shopify', automatic: true },
    { name: 'Tracking number', status: 'complete', source: 'Shopify', automatic: false },
    { name: 'Delivery confirmation', status: 'missing', source: 'Carrier', automatic: false },
    { name: 'Product images', status: 'complete', source: 'Shopify', automatic: true },
  ];

  const timelineEvents = [
    { time: '2 hours ago', event: isInquiry ? 'Inquiry received from card issuer' : 'Dispute filed by customer', type: 'system' },
    { time: '2 hours ago', event: 'Evidence pack auto-prepared', type: 'system' },
    { time: '2 hours ago', event: 'Case flagged for merchant review', type: 'system' },
  ];

  const completenessPercentage = Math.round((evidenceItems.filter(i => i.status === 'complete').length / evidenceItems.length) * 100);

  return (
    <div className="max-w-[1200px]">
      {/* Back Button */}
      <button 
        onClick={() => onNavigate('/shopify/cases')}
        className="flex items-center gap-2 text-sm text-[#005BD3] hover:text-[#004C9B] mb-4 font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to cases
      </button>

      {/* Case Header */}
      <div className="bg-white border border-[#C9CCCF] rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className={`w-12 h-12 rounded-lg flex items-center justify-center ${
              isInquiry ? 'bg-[#E0F2FE]' : 'bg-[#FEE2E2]'
            }`}>
              {isInquiry ? (
                <MessageSquare className="w-6 h-6 text-[#075985]" />
              ) : (
                <AlertCircle className="w-6 h-6 text-[#991B1B]" />
              )}
            </div>

            {/* Title & Meta */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-xl font-semibold text-[#202223]">
                  {isInquiry ? 'Inquiry' : 'Dispute'} for Order {caseData.orderId}
                </h1>
                <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full ${
                  isInquiry ? 'bg-[#E0F2FE] text-[#075985]' : 'bg-[#FEE2E2] text-[#991B1B]'
                }`}>
                  {isInquiry ? (
                    <MessageSquare className="w-3.5 h-3.5" />
                  ) : (
                    <AlertCircle className="w-3.5 h-3.5" />
                  )}
                  <span className="text-xs font-medium">{isInquiry ? 'Inquiry' : 'Dispute'}</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-[#6D7175] mb-3">
                <span className="font-medium text-[#202223]">{caseData.amount}</span>
                <span>•</span>
                <span>{caseData.customerName} ({caseData.customerEmail})</span>
                <span>•</span>
                <span>Received {caseData.receivedAt}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FEF3C7] border border-[#FDE047] rounded-lg inline-flex">
                <Clock className="w-4 h-4 text-[#92400E]" />
                <span className="text-sm font-medium text-[#92400E]">Due in {caseData.dueDate}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-[#C9CCCF] rounded-lg text-sm font-medium text-[#202223] hover:bg-[#F6F6F7] transition-colors">
              Save draft
            </button>
            <button className="px-4 py-2 bg-[#005BD3] text-white rounded-lg text-sm font-medium hover:bg-[#004C9B] transition-colors">
              {isInquiry ? 'Respond to inquiry' : 'Submit evidence'}
            </button>
          </div>
        </div>

        {/* Reason */}
        <div className="pt-4 border-t border-[#E1E3E5]">
          <div className="text-xs font-medium text-[#6D7175] mb-1">
            {isInquiry ? 'Inquiry reason' : 'Dispute reason'}
          </div>
          <div className="text-sm text-[#202223]">{caseData.reason}</div>
        </div>

        {/* Info Callout specific to type */}
        <div className={`mt-4 p-3 rounded-lg border ${
          isInquiry 
            ? 'bg-[#E0F2FE] border-[#7DD3FC]' 
            : 'bg-[#FEF3C7] border-[#FDE047]'
        }`}>
          <div className="flex gap-2">
            {isInquiry ? (
              <MessageSquare className="w-4 h-4 text-[#075985] flex-shrink-0 mt-0.5" />
            ) : (
              <AlertCircle className="w-4 h-4 text-[#92400E] flex-shrink-0 mt-0.5" />
            )}
            <div className={`text-xs ${isInquiry ? 'text-[#075985]' : 'text-[#92400E]'}`}>
              {isInquiry ? (
                <>
                  <strong className="font-medium">This is not yet a full chargeback.</strong> Responding quickly with clear evidence can prevent escalation to a formal dispute.
                </>
              ) : (
                <>
                  <strong className="font-medium">Review before submitting.</strong> Make sure all required evidence is complete and accurate. You cannot edit after submission.
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content - Left 2 columns */}
        <div className="col-span-2 space-y-6">
          {/* Evidence Section */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('evidence')}
              className="w-full px-6 py-4 flex items-center justify-between border-b border-[#E1E3E5] hover:bg-[#F6F6F7] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-[#6D7175]" />
                <div className="text-left">
                  <h2 className="text-sm font-semibold text-[#202223]">Evidence</h2>
                  <p className="text-xs text-[#6D7175]">{completenessPercentage}% complete</p>
                </div>
              </div>
              {expandedSections.evidence ? (
                <ChevronUp className="w-5 h-5 text-[#6D7175]" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#6D7175]" />
              )}
            </button>

            {expandedSections.evidence && (
              <div className="p-6">
                {/* Completeness Bar */}
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-medium text-[#6D7175]">Evidence completeness</span>
                    <span className="text-xs font-medium text-[#202223]">{completenessPercentage}%</span>
                  </div>
                  <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#22C55E] transition-all duration-500 rounded-full"
                      style={{ width: `${completenessPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {/* Evidence Items */}
                <div className="space-y-3">
                  {evidenceItems.map((item, index) => (
                    <div 
                      key={index}
                      className={`p-3 rounded-lg border transition-colors ${
                        item.status === 'complete' 
                          ? 'border-[#D1FAE5] bg-[#F0FDF4]' 
                          : 'border-[#FEF3C7] bg-[#FFFBEB]'
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        {item.status === 'complete' ? (
                          <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0 mt-0.5" />
                        ) : (
                          <AlertCircle className="w-5 h-5 text-[#F59E0B] flex-shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1">
                          <div className="flex items-center gap-2 mb-1">
                            <span className="text-sm font-medium text-[#202223]">{item.name}</span>
                            {item.automatic && (
                              <span className="px-2 py-0.5 bg-[#DBEAFE] text-[#1E40AF] text-xs font-medium rounded-full">
                                Automatic
                              </span>
                            )}
                            <span className="px-2 py-0.5 bg-[#F1F5F9] text-[#475569] text-xs font-medium rounded-full">
                              {item.source}
                            </span>
                          </div>
                          <div className={`text-xs ${
                            item.status === 'complete' ? 'text-[#065F46]' : 'text-[#92400E]'
                          }`}>
                            {item.status === 'complete' ? 'Ready for submission' : 'Missing or incomplete'}
                          </div>
                        </div>
                        {item.status === 'complete' && (
                          <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
                            View
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Order Details Section */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('order')}
              className="w-full px-6 py-4 flex items-center justify-between border-b border-[#E1E3E5] hover:bg-[#F6F6F7] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-[#6D7175]" />
                <h2 className="text-sm font-semibold text-[#202223]">Order details</h2>
              </div>
              {expandedSections.order ? (
                <ChevronUp className="w-5 h-5 text-[#6D7175]" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#6D7175]" />
              )}
            </button>

            {expandedSections.order && (
              <div className="p-6">
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Order number</div>
                    <div className="text-[#202223]">{caseData.orderId}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Order amount</div>
                    <div className="text-[#202223]">{caseData.amount}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Customer</div>
                    <div className="text-[#202223]">{caseData.customerName}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Email</div>
                    <div className="text-[#202223]">{caseData.customerEmail}</div>
                  </div>
                </div>
                <button className="mt-4 flex items-center gap-2 text-sm text-[#005BD3] hover:text-[#004C9B] font-medium">
                  <ExternalLink className="w-4 h-4" />
                  View full order in Shopify
                </button>
              </div>
            )}
          </div>

          {/* Activity Timeline */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('timeline')}
              className="w-full px-6 py-4 flex items-center justify-between border-b border-[#E1E3E5] hover:bg-[#F6F6F7] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-[#6D7175]" />
                <h2 className="text-sm font-semibold text-[#202223]">Activity timeline</h2>
              </div>
              {expandedSections.timeline ? (
                <ChevronUp className="w-5 h-5 text-[#6D7175]" />
              ) : (
                <ChevronDown className="w-5 h-5 text-[#6D7175]" />
              )}
            </button>

            {expandedSections.timeline && (
              <div className="p-6">
                <div className="space-y-4">
                  {timelineEvents.map((event, index) => (
                    <div key={index} className="flex gap-3">
                      <div className="w-2 h-2 rounded-full bg-[#3B82F6] mt-1.5 flex-shrink-0"></div>
                      <div className="flex-1">
                        <div className="text-sm text-[#202223]">{event.event}</div>
                        <div className="text-xs text-[#6D7175] mt-0.5">{event.time}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Right column */}
        <div className="space-y-6">
          {/* Recommended Action */}
          <div className="bg-[#E0E7FF] border border-[#C7D2FE] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Eye className="w-5 h-5 text-[#3730A3] flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-[#3730A3] mb-1">Recommended</h3>
                <p className="text-xs text-[#3730A3] mb-3">
                  {isInquiry 
                    ? 'Review evidence and respond within 6 days to prevent escalation.'
                    : 'Review all evidence for completeness before submitting to maximize win rate.'}
                </p>
                <button className="text-xs text-[#3730A3] font-medium hover:underline">
                  Learn more
                </button>
              </div>
            </div>
          </div>

          {/* Case Info */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#202223] mb-3">Case information</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Case ID</div>
                <div className="text-[#202223] font-mono text-xs">{caseData.id}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Type</div>
                <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full ${
                  isInquiry ? 'bg-[#E0F2FE] text-[#075985]' : 'bg-[#FEE2E2] text-[#991B1B]'
                }`}>
                  {isInquiry ? (
                    <MessageSquare className="w-3 h-3" />
                  ) : (
                    <AlertCircle className="w-3 h-3" />
                  )}
                  <span className="text-xs font-medium">{isInquiry ? 'Inquiry' : 'Dispute'}</span>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Received</div>
                <div className="text-[#202223]">{caseData.receivedAt}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Deadline</div>
                <div className="flex items-center gap-1.5 text-[#F59E0B] font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{caseData.dueDate}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Help */}
          <div className="bg-[#F6F6F7] border border-[#E1E3E5] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#202223] mb-2">Need help?</h3>
            <p className="text-xs text-[#6D7175] mb-3">
              Get guidance on responding to {isInquiry ? 'inquiries' : 'disputes'} and maximizing your win rate.
            </p>
            <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
              View help docs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
