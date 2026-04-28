mod crdt;
mod protocol;

use crdt::{CrdtDoc, TextOp};
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct WasmCrdt {
    inner: CrdtDoc,
}

#[wasm_bindgen]
impl WasmCrdt {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self { inner: CrdtDoc::default() }
    }

    pub fn apply_local_insert(&mut self, index: usize, text: String) -> String {
        let op = self.inner.apply_local_insert(index, &text);
        protocol::encode_op(&op)
    }

    pub fn apply_local_delete(&mut self, index: usize, delete: usize) -> String {
        let op = self.inner.apply_local_delete(index, delete);
        protocol::encode_op(&op)
    }

    pub fn apply_remote_op(&mut self, encoded_op: String) {
        if let Some(op) = protocol::decode_op(&encoded_op) {
            self.inner.apply_remote_op(op);
        }
    }

    pub fn export_ops_since(&self, seq: u64) -> String {
        let ops: Vec<TextOp> = self.inner.export_ops_since(seq);
        serde_json::to_string(&ops).unwrap_or_else(|_| "[]".to_string())
    }

    pub fn get_text_snapshot(&self) -> String {
        self.inner.get_text_snapshot()
    }
}

#[cfg(test)]
mod tests {
    use super::WasmCrdt;
    use crate::protocol;

    #[test]
    fn local_and_remote_round_trip() {
        let mut a = WasmCrdt::new();
        let mut b = WasmCrdt::new();
        let op = a.apply_local_insert(0, "hello".into());
        b.apply_remote_op(op);
        assert_eq!(a.get_text_snapshot(), b.get_text_snapshot());
    }

    #[test]
    fn delete_and_export_ops_since_work() {
        let mut doc = WasmCrdt::new();
        let _ = doc.apply_local_insert(0, "hello world".into());
        let _ = doc.apply_local_delete(5, 6);
        assert_eq!(doc.get_text_snapshot(), "hello");

        let ops = doc.export_ops_since(1);
        assert!(ops.contains("\"seq\":2"));
    }

    #[test]
    fn protocol_decode_rejects_invalid_json() {
        assert!(protocol::decode_op("not-json").is_none());
    }
}
