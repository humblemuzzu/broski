mod common;

use broski_link_proto::{Config, Frame, Hello, Kind, Session, Welcome};
use common::{random_bytes, take, Rng, T0};

#[test]
fn random_and_hostile_frames_never_panic() {
    let mut rng = Rng::new(0x5EED);
    let mut session = Session::new([1; 16], Config::default());
    session.attach(0, T0).expect("attach");
    let mut now = T0;

    for _ in 0..5_000 {
        let len = rng.below(300) as usize;
        let bytes = random_bytes(&mut rng, len);
        let _ = Frame::decode(&bytes, 65_000);
        let _ = Hello::decode(&bytes);
        let _ = Welcome::decode(&bytes);
        let _ = session.handle_frame(&bytes, now);
        now += rng.below(4);
        if rng.below(16) == 0 {
            session.handle_timeout(now);
        }
        take(&mut session);
    }

    for _ in 0..2_000 {
        let mut bytes = vec![rng.below(7) as u8, rng.below(256) as u8];
        bytes.extend_from_slice(&(rng.below(3) as u32).to_be_bytes());
        bytes.extend_from_slice(&rng.below(4).to_be_bytes());
        bytes.extend_from_slice(&rng.next_u64().to_be_bytes());
        let len = rng.below(64) as usize;
        let payload = random_bytes(&mut rng, len);
        bytes.extend_from_slice(&payload);
        let _ = session.handle_frame(&bytes, now);
        now += 1;
        take(&mut session);
    }

    let ack = Frame::control(Kind::Ack, u64::MAX, &[]).encode();
    session
        .handle_frame(&ack, now)
        .expect("bogus ack is clamped");
    session
        .send(1, b"still usable", now)
        .expect("send survives");
}
