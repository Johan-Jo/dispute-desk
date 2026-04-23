import { NextResponse } from "next/server";
import { z, type ZodSchema } from "zod";

/**
 * Validate a request body against a Zod schema.
 * Returns parsed data on success, or a NextResponse on failure.
 */
export async function validateBody<T>(
  body: unknown,
  schema: ZodSchema<T>
): Promise<{ data: T } | { error: NextResponse }> {
  const result = schema.safeParse(body);
  if (!result.success) {
    return {
      error: NextResponse.json(
        {
          error: "Validation failed",
          details: result.error.flatten().fieldErrors,
        },
        { status: 400 }
      ),
    };
  }
  return { data: result.data };
}

// ---- Shared schemas ----

export const shopIdParam = z.string().uuid("Invalid shop_id");

export const ruleCreateSchema = z.object({
  shop_id: shopIdParam,
  name: z.string().max(200).nullable().optional(),
  match: z.object({
    reason: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    amount_range: z.object({
      min: z.number().nonnegative().optional(),
      max: z.number().nonnegative().optional(),
    }).optional(),
  }).optional().default({}),
  action: z.object({
    mode: z.enum(["auto", "review"]),
    pack_template_id: z.string().uuid().nullable().optional(),
    require_fields: z.array(z.string()).optional(),
  }).optional().default({ mode: "review" }),
  enabled: z.boolean().optional().default(true),
  priority: z.number().int().nonnegative().optional().default(0),
});

export const ruleUpdateSchema = z.object({
  name: z.string().max(200).nullable().optional(),
  match: z.object({
    reason: z.array(z.string()).optional(),
    status: z.array(z.string()).optional(),
    amount_range: z.object({
      min: z.number().nonnegative().optional(),
      max: z.number().nonnegative().optional(),
    }).optional(),
  }).optional(),
  action: z.object({
    mode: z.enum(["auto", "review"]),
    pack_template_id: z.string().uuid().nullable().optional(),
    require_fields: z.array(z.string()).optional(),
  }).optional(),
  enabled: z.boolean().optional(),
  priority: z.number().int().nonnegative().optional(),
});

export const billingSubscribeSchema = z.object({
  shop_id: shopIdParam,
  plan_id: z.enum(["starter", "growth", "scale"]),
  host: z.string().optional(),
  shop: z.string().optional(),
});

export const billingTopUpSchema = z.object({
  shop_id: shopIdParam,
  sku: z.enum(["topup_25", "topup_100"]),
});

export const reorderSchema = z.object({
  ordered_ids: z.array(z.string().uuid()).min(1),
});
