import type { Artist } from "@musex/core";
import { describe, expect, it } from "vitest";
import { matchSectionsAgainstLibrary } from "./section-matching";

const artists: Artist[] = [
  { id: "a1", serverId: "s1", name: "Lamb" },
  { id: "a2", serverId: "s1", name: "Massive Attack" },
];

describe("matchSectionsAgainstLibrary", () => {
  it("flattens per-plugin sections and enriches items with library matches", () => {
    const out = matchSectionsAgainstLibrary(
      [
        {
          pluginId: "lastfm",
          sections: [
            {
              title: "Because you listened to Lamb",
              items: [
                { name: "massive attack", externalUrl: "https://last.fm/ma" }, // case-insensitive match
                { name: "Portishead", externalUrl: "https://last.fm/p" }, // not owned
              ],
            },
          ],
        },
      ],
      artists,
    );
    expect(out).toEqual([
      {
        pluginId: "lastfm",
        title: "Because you listened to Lamb",
        items: [
          {
            name: "massive attack",
            externalUrl: "https://last.fm/ma",
            artistId: "a2",
            serverId: "s1",
          },
          { name: "Portishead", externalUrl: "https://last.fm/p", external: true },
        ],
      },
    ]);
  });

  it("flags everything external when the artist list is empty (no library)", () => {
    const out = matchSectionsAgainstLibrary(
      [{ pluginId: "p", sections: [{ title: "T", items: [{ name: "Lamb" }] }] }],
      [],
    );
    expect(out[0]?.items).toEqual([{ name: "Lamb", external: true }]);
  });

  it("keeps the first artist when names collide case-insensitively", () => {
    const out = matchSectionsAgainstLibrary(
      [{ pluginId: "p", sections: [{ title: "T", items: [{ name: "LAMB" }] }] }],
      [
        { id: "first", serverId: "s1", name: "Lamb" },
        { id: "second", serverId: "s2", name: "lamb" },
      ],
    );
    expect(out[0]?.items[0]).toMatchObject({ artistId: "first", serverId: "s1" });
  });
});
