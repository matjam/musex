export interface TokenStore {
  save(token: string): Promise<void>;
  load(): Promise<string | null>;
  clear(): Promise<void>;
}
