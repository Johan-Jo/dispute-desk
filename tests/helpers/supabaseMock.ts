import { vi } from "vitest";

export interface MockQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  _result: { data: unknown; error: unknown };
}

/**
 * Creates a chainable mock that mimics the Supabase query builder.
 * Set `_result` to control what `single()`, the terminal call, or any
 * chained call returns.
 */
export function createMockQueryBuilder(
  result: { data: unknown; error: unknown } = { data: null, error: null }
): MockQueryBuilder {
  const builder: MockQueryBuilder = {
    _result: result,
    select: vi.fn(),
    insert: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
    eq: vi.fn(),
    single: vi.fn(),
    order: vi.fn(),
  };

  // Each method returns the builder itself (chaining), except single which resolves
  for (const method of ["select", "insert", "update", "upsert", "delete", "eq", "order"] as const) {
    builder[method].mockReturnValue(builder);
  }
  builder.single.mockImplementation(() => builder._result);

  // Make the builder itself thenable so `await sb.from().select()` works
  Object.defineProperty(builder, "then", {
    value: (resolve: (v: unknown) => void) => resolve(builder._result),
    configurable: true,
  });

  return builder;
}

export interface MockSupabaseClient {
  from: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
  _builders: Record<string, MockQueryBuilder>;
}

/**
 * Creates a mock Supabase client. Call `client._builders[tableName]` to
 * access the mock query builder for a specific table and configure results.
 */
export function createMockSupabaseClient(): MockSupabaseClient {
  const builders: Record<string, MockQueryBuilder> = {};

  const client: MockSupabaseClient = {
    _builders: builders,
    from: vi.fn((table: string) => {
      if (!builders[table]) {
        builders[table] = createMockQueryBuilder();
      }
      return builders[table];
    }),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn().mockResolvedValue({ error: null }),
        remove: vi.fn().mockResolvedValue({ error: null }),
        createSignedUploadUrl: vi.fn().mockResolvedValue({ data: { signedUrl: "https://example.com/upload" }, error: null }),
      })),
    },
  };

  return client;
}

/**
 * Convenience: pre-populate a builder for a table with specific data.
 */
export function setTableResult(
  client: MockSupabaseClient,
  table: string,
  data: unknown,
  error: unknown = null
): MockQueryBuilder {
  const builder = createMockQueryBuilder({ data, error });
  client._builders[table] = builder;
  client.from.mockImplementation((t: string) => {
    if (t === table) return builder;
    if (!client._builders[t]) {
      client._builders[t] = createMockQueryBuilder();
    }
    return client._builders[t];
  });
  return builder;
}
