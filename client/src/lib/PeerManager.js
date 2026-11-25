/**
 * WebRTC full-mesh manager. Socket.IO is used only for signalling; audio/video flows
 * peer-to-peer. The peer that JOINS is always the offerer, so offers never collide.
 */
export class PeerManager {
  constructor({ socket, iceServers, getLocalStream, getVideoTrack, onStream, onRemoved, onState }) {
    Object.assign(this, { socket, iceServers, getLocalStream, getVideoTrack, onStream, onRemoved, onState });
    this.peers = new Map(); // id -> { pc, stream, pending[], videoSender, initiator }
    this.chains = new Map(); // id -> promise (serialises signalling per peer)
  }

  _create(id, initiator) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = { pc, stream: new MediaStream(), pending: [], initiator };
    this.peers.set(id, entry);

    const local = this.getLocalStream();
    const audio = local?.getAudioTracks()[0];
    const video = this.getVideoTrack();
    // Always create both m-lines so a user without camera/mic can still receive.
    entry.audioSender = (audio ? pc.addTransceiver(audio, { direction: 'sendrecv', streams: [local] }) : pc.addTransceiver('audio', { direction: 'sendrecv' })).sender;
    entry.videoSender = (video ? pc.addTransceiver(video, { direction: 'sendrecv', streams: [local] }) : pc.addTransceiver('video', { direction: 'sendrecv' })).sender;

    pc.onicecandidate = (e) => e.candidate && this.socket.emit('signal', { to: id, data: { candidate: e.candidate } });
    pc.ontrack = (e) => { entry.stream.addTrack(e.track); this.onStream(id, entry.stream); };
    pc.onconnectionstatechange = async () => {
      this.onState?.(id, pc.connectionState);
      if (pc.connectionState === 'failed' && entry.initiator) {
        try { // one ICE restart attempt
          await pc.setLocalDescription(await pc.createOffer({ iceRestart: true }));
          this.socket.emit('signal', { to: id, data: { description: pc.localDescription } });
        } catch (err) { console.warn('ICE restart failed', err); }
      }
    };
    return entry;
  }

  /** Called by the newly joined peer for every peer already in the room. */
  async connectTo(id) {
    if (this.peers.has(id)) return;
    const { pc } = this._create(id, true);
    await pc.setLocalDescription(await pc.createOffer());
    this.socket.emit('signal', { to: id, data: { description: pc.localDescription } });
  }

  handleSignal(from, data) {
    const next = (this.chains.get(from) || Promise.resolve()).then(() => this._handle(from, data)).catch((e) => console.warn('signal error', e));
    this.chains.set(from, next);
  }

  async _handle(from, data) {
    let entry = this.peers.get(from);
    if (data.description) {
      const d = data.description;
      if (d.type === 'offer') {
        entry ||= this._create(from, false);
        await entry.pc.setRemoteDescription(d);
        await this._flush(entry);
        await entry.pc.setLocalDescription(await entry.pc.createAnswer());
        this.socket.emit('signal', { to: from, data: { description: entry.pc.localDescription } });
      } else if (d.type === 'answer' && entry) {
        await entry.pc.setRemoteDescription(d);
        await this._flush(entry);
      }
    } else if (data.candidate && entry) {
      if (entry.pc.remoteDescription) await entry.pc.addIceCandidate(data.candidate).catch(() => {});
      else entry.pending.push(data.candidate);
    }
  }

  async _flush(entry) {
    while (entry.pending.length) await entry.pc.addIceCandidate(entry.pending.shift()).catch(() => {});
  }

  /** Swap camera <-> screen share without renegotiation. */
  replaceVideoTrack(track) {
    this.peers.forEach((e) => e.videoSender.replaceTrack(track).catch(() => {}));
  }

  remove(id) {
    const e = this.peers.get(id);
    if (!e) return;
    e.pc.close();
    this.peers.delete(id);
    this.chains.delete(id);
    this.onRemoved(id);
  }

  closeAll() {
    [...this.peers.keys()].forEach((id) => this.remove(id));
  }
}
