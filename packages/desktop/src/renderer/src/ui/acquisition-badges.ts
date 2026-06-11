import type { AcquirableAlbumDto } from "../../../shared/ipc-contract";

/** Badge text + color variant per acquisition state. `available` renders no
 *  badge (it gets the hover Add action instead). */
export function badgeFor(album: AcquirableAlbumDto): { badge: string; variant: string } | null {
  switch (album.state) {
    case "owned":
      return { badge: "owned", variant: "owned" };
    case "downloaded":
      return { badge: "downloaded", variant: "downloaded" };
    case "downloading":
      return { badge: album.detail ?? "downloading", variant: "downloading" };
    case "requested":
      return { badge: "requested", variant: "requested" };
    case "unavailable":
      return { badge: "unavailable", variant: "unavailable" };
    case "available":
      return null;
  }
}
