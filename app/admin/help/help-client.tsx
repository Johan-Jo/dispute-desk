"use client";

import { useState, useRef, useEffect } from "react";
import {
  Search,
  LayoutDashboard,
  Store,
  Briefcase,
  CreditCard,
  ScrollText,
  BookOpen,
  Sparkles,
  Settings,
  GitBranch,
  LogIn,
  Globe,
  Zap,
} from "lucide-react";

const SECTIONS = [
  { id: "login", label: "Login", icon: LogIn },
  { id: "dashboard", label: "Dashboard", icon: LayoutDashboard },
  { id: "shops", label: "Shops", icon: Store },
  { id: "jobs", label: "Job Monitor", icon: Briefcase },
  { id: "billing", label: "Billing", icon: CreditCard },
  { id: "audit", label: "Audit Log", icon: ScrollText },
  { id: "resources", label: "Resources Hub", icon: BookOpen },
  { id: "editor", label: "Content Editor", icon: BookOpen },
  { id: "ai-generator", label: "AI Generator", icon: Sparkles },
  { id: "autopilot", label: "Autopilot Mode", icon: Zap },
  { id: "seo", label: "SEO & Indexing", icon: Globe },
  { id: "settings", label: "Settings", icon: Settings },
  { id: "workflow", label: "Workflow Reference", icon: GitBranch },
] as const;

