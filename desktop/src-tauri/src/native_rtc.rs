//! WebRTC DataChannels in Rust, for webviews without RTCPeerConnection (issue #176,
//! docs/desktop.md "WebRTC on Linux").
//!
//! Distro WebKitGTK is built without WebRTC, so the Linux app couldn't share or join a room. The
//! page's Trystero takes an `rtcPolyfill`, an RTCPeerConnection stand-in: that's
//! frontend/src/net/nativeRtc.ts, which drives the peer connections here over Tauri IPC. They are
//! real WebRTC peer connections (webrtc-rs: ICE, DTLS, SCTP), so browser peers can't tell the
//! difference, and document content still goes straight from peer to peer, encrypted by DTLS. The
//! shell is only the page's network stack: there's no server, and signaling stays the page's own
//! (Trystero over the WebTorrent trackers).
//!
//! Only what Trystero uses exists: data channels (no media), full-SDP or trickled offers and
//! answers, rollback, ICE restart. Host candidates are gathered as mDNS names, like browsers do,
//! so local IP addresses don't go out through the trackers.

use bytes::Bytes;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::atomic::{AtomicU16, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use webrtc::api::setting_engine::SettingEngine;
use webrtc::api::{APIBuilder, API};
use webrtc::data_channel::data_channel_init::RTCDataChannelInit;
use webrtc::data_channel::RTCDataChannel;
use webrtc::ice::mdns::MulticastDnsMode;
use webrtc::ice_transport::ice_candidate::RTCIceCandidateInit;
use webrtc::ice_transport::ice_server::RTCIceServer;
use webrtc::peer_connection::configuration::RTCConfiguration;
use webrtc::peer_connection::offer_answer_options::RTCOfferOptions;
use webrtc::peer_connection::sdp::sdp_type::RTCSdpType;
use webrtc::peer_connection::sdp::session_description::RTCSessionDescription;
use webrtc::peer_connection::RTCPeerConnection;

/// Trystero sets this on every channel (bufferedAmountLowThreshold), so it's fixed here.
pub const BUFFERED_LOW_THRESHOLD: usize = 65_535;
/// Trystero's own cap on a message (16 KiB chunks plus its header). Bigger frames are refused.
pub const MAX_MESSAGE_BYTES: usize = 64 * 1024;
/// At most this many peer connections at once, so a bug or a hostile room can't exhaust sockets.
pub const MAX_PEERS: usize = 64;

/// An ICE server from the page's RTCConfiguration.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct IceServer {
    pub urls: Urls,
    #[serde(default)]
    pub username: Option<String>,
    #[serde(default)]
    pub credential: Option<String>,
}

/// `urls` may be one string or a list, as in the browser API.
#[derive(Debug, Clone, Deserialize, PartialEq)]
#[serde(untagged)]
pub enum Urls {
    One(String),
    Many(Vec<String>),
}

impl Urls {
    fn list(&self) -> Vec<String> {
        match self {
            Urls::One(url) => vec![url.clone()],
            Urls::Many(urls) => urls.clone(),
        }
    }
}

/// Only stun:, stuns:, turn: and turns: servers; anything else is dropped.
pub fn ice_servers(servers: &[IceServer]) -> Vec<RTCIceServer> {
    servers
        .iter()
        .filter_map(|server| {
            let urls: Vec<String> = server
                .urls
                .list()
                .into_iter()
                .filter(|url| {
                    ["stun:", "stuns:", "turn:", "turns:"]
                        .iter()
                        .any(|scheme| url.starts_with(scheme))
                })
                .collect();
            (!urls.is_empty()).then(|| RTCIceServer {
                urls,
                username: server.username.clone().unwrap_or_default(),
                credential: server.credential.clone().unwrap_or_default(),
            })
        })
        .collect()
}

