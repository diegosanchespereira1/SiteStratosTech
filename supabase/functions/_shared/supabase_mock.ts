/**
 * Mock do @supabase/supabase-js para testes.
 * Usado via import map em deno test.
 */
export function createClient(_url: string, _key: string) {
  return {
    auth: {
      getUser: (jwt: string) => {
        if (jwt === "invalid-token") {
          return Promise.resolve({ data: { user: null }, error: { message: "Invalid" } });
        }
        return Promise.resolve({
          data: { user: { id: "user-123" } },
          error: null,
        });
      },
    },
    from: (_table: string) => ({
      select: () => ({
        eq: (_col: string, userId: string) => ({
          order: () => ({
            limit: () => ({
              maybeSingle: () =>
                userId === "user-no-tenant"
                  ? Promise.resolve({ data: null, error: { message: "not found" } })
                  : Promise.resolve({
                      data: { tenant_id: "tenant-456" },
                      error: null,
                    }),
            }),
          }),
        }),
      }),
    }),
  };
}
