import type { PlexGateway } from "../ports/plex-gateway";
import type { TokenStore } from "../ports/token-store";

export interface SignInDeps {
  gateway: PlexGateway;
  tokenStore: TokenStore;
  openAuthUrl: (url: string) => void | Promise<void>;
  wait: (ms: number) => Promise<void>;
  now: () => number;
}

export interface SignInOptions {
  pollIntervalMs?: number;
  timeoutMs?: number;
}

export interface SignInResult {
  token: string;
}

export class SignInTimeoutError extends Error {
  constructor() {
    super("Plex sign-in timed out waiting for approval");
    this.name = "SignInTimeoutError";
  }
}

export async function signIn(deps: SignInDeps, options: SignInOptions = {}): Promise<SignInResult> {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const timeoutMs = options.timeoutMs ?? 30 * 60 * 1000;

  const pin = await deps.gateway.createPin();
  await deps.openAuthUrl(pin.authUrl);

  const start = deps.now();
  for (;;) {
    const { authToken } = await deps.gateway.pollPin(pin.id);
    if (authToken) {
      await deps.tokenStore.save(authToken);
      return { token: authToken };
    }
    if (deps.now() - start >= timeoutMs) {
      throw new SignInTimeoutError();
    }
    await deps.wait(pollIntervalMs);
  }
}
