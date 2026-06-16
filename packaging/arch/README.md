# Arch Linux package

`PKGBUILD` builds a `musex-bin` package by repackaging the official x86_64
AppImage from [GitHub Releases](https://github.com/matjam/musex/releases).
Playback uses your **system `mpv`** (a hard dependency), matching musex's
Linux design.

## Build & install locally

```sh
cd packaging/arch
updpkgsums          # pin sha256sums to the published AppImage for this pkgver
makepkg -si         # build and install (pulls deps incl. mpv)
```

> The committed `sha256sums=('SKIP')` is a placeholder. `updpkgsums` replaces it
> with the real checksum of the AppImage for the `pkgver` in the file. Linux
> artifacts exist from **v0.7.0** onward — bump `pkgver` to a version that
> actually shipped an AppImage before building.

## Notes

- This is a `-bin` package (repackaged AppImage), not a from-source build —
  `makepkg`'s network-restricted build sandbox doesn't play well with the
  Electron/pnpm toolchain's build-time downloads.
- AUR submission: after pinning the checksum, generate the metadata with
  `makepkg --printsrcinfo > .SRCINFO` and push to the AUR repo.
- This recipe is published for convenience and hasn't yet been validated on a
  live Arch system against a real release AppImage — verify paths
  (icon/desktop/`chrome-sandbox`) against the first v0.7.0 AppImage.
