//! Interop check for src/native_rtc.rs against a real browser (issue #176). Not part of the app.
//!
//! Answerer (default): reads a browser's complete offer SDP as one JSON line on stdin, answers with
//! one JSON line on stdout once ICE gathering is done. Offerer (`--offer`): opens the "data"
//! channel, prints its offer, then reads the browser's answer. Either way it then echoes every data
//! channel message back with "echo:" in front. desktop/scripts/rtc-interop.mjs drives it from Chromium through Playwright:
//!   cargo build --example rtc_interop && node scripts/rtc-interop.mjs
use bytes::Bytes;
use latex_collaborative_editor_lib::native_rtc::{NativeRtc, RtcEvent, RtcSink};
use std::io::BufRead;
use std::sync::Arc;
use tokio::sync::mpsc;

enum Item {
    Event(RtcEvent),
    Message(u16, Bytes),
}

struct Sink(mpsc::UnboundedSender<Item>);
impl RtcSink for Sink {
    fn event(&self, event: RtcEvent) {
        let _ = self.0.send(Item::Event(event));
    }
    fn message(&self, channel: u16, data: Bytes) {
        let _ = self.0.send(Item::Message(channel, data));
    }
}

#[tokio::main]
async fn main() {
    let offerer = std::env::args().any(|arg| arg == "--offer");
    let read_line = || {
        let mut line = String::new();
        std::io::stdin()
            .lock()
            .read_line(&mut line)
            .expect("a description on stdin");
        let value: serde_json::Value = serde_json::from_str(&line).expect("description JSON");
        value["sdp"].as_str().expect("sdp").to_string()
    };

    let rtc = NativeRtc::new(false);
    let (tx, mut rx) = mpsc::unbounded_channel();
    let id = rtc.create(&[], Arc::new(Sink(tx))).await.expect("peer");
    let peer = rtc.peer(id).unwrap();
    if offerer {
        peer.create_data_channel("data").await.expect("channel");
        let offer = peer
            .create_description("offer", false)
            .await
            .expect("offer");
        peer.set_description(true, "offer", offer)
            .await
            .expect("local offer");
    } else {
        peer.set_description(false, "offer", read_line())
            .await
            .expect("remote offer");
        let answer = peer
            .create_description("answer", false)
            .await
            .expect("answer");
        peer.set_description(true, "answer", answer)
            .await
            .expect("local answer");
    }

    while let Some(item) = rx.recv().await {
        match item {
            Item::Event(RtcEvent::IceGatheringState {
                state,
                local_sdp: Some(sdp),
            }) if state == "complete" => {
                println!(
                    "{}",
                    serde_json::json!({ "type": if offerer { "offer" } else { "answer" }, "sdp": sdp })
                );
                if offerer {
                    let answer = tokio::task::spawn_blocking(read_line)
                        .await
                        .expect("answer");
                    peer.set_description(false, "answer", answer)
                        .await
                        .expect("remote answer");
                }
            }
            Item::Event(RtcEvent::ConnectionState { state }) => eprintln!("connection: {state}"),
            Item::Event(RtcEvent::ChannelOpen { channel }) => eprintln!("channel {channel} open"),
            Item::Message(channel, data) => {
                let mut reply = b"echo:".to_vec();
                reply.extend_from_slice(&data);
                peer.send(channel, Bytes::from(reply)).await.expect("echo");
            }
            _ => {}
        }
    }
}
