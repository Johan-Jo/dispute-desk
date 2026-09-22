import { test, expect } from "@playwright/test";
import { build } from "esbuild";
import path from "node:path";

let bundle: string;
test.beforeAll(async () => {
  // Render the real page and real SimpleWebAuthn browser adapter in StrictMode.
  // Only Next navigation, HTTP, and the OS credential API are test doubles.
  const result = await build({
    stdin: {
      contents: `import React from 'react';
        import { createRoot } from 'react-dom/client';
        import Page from './app/admin/verify-passkey/page';
        const root = createRoot(document.getElementById('root'));
        root.render(<React.StrictMode><Page /></React.StrictMode>);
        window.addEventListener('test:unmount', () => root.unmount());`,
      loader: "tsx",
      resolveDir: process.cwd(),
    },
    alias: { "next/navigation": path.resolve("e2e/passkeys/navigation.ts") },
    bundle: true,
    write: false,
    jsx: "automatic",
    define: { "process.env.NODE_ENV": '"development"' },
  });
  bundle = result.outputFiles[0].text;
});

declare global {
  interface Window {
    passkeyTest: {
      posts: number;
      puts: number;
      prompts: number;
      aborts: number;
      hints: unknown;
      navigation: string[];
      holdOptions: boolean;
      holdVerification: boolean;
      rejectVerification: boolean;
      releaseOptions: () => void;
      succeed: () => void;
      dismiss: () => void;
    };
  }
}

test.beforeEach(async ({ page }) => {
  await page.route("http://localhost:4179/**", route => route.fulfill({
    contentType: "text/html",
    body: '<!doctype html><html><body><div id="root"></div></body></html>',
  }));
  await page.goto("http://localhost:4179/admin/verify-passkey?continue=/admin/shops");
  await page.evaluate(() => {
    const state = window.passkeyTest = {
      posts: 0, puts: 0, prompts: 0, aborts: 0, hints: undefined as unknown,
      navigation: [] as string[], holdOptions: false, holdVerification: false,
      rejectVerification: false, releaseOptions: () => {}, succeed: () => {}, dismiss: () => {},
    };
    window.addEventListener("test:navigate", event => {
      state.navigation.push((event as CustomEvent<string>).detail);
    });
    window.fetch = async (_url, init) => {
      if (init?.method === "POST") {
        state.posts++;
        if (state.holdOptions) {
          // Deliberately settle AFTER cancellation to exercise the stale-result guard.
          await new Promise<void>(resolve => { state.releaseOptions = resolve; });
        }
        return Response.json({
          challenge: "Y2hhbGxlbmdl", rpId: "localhost", userVerification: "required",
          allowCredentials: [{ id: "Y3JlZGVudGlhbA", type: "public-key", transports: ["internal"] }],
          hints: ["client-device"],
        });
      }
      state.puts++;
      if (state.holdVerification) await new Promise(() => {});
      return state.rejectVerification
        ? Response.json({ error: "Challenge expired or invalid. Try again." }, { status: 400 })
        : Response.json({ ok: true });
    };
    Object.defineProperty(navigator, "credentials", { value: {
      get: (options: CredentialRequestOptions) => {
        state.prompts++;
        state.hints = (options.publicKey as PublicKeyCredentialRequestOptions & { hints?: string[] }).hints;
        return new Promise((resolve, reject) => {
          options.signal?.addEventListener("abort", () => {
            state.aborts++;
            reject(new DOMException("Cancelled", "AbortError"));
          }, { once: true });
          state.dismiss = () => reject(new DOMException("Dismissed", "NotAllowedError"));
          state.succeed = () => resolve({
            id: "Y3JlZGVudGlhbA", rawId: new Uint8Array([1]).buffer, type: "public-key",
            authenticatorAttachment: "platform", getClientExtensionResults: () => ({}),
            response: {
              authenticatorData: new Uint8Array([1]).buffer,
              clientDataJSON: new Uint8Array([2]).buffer,
              signature: new Uint8Array([3]).buffer, userHandle: null,
            },
          });
        });
      },
    } });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole("button", { name: "Verify with passkey", exact: true })).toBeVisible();
});

test("StrictMode mount stays quiet; rapid clicks launch one ceremony and preserve hints", async ({ page }) => {
  expect(await page.evaluate(() => window.passkeyTest.posts)).toBe(0);
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).evaluate(button => {
    (button as HTMLButtonElement).click();
    (button as HTMLButtonElement).click();
  });
  await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
  expect(await page.evaluate(() => window.passkeyTest.posts)).toBe(1);
  expect(await page.evaluate(() => window.passkeyTest.hints)).toEqual(["client-device"]);
  await page.evaluate(() => window.passkeyTest.succeed());
  await expect.poll(() => page.evaluate(() => window.passkeyTest.navigation)).toEqual(["/admin/shops"]);
  expect(await page.evaluate(() => window.passkeyTest.puts)).toBe(1);
  expect(await page.evaluate(() => window.passkeyTest.aborts)).toBe(1);
});

