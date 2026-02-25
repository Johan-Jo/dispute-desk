import { Shield, ArrowRight, Check, Lock, FileText, BarChart3, Zap, RefreshCw } from "lucide-react";
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
              <p className="text-sm uppercase tracking-wide text-[#1D4ED8] font-medium mb-3">
                Dispute operations for Shopify
              </p>
              <h1 className="text-5xl lg:text-6xl font-bold text-[#0B1220] mb-6 leading-tight">
                Run chargebacks like an ops team&nbsp;&mdash; not a 25% success-fee tax.
              </h1>
              <p className="text-xl text-[#64748B] mb-8 leading-relaxed">
                DisputeDesk helps you build evidence packs fast, enforce completeness,
                and keep a defensible audit trail&nbsp;&mdash; with merchant-controlled
                workflows and predictable pricing.
              </p>

              <div className="space-y-4 mb-8">
                <div className="flex items-start gap-3">
                  <Zap className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">Evidence packs in minutes &mdash; drafts are unlimited, packs count only on export</p>
                </div>
                <div className="flex items-start gap-3">
                  <Check className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">Review queue + completeness gate to prevent weak submissions</p>
                </div>
                <div className="flex items-start gap-3">
                  <BarChart3 className="w-6 h-6 text-[#22C55E] flex-shrink-0 mt-1" />
                  <p className="text-[#0B1220]">Immutable audit trail for every change, file, and decision</p>
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                <a href="/portal/connect-shopify">
                  <Button variant="primary" size="lg">
                    Install free
                    <ArrowRight className="w-5 h-5 ml-2" />
                  </Button>
                </a>
                <a href="#pricing">
                  <Button variant="secondary" size="lg">View pricing</Button>
                </a>
              </div>

              <p className="text-sm text-[#64748B] mt-6 border-t border-[#E5E7EB] pt-6">
                Evidence is saved to Shopify via API. Submission to the card
                network happens in Shopify Admin (or auto-submits on due date).
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
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">1. Connect Once</h3>
              <p className="text-[#64748B]">Install from the Shopify App Store. DisputeDesk syncs disputes automatically from that point on.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#DCFCE7] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <Zap className="w-8 h-8 text-[#22C55E]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">2. Auto-Generate Packs</h3>
              <p className="text-[#64748B]">When a dispute appears, DisputeDesk automatically builds an evidence pack with rules and completeness scoring.</p>
            </div>
            <div className="text-center">
              <div className="w-16 h-16 bg-[#FEF3C7] rounded-2xl flex items-center justify-center mx-auto mb-6">
                <RefreshCw className="w-8 h-8 text-[#F59E0B]" />
              </div>
              <h3 className="text-xl font-semibold text-[#0B1220] mb-3">3. Auto-Save to Shopify</h3>
              <p className="text-[#64748B]">Complete packs are saved to Shopify automatically. Submit in Shopify Admin or let Shopify auto-submit on due date.</p>
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
          <div className="text-center mb-6">
            <h2 className="text-4xl font-bold text-[#0B1220] mb-4">Predictable pricing for dispute ops</h2>
            <p className="text-xl text-[#64748B] max-w-2xl mx-auto">
              Free is for evaluation. Paid plans are for running dispute operations&nbsp;&mdash;
              with clear pack limits and simple top-ups. No hidden percentage.
            </p>
          </div>
          <p className="text-center text-sm text-[#94A3B8] mb-12">
            Paid plans include a 14-day trial with 25 packs. Free includes 3 packs total (lifetime).
          </p>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-12">
            {/* Free */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">Free (Sandbox)</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$0</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Unlimited draft building</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Evidence pack builder</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />3 exported packs (lifetime)</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Basic activity log</li>
              </ul>
              <a href="/auth/sign-up"><Button variant="secondary" className="w-full">Get Started</Button></a>
            </div>

            {/* Starter */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">Starter</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$29</span><span className="text-[#64748B] text-sm">/mo</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />15 packs/month included</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Basic rules (up to 5)</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Review queue + completeness gate</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Auto-build evidence packs</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Email support</li>
              </ul>
              <a href="/portal/connect-shopify"><Button variant="secondary" className="w-full">Start 14-Day Trial</Button></a>
            </div>

            {/* Growth */}
            <div className="bg-[#1D4ED8] rounded-xl p-6 text-white relative">
              <div className="absolute top-3 right-3 bg-white text-[#1D4ED8] text-xs font-semibold px-2 py-0.5 rounded">Popular</div>
              <h3 className="text-lg font-semibold mb-1">Growth</h3>
              <div className="mb-5"><span className="text-3xl font-bold">$79</span><span className="opacity-80 text-sm">/mo</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />75 packs/month included</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />Advanced rules &amp; playbooks</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />Bulk actions + templates</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />Multi-user access</li>
                <li className="flex items-start gap-2 text-sm"><Check className="w-4 h-4 flex-shrink-0 mt-0.5" />Auto-save to Shopify</li>
              </ul>
              <a href="/portal/connect-shopify"><Button variant="secondary" className="w-full bg-white text-[#1D4ED8] hover:bg-[#F6F8FB]">Start 14-Day Trial</Button></a>
            </div>

            {/* Scale */}
            <div className="bg-white rounded-xl p-6 border border-[#E5E7EB]">
              <h3 className="text-lg font-semibold text-[#0B1220] mb-1">Scale</h3>
              <div className="mb-5"><span className="text-3xl font-bold text-[#0B1220]">$149</span><span className="text-[#64748B] text-sm">/mo</span></div>
              <ul className="space-y-2.5 mb-6">
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />300 packs/month included</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Multi-store support</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Advanced exports + audit trail</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />SLA options</li>
                <li className="flex items-start gap-2 text-sm text-[#64748B]"><Check className="w-4 h-4 text-[#22C55E] flex-shrink-0 mt-0.5" />Priority support</li>
              </ul>
              <a href="/portal/connect-shopify"><Button variant="secondary" className="w-full">Start 14-Day Trial</Button></a>
            </div>
          </div>

          {/* Top-ups */}
          <div className="bg-[#F6F8FB] rounded-xl p-8 border border-[#E5E7EB]">
            <h3 className="text-lg font-semibold text-[#0B1220] mb-2">Need more packs?</h3>
            <p className="text-sm text-[#64748B] mb-4">
              Purchase top-up bundles any time. Credits are added immediately upon payment.
            </p>
            <div className="flex flex-col sm:flex-row gap-4">
              <div className="flex items-center gap-3 bg-white rounded-lg px-5 py-3 border border-[#E5E7EB]">
                <span className="font-semibold text-[#0B1220]">+25 packs</span>
                <span className="text-[#64748B]">$19</span>
              </div>
              <div className="flex items-center gap-3 bg-white rounded-lg px-5 py-3 border border-[#E5E7EB]">
                <span className="font-semibold text-[#0B1220]">+100 packs</span>
                <span className="text-[#64748B]">$59</span>
              </div>
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
