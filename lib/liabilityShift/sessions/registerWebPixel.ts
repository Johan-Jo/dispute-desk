/**
 * Register the dispute-desk-pixel Web Pixel extension on a shop.
 *
 * App pixels (web_pixel_extension) DON'T auto-activate when a merchant
 * installs the app — the app itself must call `webPixelCreate` once,
 * passing the pixel's settings, to register a Web Pixel row for that
 * shop. Without this, the pixel appears in the released app version
 * but never shows up under Admin → Settings → Customer events.
 *
 * Idempotent: Shopify returns a validation error if a pixel is already
 * registered for this app, which we swallow so re-running OAuth on an
 * already-installed shop is a no-op.
 *
 * Scopes required: `write_pixels`. Added to shopify.app.toml on
 * 2026-05-14. Must also be in the SHOPIFY_SCOPES env var for OAuth
 * consent screens to request it.
 */

import { makeAuthedRequest } from "@/lib/shopify/makeAuthedRequest";

const WEB_PIXEL_CREATE_MUTATION = `
  mutation WebPixelCreate($webPixel: WebPixelInput!) {
    webPixelCreate(webPixel: $webPixel) {
      webPixel {
        id
        settings
      }
      userErrors {
        code
        field
        message
      }
    }
  }
`;

interface WebPixelCreateResponse {
  webPixelCreate: {
    webPixel: { id: string; settings: string } | null;
    userErrors: Array<{ code: string | null; field: string[] | null; message: string }>;
  };
}

export interface RegisterWebPixelResult {
  status: "created" | "already_exists" | "skipped" | "error";
  webPixelId?: string;
  errorMessage?: string;
}

/**
 * Activate the dispute-desk-pixel on this shop. Settings is `"{}"`
 * because our pixel has no merchant-configurable fields (zero-config
 * design — shop is identified via `init.data.shop.domain` at runtime).
 *
 * Shopify validates the settings string against the pixel's
 * [settings.fields] schema — an empty fields table means an empty
 * object is the only valid value.
 */
export async function registerWebPixel(shopId: string): Promise<RegisterWebPixelResult> {
  try {
    const res = await makeAuthedRequest<WebPixelCreateResponse>({
      shopId,
      query: WEB_PIXEL_CREATE_MUTATION,
      variables: {
        webPixel: { settings: "{}" },
      },
    });

    const result = res.data?.webPixelCreate;
    if (!result) {
      return {
        status: "error",
        errorMessage: "no_data_in_response",
      };
    }

    if (result.userErrors && result.userErrors.length > 0) {
      // The most common "error" is the pixel already being registered
      // from a previous install. Treat that as already_exists, silent.
      const messages = result.userErrors.map((e) => e.message).join("; ");
      if (
        /already exist|already.*registered|TAKEN/i.test(messages)
      ) {
        return { status: "already_exists" };
      }
      console.warn(
        `[registerWebPixel] webPixelCreate userErrors for shop ${shopId}:`,
        messages,
      );
      return { status: "error", errorMessage: messages };
    }

    if (!result.webPixel?.id) {
      return { status: "error", errorMessage: "no_webpixel_id_returned" };
    }
    return { status: "created", webPixelId: result.webPixel.id };
  } catch (err) {
    // No offline session, scope missing, transport error — all silent.
    // Pixel registration is best-effort; capture is not the only LSE
    // surface (Checkout UI extension also fires).
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[registerWebPixel] failed for shop ${shopId}:`,
      message,
    );
    return { status: "error", errorMessage: message };
  }
}
