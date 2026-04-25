import React, { useState } from 'react';
import { FileText, TrendingUp, TrendingDown, AlertCircle, ChevronRight, CheckCircle, Clock, HelpCircle, Calendar, BarChart3, Zap } from 'lucide-react';
import OnboardingWizard from './onboarding-wizard';
import ShopifyShell from './shopify-shell';

interface ShopifyHomeProps {
  onNavigate?: (path: string) => void;
}

export default function ShopifyHome({ onNavigate }: ShopifyHomeProps) {
  const [showWizard, setShowWizard] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [systemState] = useState<'setup_incomplete' | 'attention_required' | 'normal'>('attention_required');
  const [selectedPeriod, setSelectedPeriod] = useState('7 days');

  const handleNavigate = (path: string) => {
    if (onNavigate) {
      onNavigate(path);
    }
  };

  if (showWizard) {
    return (
      <OnboardingWizard
        currentStep={currentStep}
        onStepChange={setCurrentStep}
        onComplete={() => setShowWizard(false)}
        onSkip={() => setShowWizard(false)}
        onNavigate={onNavigate}
      />
    );
  }

  const actionMetrics = {
    actionNeeded: 12,
    readyToSubmit: 5,
    waitingOnIssuer: 8,
    closed: 143
  };

  const performance = {
    activeDisputes: 25,
    activeChange: -12,
    winRate: 68,
    winRateChange: 5,
    amountRecovered: 14250,
    recoveredChange: 8,
    amountLost: 3420,
    lostChange: -15,
    amountAtRisk: 5680,
    riskChange: -8
  };

  const recentDisputes = [
    {
      id: 'DP-2407',
      order: '#1058',
      amount: 145.00,
      reason: 'Fraudulent',
      caseStatus: 'action_needed',
      submissionStatus: 'draft',
      date: '2026-04-20',
      daysUntilDeadline: 2,
      outcome: null
    },
    {
      id: 'DP-2406',
      order: '#1057',
      amount: 234.50,
      reason: 'Product Not Received',
      caseStatus: 'action_needed',
      submissionStatus: 'draft',
      date: '2026-04-19',
      daysUntilDeadline: 3,
      outcome: null
    },
    {
      id: 'DP-2405',
      order: '#1056',
      amount: 89.99,
      reason: 'Product Unacceptable',
      caseStatus: 'ready_to_submit',
      submissionStatus: 'ready_for_export',
      date: '2026-04-18',
      daysUntilDeadline: 5,
      outcome: null
    },
    {
      id: 'DP-2404',
      order: '#1055',
      amount: 167.25,
      reason: 'Fraudulent',
      caseStatus: 'waiting_on_issuer',
      submissionStatus: 'submitted_to_bank',
      date: '2026-04-15',
      daysUntilDeadline: 20,
      outcome: null
    },
    {
      id: 'DP-2403',
      order: '#1054',
      amount: 299.00,
      reason: 'Credit Not Processed',
      caseStatus: 'closed',
      submissionStatus: 'submitted_to_bank',
      date: '2026-04-10',
      daysUntilDeadline: null,
      outcome: 'won'
    },
  ];

  const recentActivity = [
    { event: 'Evidence saved to Shopify', caseId: 'DP-2407', timestamp: '2 hours ago' },
    { event: 'Pack exported for submission', caseId: 'DP-2405', timestamp: '4 hours ago' },
    { event: 'Rule triggered: Auto-assign Pack', caseId: 'DP-2406', timestamp: '5 hours ago' },
    { event: 'Dispute accepted from Shopify', caseId: 'DP-2407', timestamp: '6 hours ago' },
  ];

  const getCaseStatusBadge = (status: string) => {
    const baseClasses = "px-2 py-0.5 rounded-md text-xs font-medium inline-flex items-center gap-1";
    switch (status) {
      case 'action_needed':
        return <span className={`${baseClasses} bg-[#FEE2E2] text-[#991B1B]`}>Action needed</span>;
      case 'ready_to_submit':
        return <span className={`${baseClasses} bg-[#FEF3C7] text-[#92400E]`}>Ready to submit</span>;
      case 'waiting_on_issuer':
        return <span className={`${baseClasses} bg-[#DBEAFE] text-[#1E40AF]`}>Waiting on issuer</span>;
      case 'closed':
        return <span className={`${baseClasses} bg-[#F1F2F4] text-[#6D7175]`}>Closed</span>;
      default:
        return <span className={`${baseClasses} bg-[#F1F2F4] text-[#6D7175]`}>{status}</span>;
    }
  };

  const getSubmissionStatusBadge = (status: string) => {
    const baseClasses = "px-2 py-0.5 rounded-md text-xs font-medium";
    switch (status) {
      case 'draft':
        return <span className={`${baseClasses} bg-[#F1F2F4] text-[#6D7175]`}>Draft</span>;
      case 'ready_for_export':
        return <span className={`${baseClasses} bg-[#FEF3C7] text-[#92400E]`}>Ready for export</span>;
      case 'submitted_to_shopify':
        return <span className={`${baseClasses} bg-[#DBEAFE] text-[#1E40AF]`}>Submitted to Shopify</span>;
      case 'submitted_to_bank':
        return <span className={`${baseClasses} bg-[#D1FAE5] text-[#065F46]`}>Submitted to bank</span>;
      default:
        return <span className={`${baseClasses} bg-[#F1F2F4] text-[#6D7175]`}>{status}</span>;
    }
  };

  const getOutcomeBadge = (outcome: string | null) => {
    if (!outcome) return <span className="text-sm text-[#6D7175]">—</span>;
    const baseClasses = "px-2 py-0.5 rounded-md text-xs font-medium";
    return outcome === 'won' ?
      <span className={`${baseClasses} bg-[#D1FAE5] text-[#065F46]`}>Won</span> :
      <span className={`${baseClasses} bg-[#FEE2E2] text-[#991B1B]`}>Lost</span>;
  };

  const getDeadlineDisplay = (daysUntil: number | null) => {
    if (daysUntil === null) return <span className="text-sm text-[#6D7175]">—</span>;

    let colorClass = 'text-[#6D7175]';
    if (daysUntil < 3) colorClass = 'text-[#DC2626] font-semibold';
    else if (daysUntil < 5) colorClass = 'text-[#D97706] font-semibold';

    return <span className={`text-sm ${colorClass}`}>{daysUntil}d remaining</span>;
  };

  return (
    <ShopifyShell currentPath="/shopify" onNavigate={onNavigate}>
      <div className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h1 className="text-xl font-semibold text-[#202223]">Dashboard</h1>
            <p className="text-sm text-[#6D7175] mt-1">Your dispute operations console</p>
          </div>
          <div className="flex gap-3">
            <button className="px-4 py-2 border border-[#E1E3E5] rounded-lg text-sm font-medium text-[#202223] hover:bg-[#F7F8FA] transition-colors flex items-center gap-2">
              <HelpCircle className="w-4 h-4" />
              Help
            </button>
          </div>
        </div>

        {systemState === 'attention_required' && (
          <div className="bg-[#FEF2F2] border border-[#FCA5A5] rounded-lg p-4 flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-[#DC2626] flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm text-[#202223]">
                {actionMetrics.actionNeeded} disputes need attention
              </p>
            </div>
            <button
              onClick={() => handleNavigate('/shopify/disputes')}
              className="px-3 py-1.5 border border-[#DC2626] rounded-md text-sm font-medium text-[#DC2626] hover:bg-[#FEE2E2] transition-colors whitespace-nowrap"
            >
              Review now
            </button>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <button
            onClick={() => handleNavigate('/shopify/disputes')}
            className="bg-white border-2 border-[#FCA5A5] rounded-lg p-5 hover:shadow-md transition-all text-left group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#FEE2E2] flex items-center justify-center">
                <AlertCircle className="w-5 h-5 text-[#DC2626]" />
              </div>
              <span className="text-3xl font-bold text-[#202223]">{actionMetrics.actionNeeded}</span>
            </div>
            <h3 className="text-sm font-semibold text-[#202223] mb-1">Action Needed</h3>
            <p className="text-xs text-[#6D7175] mb-3">Needs manual review</p>
            <span className="text-sm font-medium text-[#DC2626] flex items-center gap-1 group-hover:gap-2 transition-all">
              Review cases
              <ChevronRight className="w-4 h-4" />
            </span>
          </button>

          <button
            onClick={() => handleNavigate('/shopify/disputes')}
            className="bg-white border-2 border-[#FDE68A] rounded-lg p-5 hover:shadow-md transition-all text-left group"
          >
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#FEF3C7] flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-[#D97706]" />
              </div>
              <span className="text-3xl font-bold text-[#202223]">{actionMetrics.readyToSubmit}</span>
            </div>
            <h3 className="text-sm font-semibold text-[#202223] mb-1">Ready to Submit</h3>
            <p className="text-xs text-[#6D7175] mb-3">Evidence complete</p>
            <span className="text-sm font-medium text-[#D97706] flex items-center gap-1 group-hover:gap-2 transition-all">
              Submit now
              <ChevronRight className="w-4 h-4" />
            </span>
          </button>

          <div className="bg-white border border-[#E1E3E5] rounded-lg p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#DBEAFE] flex items-center justify-center">
                <Clock className="w-5 h-5 text-[#005BD3]" />
              </div>
              <span className="text-3xl font-bold text-[#202223]">{actionMetrics.waitingOnIssuer}</span>
            </div>
            <h3 className="text-sm font-semibold text-[#202223] mb-1">Waiting on Issuer</h3>
            <p className="text-xs text-[#6D7175]">Submitted to bank</p>
          </div>

          <div className="bg-white border border-[#E1E3E5] rounded-lg p-5 hover:shadow-sm transition-shadow">
            <div className="flex items-start justify-between mb-3">
              <div className="w-10 h-10 rounded-lg bg-[#F1F2F4] flex items-center justify-center">
                <CheckCircle className="w-5 h-5 text-[#6D7175]" />
              </div>
              <span className="text-3xl font-bold text-[#202223]">{actionMetrics.closed}</span>
            </div>
            <h3 className="text-sm font-semibold text-[#202223] mb-1">Closed</h3>
            <p className="text-xs text-[#6D7175]">Historical cases</p>
          </div>
        </div>

        <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-[#202223]">Performance Overview</h2>
            <div className="inline-flex bg-[#F1F2F4] rounded-lg p-1">
              {['24 hours', '7 days', '30 days', 'All time'].map((period) => (
                <button
                  key={period}
                  onClick={() => setSelectedPeriod(period)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
                    selectedPeriod === period
                      ? 'bg-white text-[#202223] shadow-sm'
                      : 'text-[#6D7175] hover:text-[#202223]'
                  }`}
                >
                  {period}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-[#E1E3E5] rounded-lg p-4">
              <h4 className="text-xs text-[#6D7175] mb-2">Active disputes</h4>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-[#202223]">{performance.activeDisputes}</span>
                <div className="flex items-center gap-1 text-xs">
                  <TrendingDown className="w-3 h-3 text-[#059669]" />
                  <span className="text-[#059669] font-medium">{Math.abs(performance.activeChange)}%</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#E1E3E5] rounded-lg p-4">
              <h4 className="text-xs text-[#6D7175] mb-2">Win rate</h4>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-[#202223]">{performance.winRate}%</span>
                <div className="flex items-center gap-1 text-xs">
                  <TrendingUp className="w-3 h-3 text-[#059669]" />
                  <span className="text-[#059669] font-medium">+{performance.winRateChange}%</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#E1E3E5] rounded-lg p-4">
              <h4 className="text-xs text-[#6D7175] mb-2">Amount recovered</h4>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-[#202223]">${(performance.amountRecovered / 1000).toFixed(1)}k</span>
                <div className="flex items-center gap-1 text-xs">
                  <TrendingUp className="w-3 h-3 text-[#059669]" />
                  <span className="text-[#059669] font-medium">+{performance.recoveredChange}%</span>
                </div>
              </div>
            </div>

            <div className="bg-white border border-[#E1E3E5] rounded-lg p-4">
              <h4 className="text-xs text-[#6D7175] mb-2">Amount at risk</h4>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold text-[#202223]">${(performance.amountAtRisk / 1000).toFixed(1)}k</span>
                <div className="flex items-center gap-1 text-xs">
                  <TrendingDown className="w-3 h-3 text-[#059669]" />
                  <span className="text-[#059669] font-medium">{Math.abs(performance.riskChange)}%</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm">
          <div className="border-b border-[#E1E3E5] px-5 py-4 flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-[#202223]">Recent Disputes</h2>
              <p className="text-sm text-[#6D7175] mt-1">Cases requiring attention and next actions</p>
            </div>
            <button
              onClick={() => handleNavigate('/shopify/disputes')}
              className="text-sm font-medium text-[#005BD3] hover:text-[#004C9B] flex items-center gap-1"
            >
              View all
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          <div className="hidden lg:block overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#F7F8FA] border-b border-[#E1E3E5]">
                <tr>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Order</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Amount</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Reason</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Status</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Submission</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Date</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Deadline</th>
                  <th className="text-left px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Outcome</th>
                  <th className="text-right px-5 py-3 text-xs font-medium text-[#6D7175] uppercase tracking-wider">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#E1E3E5] bg-white">
                {recentDisputes.map((dispute) => (
                  <tr
                    key={dispute.id}
                    onClick={() => handleNavigate(`/shopify/disputes/${dispute.id}`)}
                    className="hover:bg-[#F7F8FA] transition-colors cursor-pointer"
                  >
                    <td className="px-5 py-4">
                      <div className="text-sm font-semibold text-[#202223]">{dispute.order}</div>
                      <div className="text-xs text-[#6D7175]">{dispute.id}</div>
                    </td>
                    <td className="px-5 py-4 text-sm font-medium text-[#202223]">${dispute.amount.toFixed(2)}</td>
                    <td className="px-5 py-4 text-sm text-[#202223]">{dispute.reason}</td>
                    <td className="px-5 py-4">{getCaseStatusBadge(dispute.caseStatus)}</td>
                    <td className="px-5 py-4">{getSubmissionStatusBadge(dispute.submissionStatus)}</td>
                    <td className="px-5 py-4 text-sm text-[#6D7175]">{new Date(dispute.date).toLocaleDateString()}</td>
                    <td className="px-5 py-4">{getDeadlineDisplay(dispute.daysUntilDeadline)}</td>
                    <td className="px-5 py-4">{getOutcomeBadge(dispute.outcome)}</td>
                    <td className="px-5 py-4 text-right">
                      <button className="text-sm font-medium text-[#005BD3] hover:text-[#004C9B]">
                        View details
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="lg:hidden divide-y divide-[#E1E3E5]">
            {recentDisputes.map((dispute) => (
              <button
                key={dispute.id}
                onClick={() => handleNavigate(`/shopify/disputes/${dispute.id}`)}
                className="w-full p-4 hover:bg-[#F7F8FA] transition-colors text-left"
              >
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="text-sm font-semibold text-[#202223]">{dispute.order}</div>
                    <div className="text-xs text-[#6D7175]">{dispute.id}</div>
                  </div>
                  <div className="text-sm font-medium text-[#202223]">${dispute.amount.toFixed(2)}</div>
                </div>
                <div className="space-y-2 mb-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    {getCaseStatusBadge(dispute.caseStatus)}
                    {getSubmissionStatusBadge(dispute.submissionStatus)}
                  </div>
                  <div className="text-sm text-[#6D7175]">{dispute.reason}</div>
                  {dispute.daysUntilDeadline !== null && (
                    <div className="flex items-center gap-2">
                      <Calendar className="w-4 h-4 text-[#6D7175]" />
                      {getDeadlineDisplay(dispute.daysUntilDeadline)}
                    </div>
                  )}
                </div>
                <div className="w-full px-3 py-2 border border-[#E1E3E5] rounded-md text-sm font-medium text-[#202223] hover:bg-white transition-colors text-center">
                  View details
                </div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm">
            <div className="border-b border-[#E1E3E5] px-5 py-4">
              <h2 className="text-base font-semibold text-[#202223]">Recent Activity</h2>
              <p className="text-sm text-[#6D7175] mt-1">System events and updates</p>
            </div>
            <div className="p-5">
              <div className="space-y-4">
                {recentActivity.map((activity, idx) => (
                  <div key={idx} className="flex items-start gap-3 pb-4 border-b border-[#E1E3E5] last:border-0 last:pb-0">
                    <div className="w-2 h-2 rounded-full bg-[#005BD3] mt-2 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-[#202223]">{activity.event}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-xs text-[#6D7175]">{activity.caseId}</span>
                        <span className="text-xs text-[#6D7175]">•</span>
                        <span className="text-xs text-[#6D7175]">{activity.timestamp}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm">
            <div className="border-b border-[#E1E3E5] px-5 py-4">
              <h2 className="text-base font-semibold text-[#202223]">Insights</h2>
              <p className="text-sm text-[#6D7175] mt-1">Win rate and dispute categories</p>
            </div>
            <div className="p-5">
              <div className="space-y-6">
                <div>
                  <h4 className="text-sm font-medium text-[#202223] mb-3">Win rate trend</h4>
                  <div className="flex items-end gap-2 h-24">
                    <div className="flex-1 bg-[#E1E3E5] rounded-t" style={{height: '60%'}} />
                    <div className="flex-1 bg-[#E1E3E5] rounded-t" style={{height: '65%'}} />
                    <div className="flex-1 bg-[#E1E3E5] rounded-t" style={{height: '58%'}} />
                    <div className="flex-1 bg-[#005BD3] rounded-t" style={{height: '68%'}} />
                  </div>
                  <div className="flex justify-between mt-2">
                    <span className="text-xs text-[#6D7175]">Q1</span>
                    <span className="text-xs text-[#6D7175]">Q2</span>
                    <span className="text-xs text-[#6D7175]">Q3</span>
                    <span className="text-xs text-[#6D7175]">Q4</span>
                  </div>
                </div>

                <div>
                  <h4 className="text-sm font-medium text-[#202223] mb-3">Top dispute categories</h4>
                  <div className="space-y-3">
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[#202223]">Fraudulent</span>
                        <span className="text-[#6D7175]">42%</span>
                      </div>
                      <div className="w-full bg-[#E1E3E5] rounded-full h-2">
                        <div className="bg-[#005BD3] h-2 rounded-full" style={{width: '42%'}} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[#202223]">Product Not Received</span>
                        <span className="text-[#6D7175]">28%</span>
                      </div>
                      <div className="w-full bg-[#E1E3E5] rounded-full h-2">
                        <div className="bg-[#005BD3] h-2 rounded-full" style={{width: '28%'}} />
                      </div>
                    </div>
                    <div>
                      <div className="flex justify-between text-sm mb-1">
                        <span className="text-[#202223]">Product Unacceptable</span>
                        <span className="text-[#6D7175]">18%</span>
                      </div>
                      <div className="w-full bg-[#E1E3E5] rounded-full h-2">
                        <div className="bg-[#005BD3] h-2 rounded-full" style={{width: '18%'}} />
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => handleNavigate('/shopify/disputes')}
            className="flex-1 p-4 border border-[#E1E3E5] rounded-lg hover:border-[#005BD3] hover:bg-[#F6F8FB] transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <BarChart3 className="w-5 h-5 text-[#005BD3]" />
              <span className="text-sm font-medium text-[#202223]">Manage cases</span>
            </div>
          </button>
          <button
            onClick={() => handleNavigate('/shopify/coverage')}
            className="flex-1 p-4 border border-[#E1E3E5] rounded-lg hover:border-[#005BD3] hover:bg-[#F6F8FB] transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <CheckCircle className="w-5 h-5 text-[#005BD3]" />
              <span className="text-sm font-medium text-[#202223]">Configure evidence packs</span>
            </div>
          </button>
          <button
            onClick={() => handleNavigate('/shopify/automation')}
            className="flex-1 p-4 border border-[#E1E3E5] rounded-lg hover:border-[#005BD3] hover:bg-[#F6F8FB] transition-all text-left group"
          >
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-[#005BD3]" />
              <span className="text-sm font-medium text-[#202223]">Automation rules</span>
            </div>
          </button>
        </div>
      </div>
    </ShopifyShell>
  );
}
