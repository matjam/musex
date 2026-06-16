# Arch Linux package

musex ships a `-bin` `PKGBUILD` (repackages the official x86_64 AppImage;
playback uses your **system `mpv`**, a hard dependency).

## Install (recommended)

Each release attaches a `PKGBUILD` already pinned to that release's version and
AppImage checksum. Grab the latest and build it:

```sh
curl -LO https://github.com/matjam/musex/releases/latest/download/PKGBUILD
makepkg -si
```

`latest/download/PKGBUILD` always resolves to the newest release, so this same
command upgrades you too (re-run it when a new version ships). Requires
`base-devel`.

## The file in this directory

`PKGBUILD` here is the **template** — `pkgver` and `sha256sums` are
placeholders (`SKIP`). The release CI fills them in per release and publishes
the result as the asset above; you normally don't build this copy directly. If
you do want to build straight from the repo, pin it first:

```sh
cd packaging/arch
# edit pkgver to a released version (Linux artifacts exist from v0.7.0 on)
updpkgsums
makepkg -si
```

## Notes

- `-bin` (repackaged AppImage), not from-source — `makepkg`'s network-restricted
  build sandbox doesn't suit the Electron/pnpm toolchain's build-time downloads.
- Not yet on the AUR. If that changes, `yay -S musex-bin` would be the install
  command and updates would track with the system.
- Not yet validated on a live Arch system against a real release AppImage —
  verify the icon/desktop/`chrome-sandbox` paths against the first v0.7.0 build.