/// What the shell tells the page about a peer connection, in order.
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RtcEvent {
    #[serde(rename_all = "camelCase")]
    SignalingState { state: String },
    /// `local_sdp` is the local description with the candidates gathered so far, for
    /// `pc.localDescription` (Trystero reads it once gathering settles).
    #[serde(rename_all = "camelCase")]
    IceGatheringState {
        state: String,
        local_sdp: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    IceCandidate {
        candidate: Option<RTCIceCandidateInit>,
        local_sdp: Option<String>,
    },
    #[serde(rename_all = "camelCase")]
    IceConnectionState { state: String },
    #[serde(rename_all = "camelCase")]
    ConnectionState { state: String },
    /// The other side opened a channel.
    #[serde(rename_all = "camelCase")]
    DataChannel { channel: u16, label: String },
    #[serde(rename_all = "camelCase")]
    ChannelOpen { channel: u16 },
    #[serde(rename_all = "camelCase")]
    ChannelClose { channel: u16 },
    #[serde(rename_all = "camelCase")]
    ChannelError { channel: u16, message: String },
    #[serde(rename_all = "camelCase")]
    BufferedAmountLow { channel: u16, buffered: usize },
}

/// Where events and incoming messages go: Tauri channels in the app, a queue in tests.
pub trait RtcSink: Send + Sync + 'static {
    fn event(&self, event: RtcEvent);
    /// A message on a channel. Sent to the page as [channel id, 2 bytes big-endian][payload].
    fn message(&self, channel: u16, data: Bytes);
}

/// One peer connection and its data channels.
pub struct Peer {
    pc: Arc<RTCPeerConnection>,
    channels: Arc<Mutex<HashMap<u16, Arc<RTCDataChannel>>>>,
    next_channel: Arc<AtomicU16>,
    sink: Arc<dyn RtcSink>,
}

fn lock<T>(mutex: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|e| e.into_inner())
}

/// Every peer connection the page has open.
pub struct NativeRtc {
    api: API,
    peers: Mutex<HashMap<u32, Arc<Peer>>>,
    next_peer: AtomicU32,
}

impl NativeRtc {
    /// `mdns_gather`: host candidates as mDNS names (the app), or plain IPs (tests on loopback).
    pub fn new(mdns_gather: bool) -> NativeRtc {
        let mut settings = SettingEngine::default();
        settings.set_ice_multicast_dns_mode(if mdns_gather {
            MulticastDnsMode::QueryAndGather
        } else {
            MulticastDnsMode::QueryOnly
        });
        settings.set_include_loopback_candidate(!mdns_gather);
        NativeRtc {
            api: APIBuilder::new().with_setting_engine(settings).build(),
            peers: Mutex::new(HashMap::new()),
            next_peer: AtomicU32::new(1),
        }
    }

    pub fn peer(&self, id: u32) -> Result<Arc<Peer>, String> {
        lock(&self.peers)
            .get(&id)
            .cloned()
            .ok_or_else(|| "closed".to_string())
    }

    /// A new peer connection. Returns its id.
    pub async fn create(
        &self,
        servers: &[IceServer],
        sink: Arc<dyn RtcSink>,
    ) -> Result<u32, String> {
        if lock(&self.peers).len() >= MAX_PEERS {
            return Err("too many peer connections".into());
        }
        let config = RTCConfiguration {
            ice_servers: ice_servers(servers),
            ..Default::default()
        };
        let pc = Arc::new(
            self.api
                .new_peer_connection(config)
                .await
                .map_err(|e| e.to_string())?,
        );
        let peer = Arc::new(Peer {
            pc: pc.clone(),
            channels: Arc::new(Mutex::new(HashMap::new())),
            next_channel: Arc::new(AtomicU16::new(1)),
            sink: sink.clone(),
        });
        peer.watch();
        let id = self.next_peer.fetch_add(1, Ordering::Relaxed);
        lock(&self.peers).insert(id, peer);
        Ok(id)
    }

    /// Close a peer connection (and its channels) and forget it.
    pub async fn close(&self, id: u32) -> Result<(), String> {
        let Some(peer) = lock(&self.peers).remove(&id) else {
            return Ok(());
        };
        peer.pc.close().await.map_err(|e| e.to_string())
    }
}

