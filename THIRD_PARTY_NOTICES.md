# Third-party notices

The desktop application is MIT licensed. Bundled components retain their own licenses.

- go2rtc: copyright Alexey Khit, MIT, https://github.com/AlexxIT/go2rtc. The complete engine source is in `engine/`, based on Ray8876/go2rtc commit `885aec5` (H.265 malformed AVCC checks, Xiaomi command-channel drain, Session16 reassembly checks). Desktop changes add an in-memory encrypted-session bridge, defensive login-step handling, and dynamic RTSP-port discovery. The engine's license is shipped separately.
- VideoRTC: Alexey Khit, MIT, copied from the same engine revision into `ui/video-rtc.js`.
- Electron and Chromium: Electron is MIT; Chromium and its dependencies carry multiple permissive licenses. Electron's LICENSE and LICENSES.chromium.html are retained by the application packager.
- FFmpeg: a separate executable. Windows uses the GPL v3 build from ffmpeg-static release b6.1.1. macOS builds FFmpeg 7.1.2 from fixed source with x264 and Opus; GPL v3, x264 and Opus licenses are shipped with the executable. Source links, source SHA-256 checksums and complete build instructions are in `scripts/build-ffmpeg-mac.cjs` and `docs/FFMPEG-SOURCE.md`. No nonfree components are enabled in the Mac build.
- ws (MIT), yaml (ISC), archiver (MIT): licenses are included in the installed Node dependency tree. Development dependencies are not shipped in the app.

This is an independent client; it is not affiliated with Xiaomi. Xiaomi account authentication and camera access use the protocols implemented by go2rtc. Compatibility varies by camera model and Xiaomi service behavior.
