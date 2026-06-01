"use client";

import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
import { SHOPIFY_INSTALL_URL } from "@/lib/marketing/shopifyInstallUrl";
import {
  PLAYBOOK_SECTIONS,
  PLAYBOOK_META,
  type PlaybookSection,
  type PlaybookBlock,
} from "@/lib/marketing/playbook/playbookContent";

const CAL_URL = "https://cal.com/disputedesk";

/** Render a single content block. Content is static + authored, so the
 *  `html: true` paths use dangerouslySetInnerHTML for inline emphasis. */
function Block({ block }: { block: PlaybookBlock }) {
  switch (block.t) {
    case "lead":
      return block.html ? (
        <p className="pb-lead-p" dangerouslySetInnerHTML={{ __html: block.c }} />
      ) : (
        <p className="pb-lead-p">{block.c}</p>
      );
    case "p":
      return block.html ? (
        <p
          className={block.drop ? "pb-drop" : undefined}
          dangerouslySetInnerHTML={{ __html: block.c }}
        />
      ) : (
        <p className={block.drop ? "pb-drop" : undefined}>{block.c}</p>
      );
    case "h3":
      return <h3 className="pb-sh">{block.c}</h3>;
    case "rule":
      return <div className="pb-rule" />;
    case "callout":
      return (
        <div className={`pb-callout${block.variant === "blue" ? " pb-blue" : ""}`}>
          <div className="pb-ct">
            <span className="pb-marker">{block.marker}</span> {block.title}
          </div>
          {block.html ? (
            <p dangerouslySetInnerHTML={{ __html: block.body }} />
          ) : (
            <p>{block.body}</p>
          )}
        </div>
      );
    case "list":
      return (
        <ul className="pb-clean">
          {block.items.map((item, i) =>
            block.html ? (
              <li key={i} dangerouslySetInnerHTML={{ __html: item }} />
            ) : (
              <li key={i}>{item}</li>
            ),
          )}
        </ul>
      );
    case "tags":
      return (
        <div className="pb-tags">
          {block.items.map((tag, i) => (
            <span className="pb-tag" key={i}>
              {tag}
            </span>
          ))}
        </div>
      );
    case "table":
      return (
        <div className="pb-table-wrap">
          <table className="pb-cmp">
            <thead>
              <tr>
                <th>{block.head[0] || " "}</th>
                <th>{block.head[1]}</th>
                <th className="pb-vs">{block.head[2]}</th>
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, i) => (
                <tr key={i}>
                  <td className="pb-rowlab">{row.label}</td>
                  <td>{row.visa}</td>
                  <td>{row.mc}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "steps":
      return (
        <div className="pb-steps">
          {block.steps.map((s, i) => (
            <div className="pb-test-step" key={i}>
              <div className="pb-ts-num">{s.num}</div>
              <div className="pb-ts-body">
                <h4>{s.title}</h4>
                {s.html ? (
                  <p dangerouslySetInnerHTML={{ __html: s.body }} />
                ) : (
                  <p>{s.body}</p>
                )}
                {s.q && <div className="pb-q">{s.q}</div>}
              </div>
            </div>
          ))}
        </div>
      );
    default:
      return null;
  }
}

function Section({ section }: { section: PlaybookSection }) {
  const isCover = section.id === "cover";
  const isFinal = section.id === "next-step";

  return (
    <section
      className={`pb-page${section.dark ? " pb-dark" : ""}${isCover ? " pb-cover-page" : ""}`}
      id={section.id}
    >
      <div className="pb-inner">
        {section.runHead && (
          <div className="pb-run-head">
            <span className="pb-b">{PLAYBOOK_META.title}</span>
            <span>{section.runHead}</span>
          </div>
        )}
        {section.kicker && <div className="pb-kicker">{section.kicker}</div>}
        {section.eyebrow && (
          <div className="pb-r-eyebrow">
            <span>§</span> {section.eyebrow.replace(/^§\s*/, "")}
          </div>
        )}
        {section.coverTitle ? (
          <h1
            className="pb-title"
            dangerouslySetInnerHTML={{ __html: section.heading }}
          />
        ) : (
          <h2 className="pb-h">{section.heading}</h2>
        )}
        {section.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}

        {isCover && (
          <div className="pb-cover-meta">
            <div>
              <div className="pb-l">For</div>
              <div className="pb-v">Shopify merchants fighting 15–60 disputes / mo</div>
            </div>
            <div>
              <div className="pb-l">Reading time</div>
              <div className="pb-v">12 minutes that change your win rate</div>
            </div>
            <div>
              <div className="pb-l">Covers</div>
              <div className="pb-v">Visa CE 3.0 · Mastercard FPT · self-audit</div>
            </div>
            <div>
              <div className="pb-l">Edition</div>
              <div className="pb-v">{PLAYBOOK_META.edition}</div>
            </div>
          </div>
        )}

        {isFinal && (
          <div className="pb-final-cta">
            <div className="pb-final-eyebrow">§ Put it to work — free</div>
            <h3 className="pb-final-h">
              Run this on your real disputes — <em>automatically</em>.
            </h3>
            <p className="pb-final-sub">
              DisputeDesk checks every Shopify dispute against the CE&nbsp;3.0 and FPT
              rulebooks for you, tells you which ones qualify and why, then builds the
              evidence pack. <strong>Free to install. No credit card to start.</strong>
            </p>
            <div className="pb-final-actions">
              <a className="pb-btn-primary" href={SHOPIFY_INSTALL_URL}>
                Install DisputeDesk free →
              </a>
              <a className="pb-btn-secondary" href={CAL_URL}>
                Book a free dispute teardown
              </a>
            </div>
            <p className="pb-final-note">
              Free plan available · install in ~10 minutes · the issuer always decides —
              we&apos;re honest about that.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

export function PlaybookReader({ base }: { base: string }) {
  return (
    <div className="dd-pbreader">
      <div className="pb-no-print">
        <MarketingSiteHeader />
      </div>

      {/* Sticky reading toolbar: download (print to PDF) + jump-to-CTA. */}
      <div className="pb-toolbar pb-no-print">
        <div className="pb-toolbar-inner">
          <span className="pb-toolbar-title">§ The Liability-Shift Playbook</span>
          <div className="pb-toolbar-actions">
            <button
              type="button"
              className="pb-toolbar-btn"
              onClick={() => window.print()}
            >
              ↓ Download as PDF
            </button>
            <a className="pb-toolbar-cta" href={SHOPIFY_INSTALL_URL}>
              Install free →
            </a>
          </div>
        </div>
      </div>

      <main className="pb-doc">
        {PLAYBOOK_SECTIONS.map((section) => (
          <Section key={section.id} section={section} />
        ))}
      </main>

      <div className="pb-no-print">
        <MarketingSiteFooter base={base} />
      </div>
    </div>
  );
}