impl Peer {
    /// Forward the connection's own events to the page.
    fn watch(&self) {
        let sink = self.sink.clone();
        self.pc.on_signaling_state_change(Box::new(move |state| {
            sink.event(RtcEvent::SignalingState {
                state: state.to_string(),
            });
            Box::pin(async {})
        }));
        let sink = self.sink.clone();
        let pc = Arc::downgrade(&self.pc);
        self.pc
            .on_ice_gathering_state_change(Box::new(move |state| {
                let sink = sink.clone();
                let pc = pc.clone();
                Box::pin(async move {
                    let local_sdp = match pc.upgrade() {
                        Some(pc) => pc.local_description().await.map(|d| d.sdp),
                        None => None,
                    };
                    sink.event(RtcEvent::IceGatheringState {
                        state: state.to_string(),
                        local_sdp,
                    });
                })
            }));
        let sink = self.sink.clone();
        let pc = Arc::downgrade(&self.pc);
        self.pc.on_ice_candidate(Box::new(move |candidate| {
            let sink = sink.clone();
            let pc = pc.clone();
            Box::pin(async move {
                let candidate = candidate.and_then(|c| c.to_json().ok());
                let local_sdp = match pc.upgrade() {
                    Some(pc) => pc.local_description().await.map(|d| d.sdp),
                    None => None,
                };
                sink.event(RtcEvent::IceCandidate {
                    candidate,
                    local_sdp,
                });
            })
        }));
        let sink = self.sink.clone();
        self.pc
            .on_ice_connection_state_change(Box::new(move |state| {
                sink.event(RtcEvent::IceConnectionState {
                    state: state.to_string(),
                });
                Box::pin(async {})
            }));
        let sink = self.sink.clone();
        self.pc
            .on_peer_connection_state_change(Box::new(move |state| {
                sink.event(RtcEvent::ConnectionState {
                    state: state.to_string(),
                });
                Box::pin(async {})
            }));
        let sink = self.sink.clone();
        let channels = self.channels.clone();
        let next = self.next_channel.clone();
        self.pc.on_data_channel(Box::new(move |dc| {
            let sink = sink.clone();
            let channels = channels.clone();
            let id = next.fetch_add(1, Ordering::Relaxed);
            Box::pin(async move {
                lock(&channels).insert(id, dc.clone());
                sink.event(RtcEvent::DataChannel {
                    channel: id,
                    label: dc.label().to_string(),
                });
                wire_channel(id, &dc, sink).await;
            })
        }));
    }

    /// A channel opened from this side. It's negotiated by the next offer, like the browser's.
    pub async fn create_data_channel(&self, label: &str) -> Result<u16, String> {
        let init = RTCDataChannelInit {
            ordered: Some(true),
            ..Default::default()
        };
        let dc = self
            .pc
            .create_data_channel(label, Some(init))
            .await
            .map_err(|e| e.to_string())?;
        let id = self.next_channel.fetch_add(1, Ordering::Relaxed);
        lock(&self.channels).insert(id, dc.clone());
        wire_channel(id, &dc, self.sink.clone()).await;
        Ok(id)
    }

    /// An offer (or an answer to the remote offer), not yet applied.
    pub async fn create_description(
        &self,
        kind: &str,
        ice_restart: bool,
    ) -> Result<String, String> {
        let description = match kind {
            "offer" => {
                self.pc
                    .create_offer(Some(RTCOfferOptions {
                        ice_restart,
                        voice_activity_detection: false,
                    }))
                    .await
            }
            "answer" => self.pc.create_answer(None).await,
            other => return Err(format!("can't create a {other}")),
        };
        Ok(description.map_err(|e| e.to_string())?.sdp)
    }

    /// setLocalDescription or setRemoteDescription. Returns the description as applied.
    pub async fn set_description(
        &self,
        local: bool,
        kind: &str,
        sdp: String,
    ) -> Result<(), String> {
        let description = session_description(kind, sdp)?;
        let result = if local {
            self.pc.set_local_description(description).await
        } else {
            self.pc.set_remote_description(description).await
        };
        result.map_err(|e| e.to_string())
    }

