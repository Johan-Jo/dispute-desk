import { MarketingSiteHeader } from "@/components/marketing/MarketingSiteHeader";
import { MarketingSiteFooter } from "@/components/marketing/MarketingSiteFooter";
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
        <table className="pb-cmp">
          <thead>
            <tr>
              <th>{block.head[0] || " "}</th>
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
      );
    case "steps":
      return (
        <div>
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
  const inner = (
    <>
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

      {/* Cover gets the meta grid; the final dark page gets the CTA box. */}
      {section.id === "cover" && (
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
      {section.id === "next-step" && (
        <div className="pb-cta-box">
          <h3>Two ways to put this to work</h3>
          <p>
            <strong>Book a free dispute teardown.</strong> Bring 2–3 of your real
            disputes. In 20 minutes we&apos;ll run them through the test live and show you
            which are liability-shift eligible — yours to keep whether or not you use
            DisputeDesk.
          </p>
          <div className="pb-links">
            <a href={CAL_URL}>cal.com/disputedesk — book a dispute teardown</a>
            <a href="/">disputedesk.app — install free on Shopify</a>
          </div>
        </div>
      )}
    </>
  );

  return (
    <section className={`pb-page${section.dark ? " pb-dark" : ""}`} id={section.id}>
      {section.dark ? <div className="pb-inner">{inner}</div> : inner}
    </section>
  );
}

export function PlaybookReader({ base }: { base: string }) {
  return (
    <div className="dd-pbreader">
      <MarketingSiteHeader />
      {PLAYBOOK_SECTIONS.map((section) => (
        <Section key={section.id} section={section} />
      ))}
      <MarketingSiteFooter base={base} />
    </div>
  );
}
