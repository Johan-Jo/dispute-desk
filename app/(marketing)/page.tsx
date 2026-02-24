import { Shield, ArrowRight, Check, Lock, FileText, BarChart3, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function MarketingLandingPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* Header */}
      <header className="border-b border-[#E5E7EB] sticky top-0 bg-white z-50">
        <div className="max-w-[1440px] mx-auto px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
              <Shield className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-xl font-bold text-[#0B1220]">DisputeDesk</h1>
          </div>

          <nav className="hidden md:flex items-center gap-8">
            <a href="#product" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">Product</a>
            <a href="#how-it-works" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">How it works</a>
            <a href="#security" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">Security</a>
            <a href="#pricing" className="text-sm text-[#64748B] hover:text-[#0B1220] transition-colors">Pricing</a>
          </nav>

          <div className="flex items-center gap-3">
            <a href="/auth/sign-in">
              <Button variant="ghost" size="sm">Sign in</Button>
            </a>
            <a href="/portal/connect-shopify">
              <Button variant="primary" size="sm">Install on Shopify</Button>
            </a>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="py-20 lg:py-28" style={{ background: "linear-gradient(180deg, #EFF6FF 0%, #FFFFFF 60%)" }}>
        <div className="max-w-[1440px] mx-auto px-8">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 items-center">
            <div>
              <h1 className="text-5xl lg:text-6xl font-bold text-[#0B1220] mb-6 leading-tight">
                Your command center for Shopify disputes.
              </h1>
              <p className="text-xl text-[#64748B] mb-8 leading-relaxed">
                Generate evidence packs, see what&apos;s missing, and save evidence
                back to Shopify&nbsp;&mdash; you stay in control.
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <Check className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">One-click evidence packs (orders, tracking, policies, uploads)</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">Checklist + completeness score per reason</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">Immutable audit trail</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <a href="/portal/connect-shopify">
                  <Button variant="primary" size="lg">
                    Install on Shopify
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
                <a href="/auth/sign-in">
                  <Button variant="secondary" size="lg">Sign in</Button>
                </a>
              </div>

              <p className="text-sm text-[#64748B] mt-6 border-t border-[#E5E7EB] pt-6">
                Evidence can be saved via API. Submission happens in Shopify Admin.
              </p>
            </div>

            {/* Product preview card */}
            <div className="relative hidden lg:block">
              <div className="bg-white rounded-2xl shadow-2xl border border-[#E5E7EB] p-6">
                <div className="mb-4">
                  <h3 className="font-semibold text-[#0B1220] mb-2">Review Queue</h3>
                  <div className="space-y-3">
                    {[1, 2, 3].map((i) => (
                      <div key={i} className="flex items-center justify-between p-3 bg-[#F6F8FB] rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-[#DBEAFE] rounded-lg" />
                          <div>
                            <p className="text-sm font-medium text-[#0B1220]">DP-240{i}</p>
                            <p className="text-xs text-[#64748B]">$145.00</p>
                          </div>
                        </div>
                        <div className="px-2 py-1 bg-[#FEF3C7] text-[#92400E] text-xs rounded-md">Review</div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#DBEAFE] rounded-lg p-4 border border-[#BFDBFE]">
                  <h4 className="font-semibold text-[#0B1220] mb-3">Pack Completeness</h4>
                  <div className="space-y-2">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#64748B]">Order Confirmation</span>
                      <Check className="w-4 h-4 text-[#22C55E]" />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#64748B]">Shipping Tracking</span>
                      <Check className="w-4 h-4 text-[#22C55E]" />
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-[#64748B]">Customer Communication</span>
                      <div className="w-4 h-4 border-2 border-[#E5E7EB] rounded" />
                    </div>
                  </div>
                  <div className="mt-3 pt-3 border-t border-[#BFDBFE]">
                    <div className="flex items-center justify-between text-sm font-medium">
                      <span className="text-[#0B1220]">Completeness Score</span>
                      <span className="text-[#1D4ED8]">67%</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How It Works */}
      <section id="how-it-works" className="py-20">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">How it works</h2>
            <p className="text-xl text-[#64748B]">Three simple steps to better dispute management</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="text-center">
              <div className="w-16 h-16 bg-[#DBEAFE] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Shield className="w-8 h-8 text-[#1D4ED8]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">1. Connect Your Store</h3>
              <p className="text-[#64748B]">Install the app from Shopify App Store. Grant read-only access to orders and disputes.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#DCFCE7] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <FileText className="w-8 h-8 text-[#22C55E]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">2. Generate Evidence</h3>
              <p className="text-[#64748B]">Click any dispute to generate a complete evidence pack with checklists and completeness scoring.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#FEF3C7] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <ExternalLink className="w-8 h-8 text-[#F59E0B]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">3. Submit in Shopify</h3>
              <p className="text-[#64748B]">Evidence is saved back to Shopify. Submit to the card network directly from Shopify Admin.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" className="py-20 bg-[#F6F8FB]">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">Built for security and compliance</h2>
            <p className="text-xl text-[#64748B]">Your data is protected at every step</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <Lock className="w-8 h-8 text-[#1D4ED8] mb-4" />
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">Encrypted Tokens</h3>
              <p className="text-sm text-[#64748B]">All API keys and access tokens are encrypted at rest with AES-256.</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <BarChart3 className="w-8 h-8 text-[#1D4ED8] mb-4" />
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">Immutable Audit Log</h3>
              <p className="text-sm text-[#64748B]">Every action is logged with timestamps and user attribution for full traceability.</p>
            </div>
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <FileText className="w-8 h-8 text-[#1D4ED8] mb-4" />
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">Signed URLs</h3>
              <p className="text-sm text-[#64748B]">Evidence files are stored with time-limited signed URLs to prevent unauthorized access.</p>
            </div>
          </div>
        </div>
      </section>

      {/* Pricing */}
      <section id="pricing" className="py-20">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="text-center mb-16">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">Simple, transparent pricing</h2>
            <p className="text-xl text-[#64748B]">Choose the plan that fits your business</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="bg-white rounded-xl p-8 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">Free</h3>
              <div className="mb-6"><span className="text-4xl font-bold text-[#0B1220]">$0</span><span className="text-[#64748B]"> / month</span></div>
              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Up to 10 disputes/month</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />5 evidence packs</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Email support</li>
              </ul>
              <Button variant="secondary" className="w-full">Get Started</Button>
            </div>
            <div className="bg-[#1D4ED8] rounded-xl p-8 text-white relative">
              <div className="absolute top-4 right-4 bg-white text-[#1D4ED8] text-xs font-semibold px-2 py-1 rounded">Popular</div>
              <h3 className="text-lg font-semibold mb-2">Starter</h3>
              <div className="mb-6"><span className="text-4xl font-bold">$49</span><span className="opacity-80"> / month</span></div>
              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-2 text-sm"><Check className="w-5 h-5 flex-shrink-0" />Up to 50 disputes/month</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-5 h-5 flex-shrink-0" />20 evidence packs</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-5 h-5 flex-shrink-0" />Priority support</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-5 h-5 flex-shrink-0" />Basic automation</li>
              </ul>
              <Button variant="secondary" className="w-full bg-white text-[#1D4ED8] hover:bg-[#F6F8FB]">Start Free Trial</Button>
            </div>
            <div className="bg-white rounded-xl p-8 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-2">Pro</h3>
              <div className="mb-6"><span className="text-4xl font-bold text-[#0B1220]">$99</span><span className="text-[#64748B]"> / month</span></div>
              <ul className="space-y-3 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Unlimited disputes</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Unlimited packs</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Priority support</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Advanced automation</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-5 h-5 text-[#22C55E] flex-shrink-0" />Custom rules</li>
              </ul>
              <Button variant="secondary" className="w-full">Start Free Trial</Button>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="bg-[#0B1220] text-white py-12">
        <div className="max-w-[1200px] mx-auto px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8 mb-8">
            <div>
              <div className="flex items-center gap-2 mb-4">
                <div className="w-8 h-8 bg-[#1D4ED8] rounded-lg flex items-center justify-center">
                  <Shield className="w-5 h-5 text-white" />
                </div>
                <span className="text-lg font-bold">DisputeDesk</span>
              </div>
              <p className="text-sm text-gray-400">Your command center for Shopify disputes.</p>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Product</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#product" className="hover:text-white transition-colors">Features</a></li>
                <li><a href="#pricing" className="hover:text-white transition-colors">Pricing</a></li>
                <li><a href="#security" className="hover:text-white transition-colors">Security</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">About</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Contact</a></li>
              </ul>
            </div>
            <div>
              <h3 className="font-semibold mb-4">Legal</h3>
              <ul className="space-y-2 text-sm text-gray-400">
                <li><a href="#" className="hover:text-white transition-colors">Terms of Service</a></li>
                <li><a href="#" className="hover:text-white transition-colors">Privacy Policy</a></li>
              </ul>
            </div>
          </div>
          <div className="border-t border-gray-800 pt-8 text-sm text-gray-400 text-center">
            <p>&copy; 2026 DisputeDesk. Not affiliated with Shopify Inc.</p>
          </div>
        </div>
      </footer>
    </div>
  );
}