    pub async fn add_ice_candidate(&self, candidate: RTCIceCandidateInit) -> Result<(), String> {
        self.pc
            .add_ice_candidate(candidate)
            .await
            .map_err(|e| e.to_string())
    }

    /// Send one message on a channel. Returns the channel's buffered amount afterwards.
    pub async fn send(&self, channel: u16, data: Bytes) -> Result<usize, String> {
        if data.len() > MAX_MESSAGE_BYTES {
            return Err("message too large".into());
        }
        let dc = lock(&self.channels)
            .get(&channel)
            .cloned()
            .ok_or("no such channel")?;
        dc.send(&data).await.map_err(|e| e.to_string())?;
        Ok(dc.buffered_amount().await)
    }

    pub async fn close_channel(&self, channel: u16) -> Result<(), String> {
        let dc = lock(&self.channels).remove(&channel);
        match dc {
            Some(dc) => dc.close().await.map_err(|e| e.to_string()),
            None => Ok(()),
        }
    }
}

fn session_description(kind: &str, sdp: String) -> Result<RTCSessionDescription, String> {
    match kind {
        "offer" => RTCSessionDescription::offer(sdp),
        "answer" => RTCSessionDescription::answer(sdp),
        "pranswer" => RTCSessionDescription::pranswer(sdp),
        "rollback" => {
            let mut description = RTCSessionDescription::default();
            description.sdp_type = RTCSdpType::Rollback;
            Ok(description)
        }
        other => return Err(format!("unknown description type {other}")),
    }
    .map_err(|e| e.to_string())
}

/// Forward a channel's events and messages to the page.
async fn wire_channel(id: u16, dc: &Arc<RTCDataChannel>, sink: Arc<dyn RtcSink>) {
    dc.set_buffered_amount_low_threshold(BUFFERED_LOW_THRESHOLD)
        .await;
    let open_sink = sink.clone();
    dc.on_open(Box::new(move || {
        open_sink.event(RtcEvent::ChannelOpen { channel: id });
        Box::pin(async {})
    }));
    let close_sink = sink.clone();
    dc.on_close(Box::new(move || {
        close_sink.event(RtcEvent::ChannelClose { channel: id });
        Box::pin(async {})
    }));
    let error_sink = sink.clone();
    dc.on_error(Box::new(move |error| {
        error_sink.event(RtcEvent::ChannelError {
            channel: id,
            message: error.to_string(),
        });
        Box::pin(async {})
    }));
    let message_sink = sink.clone();
    dc.on_message(Box::new(move |message| {
        message_sink.message(id, message.data);
        Box::pin(async {})
    }));
    let low_sink = sink;
    let weak = Arc::downgrade(dc);
    dc.on_buffered_amount_low(Box::new(move || {
        let sink = low_sink.clone();
        let weak = weak.clone();
        Box::pin(async move {
            let buffered = match weak.upgrade() {
                Some(dc) => dc.buffered_amount().await,
                None => 0,
            };
            sink.event(RtcEvent::BufferedAmountLow {
                channel: id,
                buffered,
            });
        })
    }))
    .await;
}

/// Split a send batch from the page: repeated [channel u16][length u32][bytes], big-endian.
pub fn parse_frames(body: &[u8]) -> Result<Vec<(u16, Bytes)>, String> {
    let mut frames = Vec::new();
    let mut at = 0;
    while at < body.len() {
        if body.len() - at < 6 {
            return Err("truncated frame".into());
        }
        let channel = u16::from_be_bytes([body[at], body[at + 1]]);
        let len =
            u32::from_be_bytes([body[at + 2], body[at + 3], body[at + 4], body[at + 5]]) as usize;
        at += 6;
        if len > MAX_MESSAGE_BYTES || body.len() - at < len {
            return Err("bad frame length".into());
        }
        frames.push((channel, Bytes::copy_from_slice(&body[at..at + len])));
        at += len;
    }
    Ok(frames)
}

