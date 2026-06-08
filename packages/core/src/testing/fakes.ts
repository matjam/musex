import type { Album, Artist, Library, Server, Track } from "../models/index";
import type { PlaybackEngine } from "../ports/playback-engine";
import type { Pin, PlexGateway } from "../ports/plex-gateway";
import type { StreamRef, StreamResolver } from "../ports/stream-resolver";
import type { TokenStore } from "../ports/token-store";

export class FakeTokenStore implements TokenStore {
  private token: string | null = null;
  readonly saved: string[] = [];
  async save(token: string): Promise<void> {
    this.token = token;
    this.saved.push(token);
  }
  async load(): Promise<string | null> {
    return this.token;
  }
  async clear(): Promise<void> {
    this.token = null;
  }
}

export class FakePlexGateway implements PlexGateway {
  pin: Pin = { id: "pin-1", code: "ABCD", authUrl: "https://app.plex.tv/auth#?code=ABCD" };
  pollResults: Array<{ authToken: string | null }> = [];
  servers: Server[] = [];
  readonly libraries = new Map<string, Library[]>(); // serverId -> libs
  readonly artists = new Map<string, Artist[]>(); // libraryId -> artists
  readonly albums = new Map<string, Album[]>(); // artistId -> albums
  readonly tracks = new Map<string, Track[]>(); // albumId -> tracks
  readonly unreachableServerIds = new Set<string>();
  createPinCalls = 0;
  private pollIdx = 0;

  async createPin(): Promise<Pin> {
    this.createPinCalls++;
    return this.pin;
  }
  async pollPin(_id: string): Promise<{ authToken: string | null }> {
    const result = this.pollResults[this.pollIdx] ?? { authToken: null };
    if (this.pollIdx < this.pollResults.length - 1) this.pollIdx++;
    return result;
  }
  async listServers(_token: string): Promise<Server[]> {
    return this.servers;
  }
  async listMusicLibraries(server: Server, _token: string): Promise<Library[]> {
    if (this.unreachableServerIds.has(server.id)) {
      throw new Error(`unreachable server: ${server.id}`);
    }
    return this.libraries.get(server.id) ?? [];
  }
  async listArtists(library: Library, _token: string): Promise<Artist[]> {
    return this.artists.get(library.id) ?? [];
  }
  async listAlbums(_library: Library, artistId: string, _token: string): Promise<Album[]> {
    return this.albums.get(artistId) ?? [];
  }
  async listTracks(_library: Library, albumId: string, _token: string): Promise<Track[]> {
    return this.tracks.get(albumId) ?? [];
  }
}

export class FakeStreamResolver implements StreamResolver {
  readonly resolved: Track[] = [];
  async resolve(track: Track): Promise<StreamRef> {
    this.resolved.push(track);
    return { url: `fake://stream/${track.id}`, kind: "direct" };
  }
}

export class FakePlaybackEngine implements PlaybackEngine {
  readonly loaded: StreamRef[] = [];
  readonly preloaded: StreamRef[] = [];
  playCalls = 0;
  pauseCalls = 0;
  readonly seekCalls: number[] = [];
  readonly volumeCalls: number[] = [];
  private positionCb: ((s: number) => void) | null = null;
  private endedCb: (() => void) | null = null;
  private errorCb: ((e: Error) => void) | null = null;

  async load(ref: StreamRef): Promise<void> {
    this.loaded.push(ref);
  }
  async preload(ref: StreamRef): Promise<void> {
    this.preloaded.push(ref);
  }
  play(): void {
    this.playCalls++;
  }
  pause(): void {
    this.pauseCalls++;
  }
  seek(seconds: number): void {
    this.seekCalls.push(seconds);
  }
  setVolume(volume: number): void {
    this.volumeCalls.push(volume);
  }
  onPosition(cb: (s: number) => void): void {
    this.positionCb = cb;
  }
  onEnded(cb: () => void): void {
    this.endedCb = cb;
  }
  onError(cb: (e: Error) => void): void {
    this.errorCb = cb;
  }

  // --- test helpers to simulate engine events ---
  emitPosition(seconds: number): void {
    this.positionCb?.(seconds);
  }
  emitEnded(): void {
    this.endedCb?.();
  }
  emitError(err: Error): void {
    this.errorCb?.(err);
  }
}

export function makeTrack(id: string, overrides: Partial<Track> = {}): Track {
  return {
    id,
    serverId: "srv-1",
    albumId: "alb-1",
    artistName: "Test Artist",
    title: `Track ${id}`,
    durationMs: 180_000,
    media: {
      container: "flac",
      audioCodec: "flac",
      partId: `part-${id}`,
      partKey: `/library/parts/${id}/file.flac`,
    },
    ...overrides,
  };
}
