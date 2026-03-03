import { z } from "zod";

/**
 * Zod schemas for validating Shopify GraphQL response shapes
 * against the pinned API version (2026-01).
 */

export const DisputeAmountSchema = z.object({
  amount: z.string(),
  currencyCode: z.string(),
});

export const DisputeListNodeSchema = z.object({
  id: z.string().startsWith("gid://shopify/"),
  status: z.string(),
  reasonDetails: z.object({ reason: z.string() }).nullable(),
  amount: DisputeAmountSchema,
  initiatedAt: z.string().nullable(),
  evidenceDueBy: z.string().nullable(),
  order: z
    .object({
      id: z.string(),
      name: z.string(),
    })
    .nullable(),
  disputeEvidence: z
    .object({
      id: z.string().startsWith("gid://shopify/"),
    })
    .nullable(),
});

export const DisputeListResponseSchema = z.object({
  data: z.object({
    disputes: z.object({
      edges: z.array(
        z.object({
          cursor: z.string(),
          node: DisputeListNodeSchema,
        })
      ),
      pageInfo: z.object({
        hasNextPage: z.boolean(),
        endCursor: z.string().nullable(),
      }),
    }),
  }),
});

export const FulfillmentEvidenceSchema = z.object({
  shippingCarrier: z.string().nullable(),
  shippingTrackingNumber: z.string().nullable(),
  shippingTrackingUrl: z.string().nullable(),
  shippingDate: z.string().nullable(),
});

export const DisputeDetailNodeSchema = z.object({
  id: z.string().startsWith("gid://shopify/"),
  status: z.string(),
  reasonDetails: z.object({ reason: z.string() }).nullable(),
  amount: DisputeAmountSchema,
  initiatedAt: z.string().nullable(),
  evidenceDueBy: z.string().nullable(),
  order: z
    .object({
      id: z.string(),
      name: z.string(),
      createdAt: z.string(),
      totalPriceSet: z.object({
        shopMoney: DisputeAmountSchema,
      }),
    })
    .nullable(),
  disputeEvidence: z
    .object({
      id: z.string().startsWith("gid://shopify/"),
      accessActivityLog: z.string().nullable(),
      cancellationPolicyDisclosure: z.string().nullable(),
      cancellationRebuttal: z.string().nullable(),
      customerCommunication: z.string().nullable(),
      refundPolicyDisclosure: z.string().nullable(),
      refundRefusalExplanation: z.string().nullable(),
      shippingDocumentation: z.string().nullable(),
      uncategorizedText: z.string().nullable(),
      customerFirstName: z.string().nullable(),
      customerLastName: z.string().nullable(),
      fulfillments: z.array(FulfillmentEvidenceSchema),
    })
    .nullable(),
});

export const DisputeDetailResponseSchema = z.object({
  data: z.object({
    dispute: DisputeDetailNodeSchema,
  }),
});

export const DisputeEvidenceUpdateResponseSchema = z.object({
  data: z.object({
    disputeEvidenceUpdate: z.object({
      disputeEvidence: z.object({ id: z.string() }).nullable(),
      userErrors: z.array(
        z.object({
          field: z.array(z.string()),
          message: z.string(),
        })
      ),
    }),
  }),
});
