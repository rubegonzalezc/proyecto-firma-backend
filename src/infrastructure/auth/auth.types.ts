export type BetterAuthInstance = {
  api: {
    getSession: (input: { headers: HeadersInit }) => Promise<{
      user?: { id: string; email: string };
    } | null>;
  };
  handler: (request: Request) => Promise<Response>;
};

export type AuthModule = {
  getAuth: () => Promise<BetterAuthInstance>;
};