export function HelpClient() {
  const [search, setSearch] = useState("");
  const [activeSection, setActiveSection] = useState("login");
  const contentRef = useRef<HTMLDivElement>(null);

  function scrollToSection(id: string) {
    setActiveSection(id);
    const el = document.getElementById(`help-${id}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const id = entry.target.id.replace("help-", "");
            setActiveSection(id);
          }
        }
      },
      { rootMargin: "-20% 0px -70% 0px" }
    );
    for (const section of SECTIONS) {
      const el = document.getElementById(`help-${section.id}`);
      if (el) observer.observe(el);
    }
    return () => observer.disconnect();
  }, []);

  const filteredSections = search
    ? SECTIONS.filter((s) => s.label.toLowerCase().includes(search.toLowerCase()))
    : SECTIONS;

  return (
    <div className="flex h-[calc(100vh-57px)]">
      {/* Sidebar */}
      <aside className="w-64 border-r border-[#E5E7EB] bg-white overflow-y-auto shrink-0 hidden lg:block">
        <div className="p-4 border-b border-[#E5E7EB]">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#64748B]" />
            <input
              type="text"
              placeholder="Search help..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm border border-[#E5E7EB] rounded-lg bg-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#1D4ED8]/20"
            />
          </div>
        </div>
        <nav className="p-2">
          {filteredSections.map((s) => {
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => scrollToSection(s.id)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${
                  activeSection === s.id
                    ? "bg-[#EFF6FF] text-[#1D4ED8] font-medium"
                    : "text-[#64748B] hover:bg-[#F8FAFC] hover:text-[#0B1220]"
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                {s.label}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        <div className="max-w-[800px] mx-auto p-6 lg:p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-[#0B1220]">Admin Guide</h1>
            <p className="text-sm text-[#64748B] mt-1">
              Complete reference for the DisputeDesk admin panel
            </p>
          </div>

          {/* LOGIN */}
          <Section id="login" title="Login">
            <P>Navigate to <Code>/admin/login</Code> and enter the admin secret (configured as <Code>ADMIN_SECRET</Code> in your environment). Your session persists across browser tabs via the <Code>dd_admin_session</Code> cookie.</P>
          </Section>

          {/* DASHBOARD */}
          <Section id="dashboard" title="Dashboard">
            <P>The main dashboard at <Code>/admin</Code> shows a real-time platform snapshot:</P>
            <Table headers={["Card", "Shows"]} rows={[
              ["Active Shops", "Installed shops (with uninstalled count)"],
              ["Total Disputes", "All disputes across all shops"],
              ["Evidence Packs", "Total packs generated"],
              ["Queued Jobs", "Jobs waiting to run (with failed count)"],
            ]} />
            <P>Below the cards: <Strong>Plan Distribution</Strong> (shops per plan) and <Strong>Pack Status Breakdown</Strong> (packs per status).</P>
          </Section>

          {/* SHOPS */}
          <Section id="shops" title="Shops">
            <P>At <Code>/admin/shops</Code>, search and browse all installed shops. Each row shows domain, plan, install date, and status.</P>
            <P>Click a shop domain for the detail page where you can override the <Strong>plan</Strong>, set a custom <Strong>pack limit</Strong>, and add <Strong>admin notes</Strong>.</P>
          </Section>

          {/* JOBS */}
          <Section id="jobs" title="Job Monitor">
            <P>At <Code>/admin/jobs</Code>, monitor background jobs (dispute sync, pack builds, PDF rendering, Shopify saves).</P>
            <Table headers={["Tab", "Shows"]} rows={[
              ["Queued", "Jobs waiting to be picked up"],
              ["Running", "Currently processing"],
              ["Failed", "Exhausted all retries"],
              ["Completed", "Successfully finished"],
            ]} />
            <P>Actions: <Strong>Retry</Strong> failed jobs or <Strong>Cancel</Strong> queued/running ones. Stale jobs are highlighted yellow.</P>
          </Section>

          {/* BILLING */}
          <Section id="billing" title="Billing Dashboard">
            <P>At <Code>/admin/billing</Code> — MRR card, plan distribution, and per-shop usage table with color-coded bars (green &lt; 50%, yellow 50-80%, red &gt; 80%).</P>
          </Section>

          {/* AUDIT */}
          <Section id="audit" title="Audit Log">
            <P>At <Code>/admin/audit</Code> — every significant action is logged. Filter by Shop ID or event type. Toggle JSON payloads per row. <Strong>Export CSV</Strong> downloads the filtered log.</P>
          </Section>

          {/* RESOURCES HUB */}
          <Section id="resources" title="Resources Hub">
            <P>The Resources Hub at <Code>/admin/resources</Code> is a full editorial CMS for managing articles across 6 locales.</P>
            <Table headers={["Screen", "Path", "Purpose"]} rows={[
              ["Dashboard", "/admin/resources", "KPIs, upcoming scheduled, translation gaps, queue health"],
              ["Content List", "/admin/resources/list", "All content with status tabs, search, filters, multi-select"],
              ["Editor", "/admin/resources/content/[id]", "Block editor, locale switching, metadata, publishing"],
              ["Backlog", "/admin/resources/backlog", "Ideas pipeline with priority scoring"],
              ["Calendar", "/admin/resources/calendar", "Agenda + grid views of scheduled publications"],
              ["Queue", "/admin/resources/queue", "Publishing queue monitor with retry"],
              ["Settings", "/admin/resources/settings", "Publishing, translation, workflow, autopilot config"],
            ]} />
          </Section>

          {/* EDITOR */}
          <Section id="editor" title="Content Editor">
            <P>The block editor at <Code>/admin/resources/content/[id]</Code> supports 13 block types:</P>
            <Table headers={["Block", "Use For"]} rows={[
              ["Rich HTML", "Existing HTML content, complex formatting"],
              ["Paragraph", "Plain text paragraphs"],
              ["Heading", "H2, H3, H4 section headings"],
              ["List", "Bullet or numbered lists"],
              ["Callout", "Tips, warnings, important notes"],
              ["Code", "Code snippets with syntax highlighting"],
              ["Quote", "Blockquotes with optional citation"],
              ["Divider", "Visual section separator"],
              ["Image", "Images with URL, alt text, and caption"],
              ["Key Takeaways", "Summary points (blue gradient card on public site)"],
              ["FAQ", "Question/answer pairs"],
              ["Disclaimer", "Legal disclaimer text"],
              ["Update Log", "Article revision history"],
            ]} />
            <H3>Editing workflow</H3>
            <Ol items={[
              "Navigate to Content List and click a title.",
              "Switch locale using tabs (desktop) or globe button (mobile).",
              "Edit title, slug, excerpt, and content blocks.",
              "Check the sidebar: validation checklist, metadata, SEO, AI assistant.",
              "Save Draft, Schedule, or Publish when ready.",
            ]} />
            <H3>Mobile editor</H3>
            <P>Tab bar switches between Content, Metadata, and Checklist. Locale picker opens as a bottom sheet. Bottom action bar provides Save/Schedule/Publish.</P>
          </Section>

          {/* AI GENERATOR */}
          <Section id="ai-generator" title="AI Content Generator">
            <P>Requires <Code>OPENAI_API_KEY</Code> and <Code>GENERATION_ENABLED=true</Code>.</P>
            <H3>Generating from backlog</H3>
            <Ol items={[
              "Go to Backlog (/admin/resources/backlog).",
              "Click the Generate button (purple sparkle) on an archive item.",
              "Wait ~15-20 seconds — the AI generates content for all 6 locales in parallel.",
              "You're redirected to the editor with the generated draft.",
            ]} />
            <H3>AI Writing Assistant</H3>
            <P>In the editor sidebar, three tools are available:</P>
            <Ul items={[
              "Improve Readability — simplifies sentences and improves flow.",
              "Generate Meta Description — creates SEO-optimized description.",
              "Suggest Related Topics — recommends 3-5 complementary article ideas.",
            ]} />
            <P>Each generation uses ~8,000-10,000 tokens for all 6 locales (~$0.03-0.05 with GPT-4o).</P>
          </Section>

          {/* AUTOPILOT */}
          <Section id="autopilot" title="Autopilot Mode">
            <P>Autopilot generates and publishes articles automatically without manual approval. Configure in <Strong>Settings</Strong>.</P>
            <Table headers={["Setting", "Description"]} rows={[
              ["Enable autopilot", "Master toggle — when on, the cron job runs daily at 08:00 UTC"],
              ["Articles per day", "How many articles to generate daily (after initial burst)"],
              ["Notification email", "Receive an email with the article link after each publish"],
            ]} />
            <H3>5-day initial burst</H3>
            <P>When first enabled, autopilot publishes 1 article per day for 5 consecutive days. After the burst completes, it continues at the configured rate.</P>
            <H3>How it works</H3>
            <Ol items={[
              "Daily cron picks the highest-priority backlog item.",
              "AI generates content for all 6 locales.",
              "Content is created with 'published' status (bypasses review).",
              "All localizations are enqueued in the publish queue.",
              "The publish cron processes them within 15 minutes.",
              "Email notification sent with article link.",
              "Search engines notified via IndexNow + Google sitemap ping.",
            ]} />
            <div className="bg-[#FEF3C7] border border-[#FDE68A] rounded-xl px-4 py-3 mt-3">
              <p className="text-sm text-[#92400E]"><strong>Warning:</strong> Autopilot bypasses editorial and legal review. Review generated content regularly to maintain quality.</p>
            </div>
          </Section>

          {/* SEO */}
          <Section id="seo" title="SEO & Indexing">
            <P>After each article is published, search engines are automatically notified:</P>
            <Table headers={["Method", "Search Engines", "Speed"]} rows={[
              ["IndexNow", "Bing, Yandex, Seznam, Naver", "Instant (minutes)"],
              ["Sitemap ping", "Google", "Hours to days"],
            ]} />
            <P>Requires <Code>INDEXNOW_KEY</Code> environment variable (any random 8-128 character string).</P>
            <H3>Sitemap</H3>
            <P>A dynamic sitemap at <Code>/sitemap.xml</Code> lists all published articles with hreflang alternates for each locale. It also includes static pages (resources, glossary, templates, case studies).</P>
            <H3>Robots.txt</H3>
            <P>Served at <Code>/robots.txt</Code>. Allows all crawlers on public pages and blocks admin, API, app, portal, and auth routes.</P>
          </Section>

          {/* SETTINGS */}
          <Section id="settings" title="Settings">
            <P>At <Code>/admin/resources/settings</Code>. All changes auto-save (debounced 800ms).</P>
            <Table headers={["Section", "Options"]} rows={[
              ["Publishing", "Default publish time (UTC), weekend publishing, auto-save drafts"],
              ["Translation", "Skip incomplete translations, locale priority order"],
              ["Workflow", "Require reviewer, archive health threshold, default CTA"],
              ["AI Autopilot", "Enable/disable, articles per day, notification email"],
              ["Legal", "Default disclaimer, legal review team email"],
            ]} />
          </Section>

          {/* WORKFLOW */}
          <Section id="workflow" title="Workflow Reference">
            <P>Content follows a defined state machine. Only valid transitions are allowed:</P>
            <div className="bg-[#F8FAFC] border border-[#E5E7EB] rounded-xl p-4 my-4 font-mono text-xs leading-relaxed text-[#64748B]">
              idea → backlog → brief_ready → drafting → in_translation<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↓<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;in_editorial_review → in_legal_review → approved<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;↓<br />
              &nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;scheduled → published → archived
            </div>
            <Table headers={["Status", "Meaning"]} rows={[
              ["idea", "Initial concept, no content yet"],
              ["backlog", "Accepted idea, waiting for brief"],
              ["brief_ready", "Brief written, ready for drafting"],
              ["drafting", "Content being written or generated"],
              ["in_translation", "English done, translations in progress"],
              ["in_editorial_review", "Content ready for editor review"],
              ["in_legal_review", "Requires legal sign-off (mandatory for legal_update)"],
              ["approved", "All reviews passed, ready to schedule"],
              ["scheduled", "Queued for future publication"],
              ["published", "Live on the public site"],
              ["archived", "Removed from public view, preserved for reference"],
            ]} />
          </Section>
        </div>
      </div>
    </div>
  );
}

/* ── Helper components ────────────────────────────────────────────── */

function Section({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={`help-${id}`} className="mb-12 scroll-mt-6">
      <h2 className="text-xl font-bold text-[#0B1220] mb-4 pb-2 border-b border-[#E5E7EB]">{title}</h2>
      {children}
    </section>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return <h3 className="text-base font-semibold text-[#0B1220] mt-6 mb-2">{children}</h3>;
}

function P({ children }: { children: React.ReactNode }) {
  return <p className="text-sm text-[#374151] leading-relaxed mb-3">{children}</p>;
}

function Strong({ children }: { children: React.ReactNode }) {
  return <strong className="font-semibold text-[#0B1220]">{children}</strong>;
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="px-1.5 py-0.5 bg-[#F1F5F9] text-[#1E40AF] rounded text-xs font-mono">{children}</code>;
}

function Ul({ items }: { items: string[] }) {
  return (
    <ul className="list-disc list-inside space-y-1 mb-3">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-[#374151]">{item}</li>
      ))}
    </ul>
  );
}

function Ol({ items }: { items: string[] }) {
  return (
    <ol className="list-decimal list-inside space-y-1 mb-3">
      {items.map((item, i) => (
        <li key={i} className="text-sm text-[#374151]">{item}</li>
      ))}
    </ol>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto mb-4">
      <table className="w-full text-sm border border-[#E5E7EB] rounded-lg overflow-hidden">
        <thead>
          <tr className="bg-[#F8FAFC]">
            {headers.map((h, i) => (
              <th key={i} className="text-left px-3 py-2 font-medium text-[#64748B] border-b border-[#E5E7EB]">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr key={ri} className="border-b border-[#E5E7EB] last:border-b-0">
              {row.map((cell, ci) => (
                <td key={ci} className="px-3 py-2 text-[#374151]">{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