/// A message for the page: [channel u16 big-endian][payload].
pub fn frame_message(channel: u16, data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len() + 2);
    out.extend_from_slice(&channel.to_be_bytes());
    out.extend_from_slice(data);
    out
}

/// The Tauri side: commands the page calls (frontend/src/net/nativeRtc.ts).
pub mod commands {
    use super::*;
    use tauri::ipc::{Channel, InvokeBody, InvokeResponseBody, Request};
    use tauri::State;

    struct TauriSink {
        events: Channel<RtcEvent>,
        messages: Channel<InvokeResponseBody>,
    }

    impl RtcSink for TauriSink {
        fn event(&self, event: RtcEvent) {
            let _ = self.events.send(event);
        }
        fn message(&self, channel: u16, data: Bytes) {
            let _ = self
                .messages
                .send(InvokeResponseBody::Raw(frame_message(channel, &data)));
        }
    }

    #[tauri::command]
    pub async fn rtc_create(
        rtc: State<'_, NativeRtc>,
        ice_servers: Vec<IceServer>,
        events: Channel<RtcEvent>,
        messages: Channel<InvokeResponseBody>,
    ) -> Result<u32, String> {
        rtc.create(&ice_servers, Arc::new(TauriSink { events, messages }))
            .await
    }

    #[tauri::command]
    pub async fn rtc_create_data_channel(
        rtc: State<'_, NativeRtc>,
        peer: u32,
        label: String,
    ) -> Result<u16, String> {
        rtc.peer(peer)?.create_data_channel(&label).await
    }

    #[tauri::command]
    pub async fn rtc_create_description(
        rtc: State<'_, NativeRtc>,
        peer: u32,
        kind: String,
        ice_restart: bool,
    ) -> Result<String, String> {
        rtc.peer(peer)?.create_description(&kind, ice_restart).await
    }

    #[tauri::command]
    pub async fn rtc_set_description(
        rtc: State<'_, NativeRtc>,
        peer: u32,
        local: bool,
        kind: String,
        sdp: String,
    ) -> Result<(), String> {
        rtc.peer(peer)?.set_description(local, &kind, sdp).await
    }

    #[tauri::command]
    pub async fn rtc_add_ice_candidate(
        rtc: State<'_, NativeRtc>,
        peer: u32,
        candidate: RTCIceCandidateInit,
    ) -> Result<(), String> {
        rtc.peer(peer)?.add_ice_candidate(candidate).await
    }

