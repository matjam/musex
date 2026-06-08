/** Build a token-free art URL served through the musex-stream proxy (token injected in main). */
export function artUrl(serverId: string, thumb: string | undefined): string | undefined {
  return thumb ? `musex-stream://${serverId}${thumb}` : undefined;
}
