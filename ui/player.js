import {VideoRTC} from './video-rtc.js';
export class MiPlayer extends VideoRTC {
  constructor() {
    super(); this.mode = 'mse'; this.pcConfig.iceServers = [];
    this.visibilityCheck = false; this.DISCONNECT_TIMEOUT = 0;
    this.attempts = 0; this.disposed = false; this.wantedMuted = true;
  }
  report(event, code) {window.mi?.invoke('player-event', {slot: this.slotIndex, event, code});}
  status(text) {this.dispatchEvent(new CustomEvent('player-status', {detail: text}));}
  oninit() {
    super.oninit(); this.video.controls = false; this.video.muted = this.wantedMuted;
    this.video.style.objectFit = this.fit || 'contain';
    this.video.addEventListener('playing', () => {
      clearTimeout(this.stallTimer); this.attempts = 0; this.status(''); this.report('playing');
      this.dispatchEvent(new CustomEvent('player-live', {detail: true}));
    });
    this.video.addEventListener('stalled', () => {
      this.status('画面暂时中断，正在恢复…'); this.report('stalled');
      clearTimeout(this.stallTimer); this.stallTimer = setTimeout(() => this.retry(), 15000);
    });
    this.video.addEventListener('error', () => {
      this.report('decode_error', this.video.error?.code);
      if (this.video.error?.code >= 3) this.compatible();
    });
  }
  onopen() {
    const result = super.onopen(); this.status('正在连接…'); this.report('connected');
    const onMse = this.onmessage.mse;
    this.onmessage.mse = msg => {
      // go2rtc can negotiate audio successfully even when no video codec matches.
      if (msg.type === 'mse' && !/\b(?:avc1|avc3|hvc1|hev1|vp09|av01)\b/i.test(String(msg.value))) {
        this.report('video_codec_unavailable'); this.compatible(); return;
      }
      onMse(msg);
    };
    this.onmessage.desktop = msg => {
      if (msg.type !== 'error') return;
      this.report('stream_error');
      if (/codecs? not matched|unsupported codec|codec.*not supported|not supported/i.test(String(msg.value))) this.compatible();
      else this.onclose();
    };
    return result;
  }
  onclose() {
    if (this.disposed || !this.isConnected) return false;
    // Release both transports before reconnecting; only one connection per tile.
    super.ondisconnect(); clearTimeout(this.reconnectTID);
    const delay = Math.min(3000 * 2 ** this.attempts++, 60000);
    this.status(`连接中断，${Math.ceil(delay / 1000)} 秒后重试。请检查电脑与摄像头是否局域网互通`); this.report('reconnecting');
    this.dispatchEvent(new CustomEvent('player-live', {detail: false}));
    this.reconnectTID = setTimeout(() => {this.reconnectTID = 0; if (!this.disposed) this.onconnect();}, delay);
    return true;
  }
  compatible() {
    if (this.usingCompatible || this.disposed) {
      this.status('无法解码画面，请尝试流畅画质或导出日志'); return;
    }
    this.usingCompatible = true;
    this.wsURL = 'ws' + location.origin.slice(4) + '/api/ws?src=' + encodeURIComponent(this.compatibleSource);
    this.status('正在切换兼容播放…'); this.retry();
  }
  retry() {
    if (this.disposed) return;
    clearTimeout(this.reconnectTID); clearTimeout(this.stallTimer);
    super.ondisconnect(); this.onconnect();
  }
  mute(value) {this.wantedMuted = value; if (this.video) this.video.muted = value; this.report(value ? 'muted' : 'unmuted');}
  disconnectedCallback() {this.dispose();}
  dispose() {
    this.disposed = true; clearTimeout(this.reconnectTID); clearTimeout(this.disconnectTID); clearTimeout(this.stallTimer);
    if (this.video) super.ondisconnect();
  }
}
customElements.define('mi-player', MiPlayer);
