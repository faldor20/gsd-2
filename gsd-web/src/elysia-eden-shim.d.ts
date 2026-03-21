declare module "@elysiajs/eden" {
  export interface EdenResponse<TData = unknown> {
    data: TData | null;
    error: unknown | null;
  }

  export interface EdenGetOptions {
    query?: Record<string, string | number | boolean | undefined>;
  }

  export interface EdenClient {
    api: {
      bootstrap: {
        get(options?: EdenGetOptions): Promise<EdenResponse>;
      };
      instances: Record<
        string,
        {
          get(options?: EdenGetOptions): Promise<EdenResponse>;
        }
      >;
    };
  }

  export function treaty<_TApp = unknown>(baseUrl: string): EdenClient;
}