test("cancel aborts the native prompt; retry stays active when the old promise rejects", async ({ page }) => {
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
  await page.getByRole("button", { name: "Cancel verification" }).click();
  await expect(page.getByRole("alert")).toContainText("cancelled");
  expect(await page.evaluate(() => window.passkeyTest.aborts)).toBe(1);
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
  await expect(page.getByRole("button", { name: "Verifying…", exact: true })).toBeDisabled();
  await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(2);
  await page.evaluate(() => window.passkeyTest.succeed());
  await expect.poll(() => page.evaluate(() => window.passkeyTest.navigation)).toEqual(["/admin/shops"]);
});

test("a late options response cannot open a prompt after cancellation", async ({ page }) => {
  await page.evaluate(() => { window.passkeyTest.holdOptions = true; });
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
  await page.getByRole("button", { name: "Cancel verification" }).click();
  await page.evaluate(() => window.passkeyTest.releaseOptions());
  await expect(page.getByRole("alert")).toContainText("cancelled");
  expect(await page.evaluate(() => window.passkeyTest.prompts)).toBe(0);
  expect(await page.evaluate(() => window.passkeyTest.puts)).toBe(0);
});

for (const stage of ["options", "prompt", "verification"] as const) {
  test(`a stalled ${stage} stage times out and restores the button`, async ({ page }) => {
    await page.clock.install();
    await page.evaluate(stage => {
      window.passkeyTest.holdOptions = stage === "options";
      window.passkeyTest.holdVerification = stage === "verification";
    }, stage);
    await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
    if (stage !== "options") {
      await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
    }
    if (stage === "verification") {
      await page.evaluate(() => window.passkeyTest.succeed());
      await expect.poll(() => page.evaluate(() => window.passkeyTest.puts)).toBe(1);
    }
    await page.clock.fastForward(60_001);
    await expect(page.getByRole("alert")).toContainText("timed out");
    await expect(page.getByRole("button", { name: "Verify with passkey", exact: true })).toBeEnabled();
    expect(await page.evaluate(() => window.passkeyTest.navigation)).toEqual([]);
  });
}

test("native dismissal is recoverable without restarting automatically", async ({ page }) => {
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
  await page.evaluate(() => window.passkeyTest.dismiss());
  await expect(page.getByRole("alert")).toContainText("dismissed");
  await expect(page.getByRole("button", { name: "Verify with passkey", exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
});

test("failed server verification never navigates to admin", async ({ page }) => {
  await page.evaluate(() => { window.passkeyTest.rejectVerification = true; });
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
  await page.evaluate(() => window.passkeyTest.succeed());
  await expect(page.getByRole("alert")).toContainText("Challenge expired");
  expect(await page.evaluate(() => window.passkeyTest.navigation)).toEqual([]);
});

test("unmount cancels the native ceremony without submitting an assertion", async ({ page }) => {
  await page.getByRole("button", { name: "Verify with passkey", exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.passkeyTest.prompts)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event("test:unmount")));
  expect(await page.evaluate(() => window.passkeyTest.aborts)).toBe(1);
  expect(await page.evaluate(() => window.passkeyTest.puts)).toBe(0);
});
