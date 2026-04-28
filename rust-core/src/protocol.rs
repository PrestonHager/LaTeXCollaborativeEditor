use crate::crdt::TextOp;

pub fn encode_op(op: &TextOp) -> String {
    serde_json::to_string(op).unwrap_or_default()
}

pub fn decode_op(raw: &str) -> Option<TextOp> {
    serde_json::from_str(raw).ok()
}
