import React, { useState } from 'react';
import { ArrowLeft, AlertCircle, CheckCircle, Clock, Shield, TrendingUp, Package, Truck, User, CreditCard, MapPin, Globe, Mail, ChevronDown, ChevronUp, Copy, ExternalLink, Info, FileText } from 'lucide-react';

interface ShopifyDisputeDetailProps {
  onNavigate?: (path: string) => void;
}

export default function ShopifyDisputeDetail({ onNavigate }: ShopifyDisputeDetailProps) {
  const [activeTab, setActiveTab] = useState<'overview' | 'evidence' | 'review'>('overview');
  const [expandedEvidence, setExpandedEvidence] = useState<Record<string, boolean>>({
    payment: true,
    fulfillment: true,
    customer: true,
  });

  const disputeData = {
    id: 'DP-1074',
    orderId: '#1235',
    amount: 450.00,
    customerName: 'Emily Chen',
    customerEmail: 'emily@example.com',
    disputeReason: 'Unauthorized transaction',
    receivedAt: 'Apr 18, 2026',
    dueDate: 'May 3, 2026',
    daysRemaining: 15,
    status: 'submitted',
    caseStrength: 'strong',
    outcomeLabel: 'Likely to win',
    confidence: '85%'
  };

  const toggleEvidence = (section: string) => {
    setExpandedEvidence(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const getStatusBadge = () => {
    const statusMap: Record<string, { bg: string; text: string; label: string }> = {
      submitted: { bg: 'bg-[#D1FAE5]', text: 'text-[#065F46]', label: 'Submitted' },
      needs_action: { bg: 'bg-[#FEE2E2]', text: 'text-[#991B1B]', label: 'Needs action' },
      under_review: { bg: 'bg-[#DBEAFE]', text: 'text-[#1E40AF]', label: 'Under review' },
    };
    const config = statusMap[disputeData.status] || statusMap.submitted;
    return <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${config.bg} ${config.text}`}>{config.label}</span>;
  };

  const getStrengthBadge = () => {
    const strengthMap: Record<string, { bg: string; text: string; label: string }> = {
      strong: { bg: 'bg-[#D1FAE5]', text: 'text-[#065F46]', label: 'Strong case' },
      medium: { bg: 'bg-[#FEF3C7]', text: 'text-[#92400E]', label: 'Medium case' },
      weak: { bg: 'bg-[#FEE2E2]', text: 'text-[#991B1B]', label: 'Weak case' },
    };
    const config = strengthMap[disputeData.caseStrength] || strengthMap.strong;
    return <span className={`px-2 py-0.5 rounded-md text-xs font-medium ${config.bg} ${config.text}`}>{config.label}</span>;
  };

  return (
    <div className="max-w-[1200px]">
      {/* Back Navigation */}
      <button
        onClick={() => onNavigate && onNavigate('/shopify/disputes')}
        className="flex items-center gap-2 text-sm text-[#005BD3] hover:text-[#004C9B] mb-4 font-medium"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to disputes
      </button>

      {/* PERSISTENT HEADER (ALL TABS) */}
      <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm p-5 mb-5">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h1 className="text-xl font-semibold text-[#202223] mb-2">
              Dispute #{disputeData.id} — {disputeData.disputeReason}
            </h1>
            <div className="flex items-center gap-2 mb-3">
              {getStatusBadge()}
              {getStrengthBadge()}
            </div>
          </div>
        </div>

        {/* Key Metadata Inline */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-4 border-t border-[#E1E3E5]">
          <div>
            <div className="text-xs text-[#6D7175] mb-1">Amount</div>
            <div className="text-sm font-semibold text-[#202223]">${disputeData.amount.toFixed(2)}</div>
          </div>
          <div>
            <div className="text-xs text-[#6D7175] mb-1">Customer</div>
            <div className="text-sm font-semibold text-[#202223]">{disputeData.customerName}</div>
          </div>
          <div>
            <div className="text-xs text-[#6D7175] mb-1">Date filed</div>
            <div className="text-sm font-semibold text-[#202223]">{disputeData.receivedAt}</div>
          </div>
          <div>
            <div className="text-xs text-[#6D7175] mb-1">Dispute reason</div>
            <div className="text-sm font-semibold text-[#202223]">{disputeData.disputeReason}</div>
          </div>
        </div>
      </div>

      {/* TABS */}
      <div className="bg-white border border-[#E1E3E5] rounded-t-lg border-b-0">
        <div className="flex border-b border-[#E1E3E5]">
          <button
            onClick={() => setActiveTab('overview')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-[#005BD3] text-[#005BD3]'
                : 'border-transparent text-[#6D7175] hover:text-[#202223]'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('evidence')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'evidence'
                ? 'border-[#005BD3] text-[#005BD3]'
                : 'border-transparent text-[#6D7175] hover:text-[#202223]'
            }`}
          >
            Evidence
          </button>
          <button
            onClick={() => setActiveTab('review')}
            className={`px-6 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'review'
                ? 'border-[#005BD3] text-[#005BD3]'
                : 'border-transparent text-[#6D7175] hover:text-[#202223]'
            }`}
          >
            Review & Submit
          </button>
        </div>
      </div>

      {/* TAB CONTENT */}
      <div className="bg-white border border-[#E1E3E5] rounded-b-lg border-t-0 p-5">
        {activeTab === 'overview' && (
          <div className="space-y-5">
            {/* 1. HERO DECISION CARD */}
            <div className="bg-[#F0FDF4] border-2 border-[#86EFAC] rounded-lg p-6">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#D1FAE5] flex items-center justify-center flex-shrink-0">
                  <Shield className="w-6 h-6 text-[#059669]" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h2 className="text-xl font-bold text-[#065F46]">{disputeData.outcomeLabel}</h2>
                    <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-[#D1FAE5] text-[#065F46]">
                      {disputeData.confidence} confidence
                    </span>
                  </div>
                  <p className="text-sm text-[#065F46]">
                    This dispute has strong evidence supporting authorization. Payment verification passed, delivery was confirmed with tracking, and customer activity is consistent with a legitimate purchase.
                  </p>
                </div>
              </div>
            </div>

            {/* 2. WHAT HAPPENS NOW */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-5">
              <h3 className="text-base font-semibold text-[#202223] mb-4">What happens now</h3>

              {/* Timeline */}
              <div className="relative">
                <div className="absolute left-4 top-8 bottom-8 w-0.5 bg-[#E1E3E5]" />

                <div className="space-y-6">
                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#D1FAE5] border-2 border-white flex items-center justify-center flex-shrink-0 relative z-10">
                      <CheckCircle className="w-4 h-4 text-[#059669]" />
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="text-sm font-medium text-[#202223]">Evidence submitted</div>
                      <div className="text-xs text-[#6D7175] mt-0.5">Submitted to Shopify on Apr 20, 2026</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#DBEAFE] border-2 border-white flex items-center justify-center flex-shrink-0 relative z-10">
                      <Clock className="w-4 h-4 text-[#1E40AF]" />
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="text-sm font-medium text-[#202223]">Bank review in progress</div>
                      <div className="text-xs text-[#6D7175] mt-0.5">Expected duration: 30–75 days</div>
                    </div>
                  </div>

                  <div className="flex items-start gap-4">
                    <div className="w-8 h-8 rounded-full bg-[#F1F2F4] border-2 border-white flex items-center justify-center flex-shrink-0 relative z-10">
                      <div className="w-2 h-2 rounded-full bg-[#8C9196]" />
                    </div>
                    <div className="flex-1 pt-1">
                      <div className="text-sm font-medium text-[#6D7175]">Outcome notification</div>
                      <div className="text-xs text-[#6D7175] mt-0.5">You'll be notified by email when a decision is made</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* 3. WHY THIS CASE IS STRONG */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-5">
              <h3 className="text-base font-semibold text-[#202223] mb-4">Why this case is defensible</h3>

              <div className="space-y-4">
                <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E1E3E5] last:border-0 last:pb-0">
                  <div className="flex items-start gap-3 flex-1">
                    <CheckCircle className="w-5 h-5 text-[#059669] flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-[#202223] mb-1">Payment verified</div>
                      <div className="text-xs text-[#6D7175]">AVS and CVV checks passed, indicating cardholder authorization</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-[#D1FAE5] text-[#065F46] whitespace-nowrap">Strong</span>
                </div>

                <div className="flex items-start justify-between gap-4 pb-4 border-b border-[#E1E3E5] last:border-0 last:pb-0">
                  <div className="flex items-start gap-3 flex-1">
                    <CheckCircle className="w-5 h-5 text-[#059669] flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-[#202223] mb-1">Delivered with tracking</div>
                      <div className="text-xs text-[#6D7175]">Package delivered to billing address with signature confirmation</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-[#D1FAE5] text-[#065F46] whitespace-nowrap">Strong</span>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <CheckCircle className="w-5 h-5 text-[#059669] flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-medium text-[#202223] mb-1">Customer activity consistent</div>
                      <div className="text-xs text-[#6D7175]">Repeat customer with purchase history and confirmed contact</div>
                    </div>
                  </div>
                  <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-[#FEF3C7] text-[#92400E] whitespace-nowrap">Supporting</span>
                </div>
              </div>
            </div>

            {/* 4. EVIDENCE COVERAGE SUMMARY */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-5">
              <h3 className="text-base font-semibold text-[#202223] mb-4">Evidence coverage</h3>

              <div className="space-y-4">
                {/* Progress Bar */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-[#6D7175]">Coverage completeness</span>
                    <span className="text-sm font-semibold text-[#202223]">9/9 included</span>
                  </div>
                  <div className="w-full h-2 bg-[#E1E3E5] rounded-full overflow-hidden">
                    <div className="h-full bg-[#059669] rounded-full" style={{width: '100%'}} />
                  </div>
                </div>

                {/* Categories */}
                <div className="space-y-3 pt-3 border-t border-[#E1E3E5]">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#DC2626]" />
                      <span className="text-sm text-[#202223]">Critical evidence</span>
                    </div>
                    <span className="text-sm font-medium text-[#202223]">6/6 complete</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#D97706]" />
                      <span className="text-sm text-[#202223]">Supporting evidence</span>
                    </div>
                    <span className="text-sm font-medium text-[#202223]">2/2 complete</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 rounded-full bg-[#6D7175]" />
                      <span className="text-sm text-[#202223]">Optional</span>
                    </div>
                    <span className="text-sm font-medium text-[#202223]">1/1 complete</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'evidence' && (
          <div className="space-y-5">
            {/* 1. CLAIM VS DEFENSE SPLIT */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg p-4">
                <div className="text-xs font-medium text-[#6D7175] mb-1">Customer claim</div>
                <div className="text-sm font-semibold text-[#7F1D1D]">Unauthorized transaction</div>
              </div>
              <div className="bg-[#F0FDF4] border border-[#86EFAC] rounded-lg p-4">
                <div className="text-xs font-medium text-[#6D7175] mb-1">Our defense</div>
                <div className="text-sm font-semibold text-[#065F46]">Authorized transaction</div>
              </div>
            </div>

            {/* 2. ARGUMENT BLOCKS */}
            <div className="space-y-4">
              {/* A. Payment Authentication */}
              <div className="bg-white border border-[#E1E3E5] rounded-lg">
                <button
                  onClick={() => toggleEvidence('payment')}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#F6F8FB] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <CreditCard className="w-5 h-5 text-[#005BD3]" />
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-[#202223]">Payment Authentication</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#6D7175]">3 items</span>
                        <span className="text-xs text-[#6D7175]">•</span>
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-[#D1FAE5] text-[#065F46]">Strong</span>
                      </div>
                    </div>
                  </div>
                  {expandedEvidence.payment ? <ChevronUp className="w-5 h-5 text-[#6D7175]" /> : <ChevronDown className="w-5 h-5 text-[#6D7175]" />}
                </button>

                {expandedEvidence.payment && (
                  <div className="px-5 pb-4 space-y-3">
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">AVS match</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Billing address verified</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">CVV match</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Security code verified</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">Transaction record</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Payment processed successfully</span>
                    </div>
                  </div>
                )}
              </div>

              {/* B. Fulfillment & Delivery */}
              <div className="bg-white border border-[#E1E3E5] rounded-lg">
                <button
                  onClick={() => toggleEvidence('fulfillment')}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#F6F8FB] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Truck className="w-5 h-5 text-[#005BD3]" />
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-[#202223]">Fulfillment & Delivery</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#6D7175]">3 items</span>
                        <span className="text-xs text-[#6D7175]">•</span>
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-[#D1FAE5] text-[#065F46]">Strong</span>
                      </div>
                    </div>
                  </div>
                  {expandedEvidence.fulfillment ? <ChevronUp className="w-5 h-5 text-[#6D7175]" /> : <ChevronDown className="w-5 h-5 text-[#6D7175]" />}
                </button>

                {expandedEvidence.fulfillment && (
                  <div className="px-5 pb-4 space-y-3">
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">Shipping confirmation</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Tracking: 1Z999AA10123456784</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">Delivery status</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Delivered Apr 15, 2026</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">Signature confirmation</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Signed by E. Chen</span>
                    </div>
                  </div>
                )}
              </div>

              {/* C. Customer Behavior */}
              <div className="bg-white border border-[#E1E3E5] rounded-lg">
                <button
                  onClick={() => toggleEvidence('customer')}
                  className="w-full px-5 py-4 flex items-center justify-between hover:bg-[#F6F8FB] transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <User className="w-5 h-5 text-[#005BD3]" />
                    <div className="text-left">
                      <h3 className="text-sm font-semibold text-[#202223]">Customer Behavior</h3>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#6D7175]">2 items</span>
                        <span className="text-xs text-[#6D7175]">•</span>
                        <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-[#FEF3C7] text-[#92400E]">Supporting</span>
                      </div>
                    </div>
                  </div>
                  {expandedEvidence.customer ? <ChevronUp className="w-5 h-5 text-[#6D7175]" /> : <ChevronDown className="w-5 h-5 text-[#6D7175]" />}
                </button>

                {expandedEvidence.customer && (
                  <div className="px-5 pb-4 space-y-3">
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">Purchase history</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">4 previous orders</span>
                    </div>
                    <div className="flex items-center justify-between py-2 border-t border-[#E1E3E5]">
                      <div className="flex items-center gap-2">
                        <CheckCircle className="w-4 h-4 text-[#059669]" />
                        <span className="text-sm text-[#202223]">Email communication</span>
                      </div>
                      <span className="text-xs text-[#6D7175]">Order confirmation received</span>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* 3. DEVICE & LOCATION CONSISTENCY */}
            <div className="bg-[#F6F8FB] border border-[#E1E3E5] rounded-lg p-5">
              <div className="flex items-start gap-3 mb-3">
                <Globe className="w-5 h-5 text-[#005BD3] flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="text-sm font-semibold text-[#202223] mb-1">Device & Location Consistency</h3>
                  <p className="text-xs text-[#6D7175]">Supporting evidence only</p>
                </div>
              </div>

              <div className="space-y-2 mt-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#6D7175]">IP location match</span>
                  <span className="font-medium text-[#202223]">Billing address area</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#6D7175]">VPN/Proxy detected</span>
                  <span className="font-medium text-[#202223]">No</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'review' && (
          <div className="space-y-5">
            {/* 1. SUBMISSION STATUS HERO */}
            <div className="bg-[#F0FDF4] border-2 border-[#86EFAC] rounded-lg p-5">
              <div className="flex items-start gap-4">
                <div className="w-12 h-12 rounded-lg bg-[#D1FAE5] flex items-center justify-center flex-shrink-0">
                  <CheckCircle className="w-6 h-6 text-[#059669]" />
                </div>
                <div className="flex-1">
                  <h2 className="text-base font-semibold text-[#065F46] mb-1">Evidence submitted to Shopify</h2>
                  <p className="text-sm text-[#065F46] mb-3">Submitted on Apr 20, 2026 at 3:42 PM</p>
                  <button className="px-4 py-2 bg-white border border-[#86EFAC] rounded-lg text-sm font-medium text-[#065F46] hover:bg-[#F0FDF4] transition-colors inline-flex items-center gap-2">
                    View in Shopify Admin
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            {/* 2. WHAT WAS SENT (STRUCTURED) */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-5">
              <h3 className="text-base font-semibold text-[#202223] mb-4">What was sent</h3>

              <div className="space-y-3">
                <details className="group" open>
                  <summary className="cursor-pointer list-none flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg hover:bg-[#E1E3E5] transition-colors">
                    <span className="text-sm font-medium text-[#202223]">Order Summary</span>
                    <ChevronDown className="w-4 h-4 text-[#6D7175] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 text-sm text-[#6D7175] space-y-2">
                    <div className="flex justify-between">
                      <span>Order ID:</span>
                      <span className="font-medium text-[#202223]">#1235</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Amount:</span>
                      <span className="font-medium text-[#202223]">$450.00</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Date:</span>
                      <span className="font-medium text-[#202223]">Apr 12, 2026</span>
                    </div>
                  </div>
                </details>

                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg hover:bg-[#E1E3E5] transition-colors">
                    <span className="text-sm font-medium text-[#202223]">Payment Verification</span>
                    <ChevronDown className="w-4 h-4 text-[#6D7175] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 text-sm text-[#6D7175] space-y-2">
                    <div className="flex justify-between">
                      <span>AVS Result:</span>
                      <span className="font-medium text-[#059669]">Match</span>
                    </div>
                    <div className="flex justify-between">
                      <span>CVV Result:</span>
                      <span className="font-medium text-[#059669]">Match</span>
                    </div>
                    <div className="flex justify-between">
                      <span>3D Secure:</span>
                      <span className="font-medium text-[#202223]">Not available</span>
                    </div>
                  </div>
                </details>

                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg hover:bg-[#E1E3E5] transition-colors">
                    <span className="text-sm font-medium text-[#202223]">Timeline of Events</span>
                    <ChevronDown className="w-4 h-4 text-[#6D7175] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 text-sm text-[#6D7175] space-y-2">
                    <div>Apr 12: Order placed</div>
                    <div>Apr 13: Payment authorized</div>
                    <div>Apr 13: Order fulfilled and shipped</div>
                    <div>Apr 15: Package delivered with signature</div>
                    <div>Apr 18: Dispute filed by customer</div>
                  </div>
                </details>

                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg hover:bg-[#E1E3E5] transition-colors">
                    <span className="text-sm font-medium text-[#202223]">Customer Activity</span>
                    <ChevronDown className="w-4 h-4 text-[#6D7175] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 text-sm text-[#6D7175]">
                    Customer has 4 previous successful orders with no disputes. Email confirmation was received and shipping notifications were opened.
                  </div>
                </details>

                <details className="group">
                  <summary className="cursor-pointer list-none flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg hover:bg-[#E1E3E5] transition-colors">
                    <span className="text-sm font-medium text-[#202223]">Policies</span>
                    <ChevronDown className="w-4 h-4 text-[#6D7175] group-open:rotate-180 transition-transform" />
                  </summary>
                  <div className="p-4 text-sm text-[#6D7175]">
                    Refund policy, shipping policy, and terms of service were displayed at checkout and accepted by customer.
                  </div>
                </details>
              </div>
            </div>

            {/* 3. BANK-READY ARGUMENT */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-5">
              <div className="flex items-start justify-between mb-3">
                <h3 className="text-base font-semibold text-[#202223]">Defense argument</h3>
                <button className="text-sm text-[#005BD3] hover:text-[#004C9B] font-medium inline-flex items-center gap-1">
                  <Copy className="w-4 h-4" />
                  Copy
                </button>
              </div>
              <div className="p-4 bg-[#F6F8FB] rounded-lg text-sm text-[#202223] leading-relaxed">
                This transaction was authorized and legitimate. Payment verification passed all security checks including AVS and CVV validation. The order was fulfilled and delivered to the customer's verified billing address on April 15, 2026, with signature confirmation from E. Chen. The customer is a repeat buyer with four previous successful orders and no dispute history. All evidence supports that this was an authorized purchase by the cardholder.
              </div>
            </div>

            {/* 4. SUPPORTING LINKS */}
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-5">
              <h3 className="text-base font-semibold text-[#202223] mb-4">Supporting documents</h3>
              <div className="space-y-2">
                <div className="flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg">
                  <div className="flex items-center gap-2">
                    <Package className="w-4 h-4 text-[#6D7175]" />
                    <span className="text-sm text-[#202223]">Shipping confirmation</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-[#6D7175]" />
                </div>
                <div className="flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg">
                  <div className="flex items-center gap-2">
                    <FileText className="w-4 h-4 text-[#6D7175]" />
                    <span className="text-sm text-[#202223]">Delivery signature</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-[#6D7175]" />
                </div>
                <div className="flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg">
                  <div className="flex items-center gap-2">
                    <Mail className="w-4 h-4 text-[#6D7175]" />
                    <span className="text-sm text-[#202223]">Customer email thread</span>
                  </div>
                  <ExternalLink className="w-4 h-4 text-[#6D7175]" />
                </div>
              </div>
            </div>

            {/* 5. IMPORTANT DISCLAIMER */}
            <div className="bg-[#FEF3C7] border border-[#FDE047] rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Info className="w-5 h-5 text-[#92400E] flex-shrink-0 mt-0.5" />
                <div className="text-sm text-[#92400E]">
                  <p className="font-medium mb-1">Important information</p>
                  <p>Some evidence data (like IP address and device fingerprint) is not visible in Shopify Admin but has been submitted to the card network for review.</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
