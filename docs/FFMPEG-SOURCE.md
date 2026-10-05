# FFmpeg source and licenses

FFmpeg is a standalone program invoked by the separately MIT-licensed client.

## macOS Apple Silicon / Intel

Both Mac variants are built using `scripts/build-ffmpeg-mac.cjs`, which downloads and checks these original source archives:

| Component | Source | SHA-256 |
| --- | --- | --- |
| FFmpeg 7.1.2 | https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n7.1.2 | `8cb1bb8cfa9aeae13279b4da42ae8307ae6777456d4270f2e603c95aa08ca8ef` |
| x264 c24e06c2 | https://codeload.github.com/mirror/x264/tar.gz/c24e06c2e184345ceb33eb20a15d1024d9fd3497 | `090d730e867fc63631782a1287974635d1237d0fa7c6fd1d09fd543620a56689` |
| Opus 1.5.2 | https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz | `65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1` |

Install Xcode Command Line Tools, pkgconf and nasm; run `pnpm ffmpeg` on the target Mac architecture. The manifest alongside the executable records the resulting binary checksum, complete configure arguments and source checksums. Only system dynamic libraries are allowed; no Homebrew libraries are required by installed clients. No changes are made to these source archives.

## Windows

Original binary: https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/ffmpeg-win32-x64

SHA-256: `04e1307997530f9cf2fe35cba2ca7e8875ca91da02f89d6c7243df819c94ad00`.

Distributor's detailed source, configuration and dependency information: https://github.com/eugeneware/ffmpeg-static/releases/download/b6.1.1/win32-x64.README (identifies https://github.com/FFmpeg/FFmpeg/commit/e38092ef93 as the FFmpeg source). The original GPL v3 license is copied to `resources/ffmpeg-LICENSE.txt`. The source/build documentation is included beside the Windows executable.

## Redistribution records

The client MIT license does not replace the FFmpeg GPL license or dependency copyrights. Windows distributor configuration and external library version records are preserved at `licenses/FFmpeg-Windows-README.txt`; GPLv3 text is at `licenses/FFmpeg-GPLv3.txt`. The Windows binary is redistributed unchanged, not built with the Mac script. Its FFmpeg source archive is available at https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/e38092ef93 ; this archive alone does not include all statically linked external library sources. Consult the distributor records and upstream source repositories for those components when redistributing that binary.

Mac source URLs and hashes above, plus `scripts/build-ffmpeg-mac.cjs`, identify all non-system libraries used by our minimal Mac build. The binary hash in the manifest is recorded before application signing; Mac signing changes executable bytes. Use release SHA256SUMS files to verify downloaded installers.
