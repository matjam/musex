import type { Album, EntityRef } from "@musex/core";
import { entityRefForAlbum, externalAlbumRef } from "@musex/core";
import type { AcquirableAlbumDto } from "../../../../shared/ipc-contract";

/** One row in the unified artist discography (owned ∪ external). The card
 *  renders from `ref` + the flags; `acquire` is set only for an acquirable
 *  external album (its quiet "Get just this album" path). */
export interface DiscographyItem {
  key: string;
  title: string;
  year?: number;
  thumb?: string;
  ref: EntityRef;
  /** SP0 entity-state flags (the rest derive from `ref.source` in `entityState`). */
  downloaded: boolean;
  acquiring: boolean;
  /** Dim the card (last.fm-only, not fetchable). */
  unavailable: boolean;
  /** Present when this external album can be acquired on its own. */
  acquire?: { providerId: string; providerRef: string };
}

const lc = (s: string) => s.trim().toLowerCase();

/** Build the mixed discography for an artist page: owned Plex albums unioned
 *  with the acquisition/last.fm discography. Owned albums win on a title clash
 *  (they're marked In library and navigate into the library); the rest carry
 *  acquisition status. Owned albums always lead, then external-only titles in
 *  the order the provider returned them. Pure + tested. */
export function unifyDiscography(
  owned: Album[],
  external: AcquirableAlbumDto[],
): DiscographyItem[] {
  const ownedTitles = new Set(owned.map((a) => lc(a.title)));

  const ownedItems: DiscographyItem[] = owned.map((a) => ({
    key: `owned:${a.id}`,
    title: a.title,
    year: a.year,
    thumb: a.thumb,
    ref: entityRefForAlbum(a),
    downloaded: false,
    acquiring: false,
    unavailable: false,
  }));

  const externalItems: DiscographyItem[] = external
    // An album the provider reports as "owned" is already covered by `owned`
    // (or, when `owned` is empty, surfaces as an owned ref below); drop any
    // external title that clashes with an owned one so it doesn't double up.
    .filter((a) => !ownedTitles.has(lc(a.title)))
    .map((a) => {
      const ownedRef =
        a.state === "owned" && a.albumId && a.serverId
          ? entityRefForAlbum({
              id: a.albumId,
              serverId: a.serverId,
              artistId: a.artistId ?? "",
              title: a.title,
            })
          : null;
      const acquiring = a.state === "downloading" || a.state === "requested";
      return {
        key: `ext:${a.providerId}:${a.providerRef}`,
        title: a.title,
        year: a.year,
        thumb: a.imageUrl,
        ref: ownedRef ?? externalAlbumRef(a.title, a.artistName),
        downloaded: a.state === "downloaded",
        acquiring,
        unavailable: a.state === "unavailable",
        acquire:
          a.state === "available"
            ? { providerId: a.providerId, providerRef: a.providerRef }
            : undefined,
      } satisfies DiscographyItem;
    });

  return [...ownedItems, ...externalItems];
}
