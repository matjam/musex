/** The artist-acquisition capability (desktop wraps Lidarr via the acquisition
 *  provider; mobile passes none). `follow` = acquire full discography + monitor. */
export interface MonitorBackend {
  follow(artistName: string): Promise<void>;
  unfollow(artistName: string): Promise<void>;
  isFollowed(artistName: string): Promise<boolean>;
  listFollowed(): Promise<string[]>;
}
