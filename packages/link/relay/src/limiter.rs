use std::collections::HashMap;
use std::hash::Hash;
use std::sync::Mutex;
use std::time::{Duration, Instant};

use crate::limits::RateLimit;

const RETENTION: Duration = Duration::from_secs(600);
const CEILING: usize = 4096;

pub struct Limiter<K> {
    limit: RateLimit,
    buckets: Mutex<HashMap<K, Bucket>>,
}

struct Bucket {
    tokens: f64,
    at: Instant,
}

impl<K: Eq + Hash + Clone> Limiter<K> {
    pub fn new(limit: RateLimit) -> Limiter<K> {
        Limiter {
            limit,
            buckets: Mutex::new(HashMap::new()),
        }
    }

    pub fn allow(&self, key: K) -> bool {
        let now = Instant::now();
        let mut buckets = self.buckets.lock().unwrap_or_else(|e| e.into_inner());
        if buckets.len() >= CEILING {
            buckets.retain(|_, bucket| now.saturating_duration_since(bucket.at) < RETENTION);
        }
        let bucket = buckets.entry(key).or_insert(Bucket {
            tokens: self.limit.burst,
            at: now,
        });
        bucket.tokens = (bucket.tokens
            + now.saturating_duration_since(bucket.at).as_secs_f64() * self.limit.per_second)
            .min(self.limit.burst);
        bucket.at = now;
        if bucket.tokens < 1.0 {
            return false;
        }
        bucket.tokens -= 1.0;
        true
    }
}
