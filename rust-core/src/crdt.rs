use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct TextOp {
    pub seq: u64,
    pub index: usize,
    pub delete: usize,
    pub insert: String,
}

#[derive(Default)]
pub struct CrdtDoc {
    text: String,
    last_seq: u64,
    log: Vec<TextOp>,
}

impl CrdtDoc {
    pub fn apply_local_insert(&mut self, index: usize, text: &str) -> TextOp {
        self.last_seq += 1;
        let op = TextOp { seq: self.last_seq, index, delete: 0, insert: text.to_string() };
        self.apply_op(&op);
        self.log.push(op.clone());
        op
    }

    pub fn apply_local_delete(&mut self, index: usize, delete: usize) -> TextOp {
        self.last_seq += 1;
        let op = TextOp { seq: self.last_seq, index, delete, insert: String::new() };
        self.apply_op(&op);
        self.log.push(op.clone());
        op
    }

    pub fn apply_remote_op(&mut self, op: TextOp) {
        if op.seq <= self.last_seq {
            return;
        }
        self.last_seq = op.seq;
        self.apply_op(&op);
        self.log.push(op);
    }

    pub fn export_ops_since(&self, seq: u64) -> Vec<TextOp> {
        self.log.iter().filter(|op| op.seq > seq).cloned().collect()
    }

    pub fn get_text_snapshot(&self) -> String {
        self.text.clone()
    }

    fn apply_op(&mut self, op: &TextOp) {
        let index = op.index.min(self.text.len());
        let delete_end = (index + op.delete).min(self.text.len());
        self.text.replace_range(index..delete_end, &op.insert);
    }
}
