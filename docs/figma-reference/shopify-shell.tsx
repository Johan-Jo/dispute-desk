import React, { useState } from 'react';
import { Shield, ThumbsUp, Star, X, Home, ShoppingCart, Package, Users, BarChart, Settings, FileText, Zap, AlertCircle, Search, Bell, LayoutDashboard, Info, CreditCard } from 'lucide-react';
import ShopifyDisputes from './shopify-disputes';
import ShopifyDisputeDetail from './shopify-dispute-detail';
import ShopifyPacks from './shopify-packs';
import ShopifyRules from './shopify-rules';
import ShopifyAnalytics from './shopify-analytics';
import ShopifySettings from './shopify-settings';
import ShopifyPlanManagement from './shopify-plan-management';
import { TemplateSetupWizard } from './template-setup-wizard';
import { PolicySetupWizard } from './policy-setup-wizard';

interface ShopifyShellProps {
  currentPath: string;
  onNavigate?: (path: string) => void;
  children?: React.ReactNode;
}

export default function ShopifyShell({ currentPath, onNavigate, children }: ShopifyShellProps) {
  const [feedbackRating, setFeedbackRating] = useState(0);
  const [hoveredStar, setHoveredStar] = useState(0);
  const [showFeedback, setShowFeedback] = useState(true);
  const [showReviewModal, setShowReviewModal] = useState(false);
  const [reviewRating, setReviewRating] = useState(0);
  const [reviewHoveredStar, setReviewHoveredStar] = useState(0);
  const [reviewText, setReviewText] = useState('');

  const appNavItems = [
    { label: 'Dashboard', path: '/shopify', icon: LayoutDashboard },
    { label: 'Disputes', path: '/shopify/disputes', icon: AlertCircle },
    { label: 'Evidence Packs', path: '/shopify/packs', icon: FileText },
    { label: 'Rules', path: '/shopify/rules', icon: Zap },
    { label: 'Plan', path: '/shopify/plan-management', icon: CreditCard },
    { label: 'Settings', path: '/shopify/settings', icon: Settings },
  ];

  const handleStarClick = (star: number) => {
    setFeedbackRating(star);
    setShowReviewModal(true);
  };

  const renderPage = () => {
    if (children) return children;
    
    if (currentPath === '/shopify/disputes') return <ShopifyDisputes onNavigate={onNavigate} />;
    if (currentPath.startsWith('/shopify/disputes/')) return <ShopifyDisputeDetail onNavigate={onNavigate} />;
    if (currentPath === '/shopify/packs') return <ShopifyPacks onNavigate={onNavigate} />;
    if (currentPath === '/shopify/rules') return <ShopifyRules onNavigate={onNavigate} />;
    if (currentPath === '/shopify/analytics') return <ShopifyAnalytics />;
    if (currentPath === '/shopify/settings') return <ShopifySettings />;
    if (currentPath === '/shopify/plan-management') return <ShopifyPlanManagement onNavigate={onNavigate} />;
    
    return children;
  };

  return (
    <div className="min-h-screen bg-[#F1F2F4]">
      {/* Shopify Top Bar */}
      <div className="bg-[#1A1A1A] text-white h-14 flex items-center px-4 border-b border-[#303030]">
        <div className="flex items-center gap-4 flex-1">
          {/* Shopify Logo */}
          <svg className="w-8 h-8" viewBox="0 0 32 32" fill="currentColor">
            <path d="M24.373 9.076c-.024-.165-.154-.265-.293-.265-.024 0-2.482-.13-2.482-.13s-1.61-1.564-1.78-1.733c-.172-.17-.507-.118-.64-.082 0 0-.32.1-.857.268-.078-.23-.186-.517-.332-.824-.455-1.013-1.127-1.55-1.942-1.55-.055 0-.112.006-.17.012-.03-.04-.062-.078-.096-.116C15.276 3.923 14.556 3.61 13.66 3.61c-1.775 0-3.526 1.326-4.93 3.732-.99 1.694-1.738 3.81-1.942 5.49-1.67.516-2.842.877-2.876.89-.848.264-.872.29-.982 1.087C2.843 15.44 0 30.824 0 30.824l19.26 3.334 9.003-2.224s-3.865-26.31-3.89-26.474zM17.97 7.74c-.48.15-.997.31-1.545.478V7.82c0-.842-.115-1.52-.306-2.062.825.12 1.43.976 1.85 1.983zm-3.116-.733c-.266.824-.61 1.752-.997 2.697-.76-2.915-2.063-4.32-3.014-4.83.206-.013.403-.02.59-.02 1.478 0 2.595.76 3.42 2.153zm-4.818.24c-.69.216-1.44.45-2.233.696.673-2.597 1.938-3.85 3.25-4.315-.668.642-1.372 1.91-2.017 3.62z"/>
          </svg>
          
          {/* Search */}
          <div className="flex-1 max-w-md">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search"
                className="w-full bg-[#303030] border border-[#404040] rounded-lg pl-10 pr-4 py-1.5 text-sm text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-[#008060]"
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <button className="text-gray-300 hover:text-white">
            <Bell className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-[#5E4DB2] rounded-full flex items-center justify-center text-xs font-semibold">
              SE
            </div>
            <span className="text-sm">saraeverine</span>
          </div>
        </div>
      </div>

      <div className="flex">
        {/* Shopify Left Sidebar */}
        <div className="w-60 bg-[#F7F8FA] border-r border-[#E1E3E5] min-h-[calc(100vh-56px)]">
          <nav className="p-2">
            <div className="mb-6">
              <div className="space-y-0.5">
                {[
                  { icon: Home, label: 'Home' },
                  { icon: ShoppingCart, label: 'Orders' },
                  { icon: Package, label: 'Products' },
                  { icon: Users, label: 'Customers' },
                  { icon: BarChart, label: 'Analytics' },
                ].map((item) => (
                  <button
                    key={item.label}
                    className="w-full flex items-center gap-3 px-3 py-2 text-sm text-[#202223] hover:bg-[#E3E5E7] rounded-lg transition-colors"
                  >
                    <item.icon className="w-5 h-5 text-[#6D7175]" />
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Apps Section */}
            <div className="mb-3">
              <button className="w-full flex items-center justify-between px-3 py-2 text-sm text-[#6D7175] hover:text-[#202223] transition-colors">
                <span className="font-medium">Apps</span>
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                </svg>
              </button>
            </div>

            {/* DisputeDesk App */}
            <div className="mb-3">
              <div className="flex items-center justify-between px-3 py-2 hover:bg-[#E3E5E7] rounded-lg transition-colors group">
                <div className="flex items-center gap-2">
                  <Shield className="w-4 h-4 text-[#6D7175]" />
                  <span className="text-sm font-medium text-[#202223]">DisputeDesk</span>
                </div>
                <button className="opacity-0 group-hover:opacity-100 text-[#6D7175] hover:text-[#202223]">
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>
              </div>
            </div>

            {/* DisputeDesk Navigation */}
            <div className="space-y-0.5 pl-3">
              {appNavItems.map((item) => {
                const Icon = item.icon;
                const isActive = currentPath === item.path;
                return (
                  <button
                    key={item.path}
                    onClick={() => onNavigate?.(item.path)}
                    className={`w-full text-left px-3 py-1.5 text-sm rounded-lg transition-colors flex items-center gap-2 ${
                      isActive
                        ? 'bg-[#E0F2FE] text-[#1D4ED8] font-medium'
                        : 'text-[#6D7175] hover:text-[#202223] hover:bg-[#E3E5E7]'
                    }`}
                  >
                    <Icon className={`w-4 h-4 ${isActive ? 'text-[#1D4ED8]' : 'text-[#6D7175]'}`} />
                    {item.label}
                  </button>
                );
              })}
            </div>
          </nav>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 min-h-[calc(100vh-56px)] overflow-y-auto">
          {/* App Header */}
          <div className="bg-white border-b border-[#E1E3E5] px-8 py-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-[#5E4DB2] rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <h1 className="text-xl font-semibold text-[#202223]">DisputeDesk</h1>
              </div>
              <button className="text-[#6D7175] hover:text-[#202223]">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                </svg>
              </button>
            </div>
          </div>

          {/* Feedback Bar */}
          {showFeedback && (
            <div className="px-8 py-4 bg-[#F1F2F4] border-b border-[#E1E3E5]">
              <div className="bg-white border border-[#E1E3E5] rounded-lg shadow-sm px-6 py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ThumbsUp className="w-5 h-5 text-[#5E4DB2]" />
                    <span className="text-sm text-[#202223]">
                      How's your experience with DisputeDesk?{' '}
                      <span className="text-[#6D7175]">Your feedback helps us improve the app.</span>
                    </span>
                    <div className="flex items-center gap-1 ml-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => handleStarClick(star)}
                          onMouseEnter={() => setHoveredStar(star)}
                          onMouseLeave={() => setHoveredStar(0)}
                          className="transition-colors"
                        >
                          <Star
                            className={`w-5 h-5 ${
                              star <= (hoveredStar || feedbackRating)
                                ? 'fill-[#FFC107] text-[#FFC107]'
                                : 'text-[#C9CCCF]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => setShowFeedback(false)}
                    className="text-[#6D7175] hover:text-[#202223] transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Review Modal */}
          {showReviewModal && (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white rounded-lg shadow-xl w-full max-w-md mx-4">
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-[#E1E3E5]">
                  <h2 className="text-lg font-semibold text-[#202223]">Review this app</h2>
                  <button
                    onClick={() => setShowReviewModal(false)}
                    className="text-[#6D7175] hover:text-[#202223] transition-colors"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>

                {/* Modal Content */}
                <div className="px-5 py-4">
                  {/* Development Store Notice */}
                  <div className="flex items-start gap-3 p-3 bg-[#F6F8FB] rounded-lg mb-5">
                    <Info className="w-5 h-5 text-[#1D4ED8] flex-shrink-0 mt-0.5" />
                    <p className="text-sm text-[#202223]">
                      Development stores aren't eligible to review apps. This is for testing purposes only.
                    </p>
                  </div>

                  {/* Rating Section */}
                  <div className="mb-5">
                    <div className="flex items-center gap-3 mb-3">
                      <div className="w-10 h-10 bg-[#5E4DB2] rounded-lg flex items-center justify-center flex-shrink-0">
                        <Shield className="w-6 h-6 text-white" />
                      </div>
                      <span className="text-sm text-[#202223] font-medium">
                        How would you rate DisputeDesk?
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      {[1, 2, 3, 4, 5].map((star) => (
                        <button
                          key={star}
                          onClick={() => setReviewRating(star)}
                          onMouseEnter={() => setReviewHoveredStar(star)}
                          onMouseLeave={() => setReviewHoveredStar(0)}
                          className="transition-colors"
                        >
                          <Star
                            className={`w-6 h-6 ${
                              star <= (reviewHoveredStar || reviewRating)
                                ? 'fill-[#FFC107] text-[#FFC107]'
                                : 'text-[#C9CCCF]'
                            }`}
                          />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Review Text */}
                  <div className="mb-5">
                    <label className="block text-sm font-medium text-[#202223] mb-2">
                      Describe your experience (optional)
                    </label>
                    <textarea
                      value={reviewText}
                      onChange={(e) => setReviewText(e.target.value)}
                      placeholder="What should other merchants know about this app?"
                      rows={4}
                      className="w-full px-3 py-2 border border-[#C9CCCF] rounded-lg text-sm text-[#202223] placeholder-[#8C9196] focus:outline-none focus:ring-2 focus:ring-[#005BD3] focus:border-transparent resize-none"
                    />
                  </div>

                  {/* Shopify App Store Notice */}
                  <div className="flex items-start gap-2 mb-5">
                    <Info className="w-4 h-4 text-[#6D7175] flex-shrink-0 mt-0.5" />
                    <p className="text-xs text-[#6D7175]">
                      If your review is published on the Shopify App Store, we'll include some details about your store.
                    </p>
                  </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-[#E1E3E5]">
                  <button className="text-sm font-medium text-[#005BD3] hover:text-[#004C9B] transition-colors">
                    Get support
                  </button>
                  <button
                    disabled={reviewRating === 0}
                    className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
                      reviewRating === 0
                        ? 'bg-[#E4E5E7] text-[#8C9196] cursor-not-allowed'
                        : 'bg-[#005BD3] text-white hover:bg-[#004C9B]'
                    }`}
                  >
                    Submit
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Page Content */}
          <div className="px-8 py-6 bg-[#F1F2F4]">
            {renderPage()}
          </div>
        </div>
      </div>
    </div>
  );
}