import React, { useState } from 'react';
import { ArrowLeft, AlertCircle, Calendar, CheckCircle2, Package, Clock, ExternalLink, ChevronDown, ChevronUp, XCircle, FileText, Shield } from 'lucide-react';

interface ShopifyDisputeDetailProps {
  onNavigate: (path: string) => void;
}

export default function ShopifyDisputeDetail({ onNavigate }: ShopifyDisputeDetailProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    evidence: true,
    timeline: false,
    order: false,
  });

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Mock data for dispute
  const disputeData = {
    id: 'DIS-5678',
    orderId: '#1235',
    amount: '$450.00',
    customerName: 'Emily Chen',
    customerEmail: 'emily@example.com',
    reason: 'Product not received',
    disputeReason: 'Fraudulent',
    receivedAt: '1 day ago',
    dueDate: '12 days',
    status: 'needs-review',
  };

  const evidenceItems = [
    { name: 'Order details', status: 'complete', source: 'Shopify', automatic: true, required: true },
    { name: 'Customer information', status: 'complete', source: 'Shopify', automatic: true, required: true },
    { name: 'Shipping address', status: 'complete', source: 'Shopify', automatic: true, required: true },
    { name: 'Billing address', status: 'complete', source: 'Shopify', automatic: true, required: true },
    { name: 'Tracking number', status: 'complete', source: 'Carrier API', automatic: false, required: true },
    { name: 'Delivery confirmation', status: 'complete', source: 'Carrier API', automatic: false, required: true },
    { name: 'Delivery signature', status: 'complete', source: 'Manual upload', automatic: false, required: false },
    { name: 'Product photos', status: 'complete', source: 'Shopify', automatic: true, required: false },
    { name: 'Customer communication', status: 'complete', source: 'Email sync', automatic: false, required: false },
  ];

  const completenessPercentage = 100;
  const requiredItems = evidenceItems.filter(i => i.required);
  const requiredComplete = requiredItems.filter(i => i.status === 'complete').length;

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

      {/* Dispute Header - More serious tone */}
      <div className="bg-gradient-to-br from-[#FEE2E2] to-white border border-[#FCA5A5] rounded-lg p-6 mb-6">
        <div className="flex items-start justify-between mb-4">
          <div className="flex items-start gap-4">
            {/* Icon */}
            <div className="w-12 h-12 rounded-lg bg-white border border-[#FCA5A5] flex items-center justify-center shadow-sm">
              <AlertCircle className="w-6 h-6 text-[#DC2626]" />
            </div>

            {/* Title & Meta */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <h1 className="text-xl font-semibold text-[#7F1D1D]">
                  Dispute for Order {disputeData.orderId}
                </h1>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-white border border-[#FCA5A5]">
                  <AlertCircle className="w-3.5 h-3.5 text-[#DC2626]" />
                  <span className="text-xs font-medium text-[#DC2626]">Dispute</span>
                </div>
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#DBEAFE] border border-[#93C5FD]">
                  <Clock className="w-3.5 h-3.5 text-[#1E40AF]" />
                  <span className="text-xs font-medium text-[#1E40AF]">Needs review</span>
                </div>
              </div>
              <div className="flex items-center gap-4 text-sm text-[#7F1D1D]/70 mb-3">
                <span className="font-medium text-[#7F1D1D]">{disputeData.amount}</span>
                <span>•</span>
                <span>{disputeData.customerName} ({disputeData.customerEmail})</span>
                <span>•</span>
                <span>Filed {disputeData.receivedAt}</span>
              </div>
              <div className="flex items-center gap-2 px-3 py-1.5 bg-[#FEF3C7] border border-[#FDE047] rounded-lg inline-flex">
                <Calendar className="w-4 h-4 text-[#92400E]" />
                <span className="text-sm font-medium text-[#92400E]">Submit evidence within {disputeData.dueDate}</span>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2">
            <button className="px-4 py-2 border border-[#C9CCCF] bg-white rounded-lg text-sm font-medium text-[#202223] hover:bg-[#F6F6F7] transition-colors">
              Save draft
            </button>
            <button className="px-4 py-2 bg-[#DC2626] text-white rounded-lg text-sm font-medium hover:bg-[#B91C1C] transition-colors flex items-center gap-2">
              <Shield className="w-4 h-4" />
              Submit evidence
            </button>
          </div>
        </div>

        {/* Reason */}
        <div className="pt-4 border-t border-[#FCA5A5]/30 grid grid-cols-2 gap-4">
          <div>
            <div className="text-xs font-medium text-[#7F1D1D]/60 mb-1">Dispute reason</div>
            <div className="text-sm text-[#7F1D1D]">{disputeData.reason}</div>
          </div>
          <div>
            <div className="text-xs font-medium text-[#7F1D1D]/60 mb-1">Dispute category</div>
            <div className="text-sm text-[#7F1D1D]">{disputeData.disputeReason}</div>
          </div>
        </div>

        {/* Warning Callout - Dispute specific */}
        <div className="mt-4 p-3 rounded-lg bg-white border border-[#FCA5A5]">
          <div className="flex gap-2">
            <AlertCircle className="w-4 h-4 text-[#DC2626] flex-shrink-0 mt-0.5" />
            <div className="text-xs text-[#7F1D1D]">
              <strong className="font-medium">Review all evidence before submitting.</strong> Once submitted, you cannot edit your response. Make sure all required evidence is complete and accurate to maximize your win rate.
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Main Content - Left 2 columns */}
        <div className="col-span-2 space-y-6">
          {/* Evidence Completeness Card */}
          <div className="bg-gradient-to-br from-[#D1FAE5] to-white border border-[#86EFAC] rounded-lg p-5">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-lg bg-white border border-[#86EFAC] flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-[#22C55E]" />
              </div>
              <div className="flex-1">
                <h3 className="text-base font-semibold text-[#065F46] mb-1">Evidence ready for submission</h3>
                <p className="text-sm text-[#065F46]/70 mb-3">
                  All required evidence has been collected. You can submit your response now.
                </p>
                <div className="flex items-center gap-4 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-[#065F46]">{requiredComplete}/{requiredItems.length} required items</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-[#22C55E]" />
                    <span className="text-[#065F46]">{evidenceItems.length} total items</span>
                  </div>
                </div>
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
                <FileText className="w-5 h-5 text-[#6D7175]" />
                <div className="text-left">
                  <h2 className="text-sm font-semibold text-[#202223]">Evidence package</h2>
                  <p className="text-xs text-[#6D7175]">{evidenceItems.length} items · All required items complete</p>
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
                    <span className="text-xs font-medium text-[#22C55E]">{completenessPercentage}% complete</span>
                  </div>
                  <div className="h-2 bg-[#F1F5F9] rounded-full overflow-hidden">
                    <div 
                      className="h-full bg-[#22C55E] transition-all duration-500 rounded-full"
                      style={{ width: `${completenessPercentage}%` }}
                    ></div>
                  </div>
                </div>

                {/* Required Evidence */}
                <div className="mb-6">
                  <h3 className="text-sm font-semibold text-[#202223] mb-3">Required evidence</h3>
                  <div className="space-y-3">
                    {evidenceItems.filter(i => i.required).map((item, index) => (
                      <div 
                        key={index}
                        className="p-3 rounded-lg border border-[#D1FAE5] bg-[#F0FDF4]"
                      >
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0 mt-0.5" />
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
                            <div className="text-xs text-[#065F46]">
                              Included in submission
                            </div>
                          </div>
                          <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
                            Review
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Optional Evidence */}
                <div>
                  <h3 className="text-sm font-semibold text-[#202223] mb-3">Additional evidence</h3>
                  <div className="space-y-3">
                    {evidenceItems.filter(i => !i.required).map((item, index) => (
                      <div 
                        key={index}
                        className="p-3 rounded-lg border border-[#D1FAE5] bg-[#F0FDF4]"
                      >
                        <div className="flex items-start gap-3">
                          <CheckCircle2 className="w-5 h-5 text-[#22C55E] flex-shrink-0 mt-0.5" />
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
                              <span className="px-2 py-0.5 bg-[#E0E7FF] text-[#3730A3] text-xs font-medium rounded-full">
                                Optional
                              </span>
                            </div>
                            <div className="text-xs text-[#065F46]">
                              Strengthens your case
                            </div>
                          </div>
                          <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
                            Review
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
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
                    <div className="text-[#202223]">{disputeData.orderId}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Order amount</div>
                    <div className="text-[#202223]">{disputeData.amount}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Customer</div>
                    <div className="text-[#202223]">{disputeData.customerName}</div>
                  </div>
                  <div>
                    <div className="text-xs font-medium text-[#6D7175] mb-1">Email</div>
                    <div className="text-[#202223]">{disputeData.customerEmail}</div>
                  </div>
                </div>
                <button className="mt-4 flex items-center gap-2 text-sm text-[#005BD3] hover:text-[#004C9B] font-medium">
                  <ExternalLink className="w-4 h-4" />
                  View full order in Shopify
                </button>
              </div>
            )}
          </div>

          {/* Timeline */}
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
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#EF4444] mt-1.5 flex-shrink-0"></div>
                    <div className="flex-1">
                      <div className="text-sm text-[#202223]">Dispute filed by customer</div>
                      <div className="text-xs text-[#6D7175] mt-0.5">1 day ago</div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#3B82F6] mt-1.5 flex-shrink-0"></div>
                    <div className="flex-1">
                      <div className="text-sm text-[#202223]">Evidence pack auto-prepared</div>
                      <div className="text-xs text-[#6D7175] mt-0.5">1 day ago</div>
                    </div>
                  </div>
                  <div className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-[#3B82F6] mt-1.5 flex-shrink-0"></div>
                    <div className="flex-1">
                      <div className="text-sm text-[#202223]">Case marked for merchant review</div>
                      <div className="text-xs text-[#6D7175] mt-0.5">1 day ago</div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Sidebar - Right column */}
        <div className="space-y-6">
          {/* Review Checklist */}
          <div className="bg-[#FEF3C7] border border-[#FDE047] rounded-lg p-4">
            <div className="flex items-start gap-3">
              <Shield className="w-5 h-5 text-[#92400E] flex-shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-semibold text-[#92400E] mb-1">Review before submitting</h3>
                <p className="text-xs text-[#92400E] mb-3">
                  Complete this checklist to maximize your win rate:
                </p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-[#92400E]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
                    <span>All required evidence collected</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#92400E]">
                    <CheckCircle2 className="w-3.5 h-3.5 text-[#22C55E]" />
                    <span>Evidence is accurate and complete</span>
                  </div>
                  <div className="flex items-center gap-2 text-xs text-[#92400E]">
                    <div className="w-3.5 h-3.5 rounded-full border-2 border-[#92400E] flex-shrink-0"></div>
                    <span>Reviewed submission one final time</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Dispute Info */}
          <div className="bg-white border border-[#C9CCCF] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#202223] mb-3">Dispute information</h3>
            <div className="space-y-3 text-sm">
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Dispute ID</div>
                <div className="text-[#202223] font-mono text-xs">{disputeData.id}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Type</div>
                <div className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[#FEE2E2] text-[#991B1B]">
                  <AlertCircle className="w-3 h-3" />
                  <span className="text-xs font-medium">Dispute</span>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Filed</div>
                <div className="text-[#202223]">{disputeData.receivedAt}</div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Submission deadline</div>
                <div className="flex items-center gap-1.5 text-[#F59E0B] font-medium">
                  <Calendar className="w-3.5 h-3.5" />
                  <span>{disputeData.dueDate}</span>
                </div>
              </div>
              <div>
                <div className="text-xs font-medium text-[#6D7175] mb-1">Possible outcomes</div>
                <div className="space-y-1 mt-2">
                  <div className="flex items-center gap-1.5 text-xs">
                    <CheckCircle2 className="w-3 h-3 text-[#22C55E]" />
                    <span className="text-[#202223]">Won - Funds returned</span>
                  </div>
                  <div className="flex items-center gap-1.5 text-xs">
                    <XCircle className="w-3 h-3 text-[#EF4444]" />
                    <span className="text-[#202223]">Lost - Funds withheld</span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Win Rate Stats */}
          <div className="bg-[#E0E7FF] border border-[#C7D2FE] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#3730A3] mb-2">Your win rate</h3>
            <div className="text-3xl font-semibold text-[#3730A3] mb-1">87%</div>
            <p className="text-xs text-[#3730A3]">
              For similar disputes in the past 90 days
            </p>
          </div>

          {/* Help */}
          <div className="bg-[#F6F6F7] border border-[#E1E3E5] rounded-lg p-4">
            <h3 className="text-sm font-semibold text-[#202223] mb-2">Need help?</h3>
            <p className="text-xs text-[#6D7175] mb-3">
              Learn best practices for responding to disputes and maximizing your win rate.
            </p>
            <button className="text-xs text-[#005BD3] hover:text-[#004C9B] font-medium">
              View dispute guide
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}