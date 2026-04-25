import React, { useState } from 'react';
import { ArrowLeft, MessageSquare, Calendar, CheckCircle2, Package, Clock, ExternalLink, ChevronDown, ChevronUp, AlertCircle, Send } from 'lucide-react';

interface ShopifyInquiryDetailProps {
  onNavigate: (path: string) => void;
}

export default function ShopifyInquiryDetail({ onNavigate }: ShopifyInquiryDetailProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    evidence: true,
    timeline: false,
    order: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Mock data for inquiry
  const inquiryData = {
    id: 'INQ-1234',
    orderId: '#1234',
    amount: '$125.00',
    customerName: 'John Smith',
    customerEmail: 'john@example.com',
    reason: 'Customer requesting delivery proof',
    receivedAt: '2 hours ago',
    dueDate: '6 days',
    status: 'pending',
  };

  const evidenceItems = [
    { name: 'Order confirmation', status: 'complete', source: 'Shopify', automatic: true },
    { name: 'Customer email', status: 'complete', source: 'Shopify', automatic: true },
    { name: 'Shipping address', status: 'complete', source: 'Shopify', automatic: true },
    { name: 'Tracking number', status: 'complete', source: 'Shipping carrier', automatic: false },
    { name: 'Delivery confirmation', status: 'missing', source: 'Shipping carrier', automatic: false },
    { name: 'Delivery signature', status: 'missing', source: 'Shipping carrier', automatic: false },
  ];

  const completenessPercentage = Math.round((evidenceItems.filter(i => i.status === 'complete').length / evidenceItems.length) * 100);

  return (
    <div className="max-w-[1200px]">
      {/* Back Button */}
      <button 
        onClick={() => onNavigate('/shopify/disputes')}
        className="flex items-center gap-2 text-sm text-[#005BD3] hover:text-[#004C9B] mb-4 font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to disputes
      </button>

      {/* Inquiry Header - Lighter tone */}
      <div className="bg-gradient-to-br from-[#E0F2FE] to-white border border-[#7DD3FC] rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className="w-12 h-12 rounded-lg bg-white border border-[#7DD3FC] flex items-center justify-center shadow-sm">
              <MessageSquare className="w-6 h-6 text-[#0284C7]" />
            </div>

            {/* Title & Meta */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-xl font-semibold text-[#0C4A6E]">
                  Inquiry for Order {inquiryData.orderId}
                </h1>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#7DD3FC]">
                  <MessageSquare className="w-3.5 h-3.5 text-[#0284C7]" />
                  <span className="text-xs font-medium text-[#0284C7]">Inquiry</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-[#0C4A6E]/70 mb-3">
                <span className="font-medium text-[#0C4A6E]">{inquiryData.amount}</span>
                <span>•</span>
                <span>{inquiryData.customerName} ({inquiryData.customerEmail})</span>
                <span>•</span>
                <span>Received {inquiryData.receivedAt}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FFFBEB] border border-[#FDE047] rounded-lg inline-flex">
                <Clock className="w-4 h-4 text-[#92400E]" />
                <span className="text-sm font-medium text-[#92400E]">Respond within {inquiryData.dueDate}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-[#C9CCCF] bg-white rounded-lg text-sm font-medium text-[#202223] hover:bg-[#F6F6F7] transition-colors">
              Save draft
            </button>
            <button className="px-4 py-2 bg-[#0284C7] text-white rounded-lg text-sm font-medium hover:bg-[#0369A1] transition-colors flex items-center gap-2">
              <Send className="w-4 h-4" />
              Send response
            </button>
          </div>
        </div>

        {/* Reason */}
        <div className="pt-4 border-t border-[#7DD3FC]/30">
          <div className="text-xs font-medium text-[#0C4A6E]/60 mb-1">Inquiry reason</div>
          <div className="text-sm text-[#0C4A6E]">{inquiryData.reason}</div>
        </div>

        {/* Info Callout - Inquiry specific */}
        <div className="mt-4 p-3 rounded-lg bg-white border border-[#7DD3FC]">
          <div className="flex gap-2">
            <MessageSquare className="w-4 h-4 text-[#0284C7] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-[#0C4A6E]">
              <strong className="font-medium">This is not a chargeback yet.</strong> Card issuers send inquiries when cardholders have questions. Responding quickly with clear evidence often prevents escalation to a formal dispute. Fast response = prevention.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content - Left 2 columns */}
        <div className="col-span-2 space-y-6">
          {/* Response Template */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg overflow-hidden">
            <div className="px-6 py-4 border-b border-[#E1E3E5] bg-[#F6F6F7]">
              <h2 className="text-sm font-semibold text-[#202223]">Response</h2>
              <p className="text-xs text-[#6D7175] mt-0.5">Draft your response with supporting evidence</p>
            </div>
            <div className="p-6">
              <textarea
                className="w-full min-h-[120px] px-3 py-2 border border-[#C9CCCF] rounded-lg text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#0284C7] focus:border-transparent"
                placeholder="Explain why this transaction is valid and provide context for the evidence below..."
                defaultValue="This order was successfully delivered to the customer's verified shipping address. We have tracking confirmation showing delivery on [date]. The customer's signature was obtained upon delivery."
              />
              <div className="mt-3 flex items-center gap-2 text-xs text-[#6D7175]">
                <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
                <span>Auto-drafted based on your evidence pack template</span>
              </div>
            </div>
          </div>

          {/* Evidence Section */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg overflow-hidden">
            <button
              onClick={() => toggleSection('evidence')}
              className="w-full px-6 py-4 flex items-center justify-between border-b border-[#E1E3E5] hover:bg-[#F6F6F7] transition-colors"
            >
              <div className="flex items-center gap-3">
                <Package className="w-5 h-5 text-[#6D7175]" />
                <div className="text-left">
                  <h2 className="text-sm font-semibold text-[#202223]">Supporting evidence</h2>
                  <p className="text-xs text-[#6D7175]">{completenessPercentage}% complete · 2 items missing</p>
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
                      className="h-full bg-[#F59E0B] transition-all duration-500 rounded-full"
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
                          : 'border-[#FED7AA] bg-[#FFF7ED]'
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
                                Auto-collected
                              </span>
                            )}
                            <span className="px-2 py-0.5 bg-[#F1F5F9] text-[#475569] text-xs font-medium rounded-full">
                              {item.source}
                            </span>
                          </div>
                          <div className={`text-xs ${
                            item.status === 'complete' ? 'text-[#065F46]' : 'text-[#92400E]'
                          }`}>
                            {item.status === 'complete' ? 'Included in response' : 'Missing - may weaken response'}
                          </div>
                        </div>
                        {item.status === 'complete' ? (
                          <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
                            View
                          </button>
                        ) : (
                          <button className="text-xs text-[#0284C7] hover:text-[#0369A1] font-medium">
                            Add
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
                    <div className="text-[#202223]">{inquiryData.orderId}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Order amount</div>
                    <div className="text-[#202223]">{inquiryData.amount}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Customer</div>
                    <div className="text-[#202223]">{inquiryData.customerName}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Email</div>
                    <div className="text-[#202223]">{inquiryData.customerEmail}</div>
                  </div>
                </div>
                <button className="mt-4 flex items-center gap-2 text-sm text-[#005BD3] hover:text-[#004C9B] font-medium">
                  <ExternalLink className="w-4 h-4" />
                  View full order in Shopify
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Right column */}
        <div className="space-y-6">
          {/* Recommended Action */}
          <div className="bg-[#E0F2FE] border border-[#7DD3FC] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <MessageSquare className="w-5 h-5 text-[#0284C7] flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-[#0C4A6E] mb-1">Quick response recommended</h3>
                <p className="text-xs text-[#0C4A6E] mb-3">
                  Responding within 6 days with clear evidence prevents escalation to a full chargeback. The faster you respond, the better.
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-[#0C4A6E]">
                    <div className="w-1 h-1 rounded-full bg-[#0284C7]"></div>
                    <span>Review auto-drafted response</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#0C4A6E]">
                    <div className="w-1 h-1 rounded-full bg-[#0284C7]"></div>
                    <span>Add missing evidence if available</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#0C4A6E]">
                    <div className="w-1 h-1 rounded-full bg-[#0284C7]"></div>
                    <span>Send response to prevent escalation</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Inquiry Info */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#202223] mb-3">Inquiry information</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Inquiry ID</div>
                <div className="text-[#202223] font-mono text-xs">{inquiryData.id}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Type</div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#E0F2FE] text-[#0284C7]">
                  <MessageSquare className="w-3 h-3" />
                  <span className="text-xs font-medium">Inquiry</span>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Received</div>
                <div className="text-[#202223]">{inquiryData.receivedAt}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Response deadline</div>
                <div className="flex items-center gap-1.5 text-[#F59E0B] font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{inquiryData.dueDate}</span>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Possible outcomes</div>
                <div className="space-y-1 mt-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
                    <span className="text-[#202223]">Responded & prevented</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <AlertCircle className="w-3 h-3 text-[#EF4444]" />
                    <span className="text-[#202223]">Escalated to dispute</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Help */}
          <div className="bg-[#F6F6F7] border border-[#E1E3E5] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#202223] mb-2">Need help?</h3>
            <p className="text-xs text-[#6D7175] mb-3">
              Learn best practices for responding to inquiries and preventing escalation.
            </p>
            <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
              View inquiry guide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}