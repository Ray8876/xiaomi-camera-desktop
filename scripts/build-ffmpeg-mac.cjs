const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const {spawnSync} = require('node:child_process');
const root = path.join(__dirname, '..');
const arch = process.env.TARGET_ARCH || process.arch;
if (process.platform !== 'darwin' || arch !== process.arch) throw new Error('Build FFmpeg on a native Mac of the target architecture');
const sources = {
  ffmpeg: {url: 'https://codeload.github.com/FFmpeg/FFmpeg/tar.gz/refs/tags/n7.1.2', sha256: '8cb1bb8cfa9aeae13279b4da42ae8307ae6777456d4270f2e603c95aa08ca8ef'},
  x264: {url: 'https://codeload.github.com/mirror/x264/tar.gz/c24e06c2e184345ceb33eb20a15d1024d9fd3497', sha256: '090d730e867fc63631782a1287974635d1237d0fa7c6fd1d09fd543620a56689'},
  opus: {url: 'https://downloads.xiph.org/releases/opus/opus-1.5.2.tar.gz', sha256: '65c1d2f78b9f2fb20082c38cbe47c951ad5839345876e46941612ee87f9a7ce1'}
};
const cache = path.join(root, 'work', 'sources'), build = path.join(root, 'work', `ffmpeg-build-${arch}`), prefix = path.join(build, 'prefix');
const output = path.join(root, 'resources', `darwin-${arch}`);
fs.mkdirSync(cache, {recursive: true}); fs.mkdirSync(prefix, {recursive: true}); fs.mkdirSync(output, {recursive: true});
const env = {...process.env, MACOSX_DEPLOYMENT_TARGET: '12.0', PKG_CONFIG_PATH: path.join(prefix, 'lib', 'pkgconfig')};
function run(cmd, args, cwd, logName = 'build.log') {
  const log = fs.openSync(path.join(build, logName), 'a');
  const result = spawnSync(cmd, args, {cwd, env, stdio: ['ignore', log, log]}); fs.closeSync(log);
  if (result.status !== 0) throw new Error(`${cmd} failed: ${fs.readFileSync(path.join(build, logName), 'utf8').slice(-8000)}`);
}
for (const [name, metadata] of Object.entries(sources)) {
  const tarball = path.join(cache, `${name}.tar.gz`);
  if (!fs.existsSync(tarball) || crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex') !== metadata.sha256) {
    const download = spawnSync('curl', ['-fL', '--retry', '3', '--max-time', '240', metadata.url, '-o', tarball], {stdio: 'inherit'});
    if (download.status !== 0) throw new Error(`${name} download failed`);
  }
  if (crypto.createHash('sha256').update(fs.readFileSync(tarball)).digest('hex') !== metadata.sha256) throw new Error(`${name} source checksum mismatch`);
  const sourceDir = path.join(build, name); fs.mkdirSync(sourceDir, {recursive: true});
  run('tar', ['-xzf', tarball, '--strip-components=1', '-C', sourceDir], build);
}
const jobs = String(Math.min(os.availableParallelism(), 8));
console.log('Building static x264');
run('sh', ['./configure', `--prefix=${prefix}`, '--enable-static', '--disable-cli', '--disable-opencl'], path.join(build, 'x264'));
run('make', ['-j', jobs], path.join(build, 'x264')); run('make', ['install'], path.join(build, 'x264'));
console.log('Building static Opus');
run('sh', ['./configure', `--prefix=${prefix}`, '--enable-static', '--disable-shared', '--disable-doc', '--disable-extra-programs'], path.join(build, 'opus'));
run('make', ['-j', jobs], path.join(build, 'opus')); run('make', ['install'], path.join(build, 'opus'));
console.log('Building FFmpeg');
const args = ['./configure', `--prefix=${prefix}`, '--disable-everything', '--disable-autodetect', '--enable-small', '--disable-debug', '--disable-doc', '--disable-ffplay', '--disable-ffprobe', '--disable-shared', '--enable-static', '--enable-gpl', '--enable-version3', '--enable-libx264', '--enable-libopus', '--pkg-config-flags=--static', `--extra-cflags=-I${prefix}/include`, `--extra-ldflags=-L${prefix}/lib`,
  '--enable-protocol=file,pipe,tcp,udp,rtp', '--enable-demuxer=mov,matroska,rtsp,sdp,rtp', '--enable-muxer=rtsp,mp4,mov,rtp,matroska', '--enable-decoder=h264,hevc,aac,pcm_alaw,pcm_mulaw,pcm_s16le,opus', '--enable-encoder=libx264,libopus', '--enable-parser=h264,hevc,aac,opus', '--enable-bsf=h264_mp4toannexb,hevc_mp4toannexb,aac_adtstoasc', '--enable-indev=lavfi', '--enable-filter=testsrc2,sine,color,anullsrc,aresample,format,scale,fps,null,anull,aformat,asetpts,setpts'];
run('sh', args, path.join(build, 'ffmpeg'));
run('make', ['-j', jobs], path.join(build, 'ffmpeg'));
const binary = path.join(output, 'ffmpeg'); fs.copyFileSync(path.join(build, 'ffmpeg', 'ffmpeg'), binary); fs.chmodSync(binary, 0o755);
const deps = spawnSync('otool', ['-L', binary], {encoding: 'utf8'}).stdout;
if (deps.split('\n').slice(1).some(line => line.trim() && !/^\s*\/(usr\/lib|System\/Library)\//.test(line))) throw new Error('FFmpeg depends on non-system dynamic libraries');
fs.copyFileSync(path.join(build, 'ffmpeg', 'COPYING.GPLv3'), path.join(output, 'FFmpeg-LICENSE.txt'));
fs.copyFileSync(path.join(build, 'x264', 'COPYING'), path.join(output, 'x264-LICENSE.txt'));
fs.copyFileSync(path.join(build, 'opus', 'COPYING'), path.join(output, 'Opus-LICENSE.txt'));
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify({ffmpeg: {version: '7.1.2', sha256: crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex'), sources, configure: args}}, null, 2));
console.log('FFmpeg ready');
