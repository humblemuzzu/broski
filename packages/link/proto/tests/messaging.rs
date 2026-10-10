mod common;

use broski_link_proto::{FLAG_DEFLATE, HEADER_LEN};
use common::{
    compressible, decode_frame, deliver, messages, messages_with_stream, random_bytes, take, Pipe,
    Rng, T0,
};

#[test]
fn every_size_arrives_intact_and_in_order() {
    let mut pipe = Pipe::new(T0);
    let sizes = [0, 1, HEADER_LEN, 64_978, 65_000, 5 * 1024 * 1024];
    let mut expected = Vec::new();
    for (index, size) in sizes.iter().enumerate() {
        let stream = index as u32 % 3 + 1;
        let message = random_bytes(&mut Rng::new(11 + index as u64), *size);
        pipe.a.send(stream, &message, T0).expect("send");
        expected.push((stream, message));
        pipe.pump(T0);
        assert!(take(&mut pipe.a).is_empty(), "pump drains the transmitter");
    }
    assert_eq!(messages_with_stream(&mut pipe.b), expected);
}

#[test]
fn streams_share_one_seq_space_without_interleaving() {
    let mut pipe = Pipe::new(T0);
    let mut expected = Vec::new();
    let mut rng = Rng::new(31);
    for index in 0..30 {
        let stream = index as u32 % 3 + 1;
        let len = rng.below(4_000) as usize;
        let message = random_bytes(&mut rng, len);
        pipe.a.send(stream, &message, T0).expect("send");
        expected.push((stream, message));
    }
    pipe.pump(T0);
    assert_eq!(messages_with_stream(&mut pipe.b), expected);
}

#[test]
fn compressible_messages_are_compressed_on_the_wire() {
    let mut pipe = Pipe::new(T0);
    let message = compressible(64 * 1024);
    pipe.a.send(1, &message, T0).expect("send");
    let frames = take(&mut pipe.a);
    let wire: usize = frames.iter().map(Vec::len).sum();
    assert!(
        wire < message.len() / 4,
        "deflate should shrink it, got {wire} bytes"
    );
    for frame in &frames {
        let flags = decode_frame(frame).flags;
        assert!(flags & FLAG_DEFLATE != 0);
    }
    deliver(&mut pipe.b, &frames, T0);
    assert_eq!(messages(&mut pipe.b), vec![message]);
}

#[test]
fn incompressible_messages_travel_uncompressed() {
    let mut pipe = Pipe::new(T0);
    let message = random_bytes(&mut Rng::new(5), 64_000);
    pipe.a.send(1, &message, T0).expect("send");
    let frames = take(&mut pipe.a);
    assert_eq!(decode_frame(&frames[0]).flags, 0);
    let wire: usize = frames.iter().map(Vec::len).sum();
    assert_eq!(wire, message.len() + HEADER_LEN);
    deliver(&mut pipe.b, &frames, T0);
    assert_eq!(messages(&mut pipe.b), vec![message]);
}

#[test]
fn messages_below_the_compress_threshold_are_sent_raw() {
    let mut pipe = Pipe::new(T0);
    let message = vec![0u8; 1_023];
    pipe.a.send(1, &message, T0).expect("send");
    let frames = take(&mut pipe.a);
    assert_eq!(decode_frame(&frames[0]).flags, 0);
    assert_eq!(frames[0].len(), message.len() + HEADER_LEN);
    deliver(&mut pipe.b, &frames, T0);
    assert_eq!(messages(&mut pipe.b), vec![message]);

    let at_threshold = vec![0u8; 1_024];
    pipe.a.send(1, &at_threshold, T0).expect("send");
    let frames = take(&mut pipe.a);
    assert_eq!(decode_frame(&frames[0]).flags, FLAG_DEFLATE);
    deliver(&mut pipe.b, &frames, T0);
    assert_eq!(messages(&mut pipe.b), vec![at_threshold]);
}

#[test]
fn reassembled_message_keeps_the_stream_of_its_first_fragment() {
    let mut pipe = Pipe::new(T0);
    let message = random_bytes(&mut Rng::new(77), 200_000);
    pipe.a.send(2, &message, T0).expect("send");
    pipe.pump(T0);
    assert_eq!(messages_with_stream(&mut pipe.b), vec![(2, message)]);
}
