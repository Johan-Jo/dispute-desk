import { describe, it, expect } from "vitest";
import { repairTruncatedBody } from "@/lib/resources/generation/repairBody";
import { v10_incompleteBody } from "@/lib/resources/generation/validators";

/** Helper: does v10 reject this body? */
function v10Rejects(mainHtml: string): boolean {
  return (
    v10_incompleteBody({
      title: "t",
      excerpt: "e",
      slug: "s",
      meta_title: "mt",
      meta_description: "md",
      body_json: { mainHtml },
    }) !== null
  );
}

describe("repairTruncatedBody", () => {
  it("leaves a complete body unchanged", () => {
    const html =
      "<h2>Heading</h2><p>This is a complete paragraph that ends properly.</p><p>And another one here.</p>";
    const r = repairTruncatedBody(html);
    expect(r.changed).toBe(false);
    expect(r.html).toBe(html);
  });

  it("repairs the real 2026-06-09 truncation (dangling empty blockquote + colon lead-in)", () => {
    // Exact tail shape from msgbatch_0125ggNfWdLdsN4yq5g1Nzmv / 7dedfefc.
    const html =
      "<h2>What to actually write in the response narrative</h2>" +
      "<p>The narrative is not a cover letter. It's a one-paragraph statement of what happened, written for an analyst who will spend 90 seconds on it.</p>" +
      "<p>Sample narrative line (adapt to your case):</p>" +
      "<blockquote><p>";
    expect(v10Rejects(html)).toBe(true); // confirms the failure mode

    const r = repairTruncatedBody(html);
    expect(r.changed).toBe(true);
    expect(r.html.endsWith("written for an analyst who will spend 90 seconds on it.</p>")).toBe(true);
    expect(v10Rejects(r.html)).toBe(false); // repaired body now passes v10
  });

  it("strips a trailing empty open-only tag (unclosed <p>)", () => {
    const html = "<p>Complete sentence one.</p><p>";
    const r = repairTruncatedBody(html);
    expect(r.changed).toBe(true);
    expect(r.html).toBe("<p>Complete sentence one.</p>");
    expect(v10Rejects(r.html)).toBe(false);
  });

  it("drops a final unclosed paragraph cut mid-sentence", () => {
    const lead =
      "<h2>How the dispute is decided</h2>" +
      "<p>The issuer weighs the evidence against the cardholder's claim and rules within the response window. Device data and post-purchase engagement carry the most weight.</p>" +
      "<p>A focused narrative beats a document dump every time, because the analyst has limited time to evaluate each submission.</p>";
    const html = lead + "<p>The merchant's evidence answered ";
    expect(v10Rejects(html)).toBe(true);
    const r = repairTruncatedBody(html);
    expect(r.changed).toBe(true);
    expect(r.html).toBe(lead);
    expect(v10Rejects(r.html)).toBe(false);
  });

  it("does NOT strip a colon lead-in that is followed by a real list", () => {
    const html = "<p>Build the stack in order:</p><ul><li>Device fingerprint.</li><li>AVS result.</li></ul>";
    const r = repairTruncatedBody(html);
    expect(r.changed).toBe(false);
    expect(r.html).toBe(html);
  });

  it("refuses to gut a body — returns unchanged when repair would remove too much", () => {
    // Almost everything is an unclosed tail; repair would empty it.
    const html = "<p>Short.</p><blockquote><p>A long dangling unfinished thought that never closes and keeps going for a while without any terminal punctuation so the only fix is to drop nearly all of it";
    const r = repairTruncatedBody(html);
    // Either it salvages "<p>Short.</p>" (>=50% kept is false here) → unchanged.
    expect(r.changed).toBe(false);
    expect(r.html).toBe(html);
  });
});
