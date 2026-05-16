"use client";

import { useState } from "react";
import type { AdminPromptModuleRow } from "@/lib/defence/admin-queries";

export interface FileDefaultSnapshot {
  promptBody: string;
  guidanceJson: Record<string, unknown>;
  reasonCodeKeys: string[];
}

interface Props {
  initial: AdminPromptModuleRow;
  /** File-default snapshot (from ALL_REASON_CODE_MODULES). When present
   *  the "Reset to file default" button is enabled. */
  fileDefault: FileDefaultSnapshot | null;
}

export function PromptEditor({ initial, fileDefault }: Props) {
  const [promptBody, setPromptBody] = useState(initial.promptBody);
  const [model, setModel] = useState(initial.model ?? "");
  const [saving, setSaving] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<unknown>(null);
  const [dryRunning, setDryRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSave() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/defence-package/prompt-modules/${initial.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: initial.displayName,
          reasonCodeKeys: initial.reasonCodeKeys,
          promptBody,
          guidanceJson: initial.guidanceJson,
          model: model || null,
          isActive: true,
          // Manual saves are deliberate divergence from the file default.
          intentionalOverride: true,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 200));
      }
      const json = (await res.json()) as { version: number };
      setSavedAt(`Saved as v${json.version}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
    } finally {
      setSaving(false);
    }
  }

  async function onResetToFile() {
    if (!fileDefault) {
      setError("No file default available for this module.");
      return;
    }
    setResetting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/defence-package/prompt-modules/${initial.key}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          displayName: initial.displayName,
          reasonCodeKeys: fileDefault.reasonCodeKeys,
          promptBody: fileDefault.promptBody,
          guidanceJson: fileDefault.guidanceJson,
          model: null,
          isActive: true,
          // Reset-to-file is the explicit "back in sync" action.
          intentionalOverride: false,
        }),
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(text.slice(0, 200));
      }
      const json = (await res.json()) as { version: number };
      setPromptBody(fileDefault.promptBody);
      setModel("");
      setSavedAt(`Reset to file default — saved as v${json.version}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
    } finally {
      setResetting(false);
    }
  }

  async function onDryRun() {
    setDryRunning(true);
    setDryRunResult(null);
    setError(null);
    try {
      const res = await fetch(`/api/admin/defence-package/prompt-modules/${initial.key}/dry-run`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ promptBodyOverride: promptBody, modelOverride: model || undefined }),
      });
      const json = await res.json();
      setDryRunResult(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
    } finally {
      setDryRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <label className="block text-sm font-medium text-[#0F172A]">Prompt body</label>
        <textarea
          className="w-full border border-[#CBD5E1] rounded p-3 font-mono text-sm leading-6"
          rows={18}
          value={promptBody}
          onChange={(e) => setPromptBody(e.target.value)}
        />
      </section>

      <section className="space-y-2">
        <label className="block text-sm font-medium text-[#0F172A]">
          Model override <span className="text-[#64748B] font-normal">(leave blank to use DEFENCE_PACKAGE_DEFAULT_MODEL)</span>
        </label>
        <input
          type="text"
          className="w-full border border-[#CBD5E1] rounded p-2 font-mono text-sm"
          placeholder="claude-sonnet-4-6"
          value={model}
          onChange={(e) => setModel(e.target.value)}
        />
      </section>

      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={onSave}
          disabled={saving || resetting}
          className="px-4 py-2 rounded bg-[#1D4ED8] text-white font-medium hover:bg-[#1E40AF] disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save new version"}
        </button>
        <button
          onClick={onResetToFile}
          disabled={saving || resetting || !fileDefault}
          className="px-4 py-2 rounded border border-[#CBD5E1] text-[#0F172A] font-medium hover:bg-[#F8FAFC] disabled:opacity-50"
          title={fileDefault ? "Insert a new active version matching lib/defence/reasonCodes/<key>.ts and clear intentional_override." : "No file default for this module."}
        >
          {resetting ? "Resetting…" : "Reset to file default"}
        </button>
        <button
          onClick={onDryRun}
          disabled={dryRunning}
          className="px-4 py-2 rounded border border-[#CBD5E1] text-[#0F172A] font-medium hover:bg-[#F8FAFC] disabled:opacity-50"
        >
          {dryRunning ? "Running…" : "Test against sample dispute"}
        </button>
        {savedAt && <span className="text-sm text-emerald-700">{savedAt}</span>}
        {error && <span className="text-sm text-rose-700">{error}</span>}
      </div>

      {dryRunResult !== null && (
        <section>
          <h3 className="font-medium text-[#0F172A] mb-2">Dry-run result</h3>
          <pre className="bg-[#0F172A] text-[#F1F5F9] text-xs p-4 rounded overflow-auto max-h-96">
            {JSON.stringify(dryRunResult, null, 2)}
          </pre>
        </section>
      )}
    </div>
  );
}
