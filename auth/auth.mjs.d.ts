export function getAuth(): Promise<{
  handler: (request: Request) => Promise<Response>;
  api: {
    getSession: (input: { headers: HeadersInit }) => Promise<{
      user?: { id: string; email: string };
    } | null>;
  };
}>;