    /// A batch of messages as the raw request body (parse_frames), the peer in the `x-rtc-peer`
    /// header. Returns each channel's buffered amount after the batch.
    #[tauri::command]
    pub async fn rtc_send(
        rtc: State<'_, NativeRtc>,
        request: Request<'_>,
    ) -> Result<HashMap<u16, usize>, String> {
        let peer = request
            .headers()
            .get("x-rtc-peer")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u32>().ok())
            .ok_or("missing peer")?;
        let InvokeBody::Raw(body) = request.body() else {
            return Err("expected bytes".into());
        };
        let frames = parse_frames(body)?;
        let peer = rtc.peer(peer)?;
        let mut buffered = HashMap::new();
        for (channel, data) in frames {
            buffered.insert(channel, peer.send(channel, data).await?);
        }
        Ok(buffered)
    }

    /// Close a channel, or with no channel the whole peer connection.
    #[tauri::command]
    pub async fn rtc_close(
        rtc: State<'_, NativeRtc>,
        peer: u32,
        channel: Option<u16>,
    ) -> Result<(), String> {
        match channel {
            Some(channel) => match rtc.peer(peer) {
                Ok(peer) => peer.close_channel(channel).await,
                Err(_) => Ok(()),
            },
            None => rtc.close(peer).await,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;
    use tokio::sync::mpsc;

    type Item = (Option<RtcEvent>, Option<(u16, Bytes)>);
    type Rx = mpsc::UnboundedReceiver<Item>;

    struct TestSink(mpsc::UnboundedSender<Item>);
    impl RtcSink for TestSink {
        fn event(&self, event: RtcEvent) {
            let _ = self.0.send((Some(event), None));
        }
        fn message(&self, channel: u16, data: Bytes) {
            let _ = self.0.send((None, Some((channel, data))));
        }
    }

    fn sink() -> (Arc<dyn RtcSink>, Rx) {
        let (tx, rx) = mpsc::unbounded_channel();
        (Arc::new(TestSink(tx)), rx)
    }

    /// Wait for an event, with a timeout, collecting messages on the way.
    async fn until(
        rx: &mut Rx,
        mut want: impl FnMut(&RtcEvent) -> bool,
        messages: &mut Vec<(u16, Bytes)>,
    ) -> RtcEvent {
        tokio::time::timeout(Duration::from_secs(20), async {
            loop {
                match rx.recv().await.expect("sink closed") {
                    (Some(event), _) if want(&event) => return event,
                    (_, Some(message)) => messages.push(message),
                    _ => {}
                }
            }
        })
        .await
        .expect("timed out waiting for an event")
    }

    #[test]
    fn ice_servers_keep_only_stun_and_turn() {
        let servers: Vec<IceServer> = serde_json::from_value(serde_json::json!([
            { "urls": "stun:stun.l.google.com:19302" },
            { "urls": ["turn:turn.example.com:3478", "https://evil.example"], "username": "u", "credential": "c" },
            { "urls": "http://nope" }
        ]))
        .unwrap();
        let out = ice_servers(&servers);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].urls, vec!["stun:stun.l.google.com:19302"]);
        assert_eq!(out[1].urls, vec!["turn:turn.example.com:3478"]);
        assert_eq!(out[1].username, "u");
    }

    #[test]
    fn frames_round_trip_and_reject_bad_lengths() {
        let mut body = Vec::new();
        for (channel, data) in [(1u16, &b"hello"[..]), (2, &b""[..])] {
            body.extend_from_slice(&channel.to_be_bytes());
            body.extend_from_slice(&(data.len() as u32).to_be_bytes());
            body.extend_from_slice(data);
        }
        let frames = parse_frames(&body).unwrap();
        assert_eq!(
            frames,
            vec![(1, Bytes::from_static(b"hello")), (2, Bytes::new())]
        );
        // Cut inside the first frame's payload.
        assert!(parse_frames(&body[..8]).is_err());
        assert!(parse_frames(&[0, 1, 0, 0]).is_err());
        let mut huge = vec![0, 1];
        huge.extend_from_slice(&((MAX_MESSAGE_BYTES + 1) as u32).to_be_bytes());
        assert!(parse_frames(&huge).is_err());
        assert_eq!(frame_message(258, b"x"), vec![1, 2, b'x']);
    }

    #[test]
    fn events_serialize_like_the_page_expects() {
        let event = RtcEvent::IceGatheringState {
            state: "complete".into(),
            local_sdp: Some("v=0".into()),
        };
        assert_eq!(
            serde_json::to_value(&event).unwrap(),
            serde_json::json!({ "kind": "iceGatheringState", "state": "complete", "localSdp": "v=0" })
        );
        assert_eq!(
            serde_json::to_value(RtcEvent::DataChannel {
                channel: 3,
                label: "data".into()
            })
            .unwrap(),
            serde_json::json!({ "kind": "dataChannel", "channel": 3, "label": "data" })
        );
    }

    /// Two peer connections on loopback, the way Trystero's torrent strategy runs them: the
    /// initiator makes the channel, both wait for gathering and swap whole SDPs (no trickle).
    #[tokio::test(flavor = "multi_thread")]
    async fn two_peers_connect_and_exchange_messages() {
        let rtc = NativeRtc::new(false);
        let (sink_a, mut rx_a) = sink();
        let (sink_b, mut rx_b) = sink();
        let a = rtc.create(&[], sink_a).await.unwrap();
        let b = rtc.create(&[], sink_b).await.unwrap();
        let (pa, pb) = (rtc.peer(a).unwrap(), rtc.peer(b).unwrap());
        let mut got_a = Vec::new();
        let mut got_b = Vec::new();

        let ch_a = pa.create_data_channel("data").await.unwrap();
        let offer = pa.create_description("offer", false).await.unwrap();
        pa.set_description(true, "offer", offer).await.unwrap();
        let gathered = until(
            &mut rx_a,
            |e| matches!(e, RtcEvent::IceGatheringState { state, .. } if state == "complete"),
            &mut got_a,
        )
        .await;
        let RtcEvent::IceGatheringState {
            local_sdp: Some(offer),
            ..
        } = gathered
        else {
            panic!("no local sdp")
        };
        assert!(
            offer.contains("a=candidate"),
            "the full offer carries its candidates"
        );

        pb.set_description(false, "offer", offer).await.unwrap();
        let answer = pb.create_description("answer", false).await.unwrap();
        pb.set_description(true, "answer", answer).await.unwrap();
        let gathered = until(
            &mut rx_b,
            |e| matches!(e, RtcEvent::IceGatheringState { state, .. } if state == "complete"),
            &mut got_b,
        )
        .await;
        let RtcEvent::IceGatheringState {
            local_sdp: Some(answer),
            ..
        } = gathered
        else {
            panic!("no local sdp")
        };
        pa.set_description(false, "answer", answer).await.unwrap();

        until(
            &mut rx_a,
            |e| matches!(e, RtcEvent::ChannelOpen { channel } if *channel == ch_a),
            &mut got_a,
        )
        .await;
        let RtcEvent::DataChannel {
            channel: ch_b,
            label,
        } = until(
            &mut rx_b,
            |e| matches!(e, RtcEvent::DataChannel { .. }),
            &mut got_b,
        )
        .await
        else {
            unreachable!()
        };
        assert_eq!(label, "data");
        until(
            &mut rx_b,
            |e| matches!(e, RtcEvent::ChannelOpen { .. }),
            &mut got_b,
        )
        .await;

        pa.send(ch_a, Bytes::from_static(b"from a")).await.unwrap();
        pb.send(ch_b, Bytes::from(vec![7u8; 16 * 1024]))
            .await
            .unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            while got_b.is_empty() {
                if let Some((_, Some(message))) = rx_b.recv().await {
                    got_b.push(message);
                }
            }
            while got_a.is_empty() {
                if let Some((_, Some(message))) = rx_a.recv().await {
                    got_a.push(message);
                }
            }
        })
        .await
        .expect("messages arrive");
        assert_eq!(got_b[0], (ch_b, Bytes::from_static(b"from a")));
        assert_eq!(got_a[0].1.len(), 16 * 1024);

        assert!(pa
            .send(ch_a, Bytes::from(vec![0u8; MAX_MESSAGE_BYTES + 1]))
            .await
            .is_err());
        assert!(pa.send(99, Bytes::from_static(b"x")).await.is_err());
        pa.close_channel(ch_a).await.unwrap();
        rtc.close(a).await.unwrap();
        rtc.close(b).await.unwrap();
        assert!(rtc.peer(a).is_err());
        assert!(rtc.close(a).await.is_ok());
    }

    #[tokio::test]
    async fn bad_descriptions_are_errors_not_panics() {
        let rtc = NativeRtc::new(false);
        let (s, _rx) = sink();
        let id = rtc.create(&[], s).await.unwrap();
        let peer = rtc.peer(id).unwrap();
        assert!(peer.create_description("pranswer", false).await.is_err());
        assert!(peer
            .set_description(false, "offer", "not sdp".into())
            .await
            .is_err());
        assert!(peer
            .set_description(true, "bogus", String::new())
            .await
            .is_err());
        // Rollback from stable is an error in the API too.
        assert!(peer
            .set_description(true, "rollback", String::new())
            .await
            .is_err());
        rtc.close(id).await.unwrap();
    }
}
