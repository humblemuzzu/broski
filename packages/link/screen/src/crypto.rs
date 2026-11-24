use aes::cipher::{BlockEncrypt, KeyInit};
use aes::Aes128;
use num_bigint::BigUint;
use zeroize::Zeroizing;

use crate::error::{Error, Result};

const MAX_DH_KEY_BYTES: usize = 512;
const ARD_CRED_FIELD_LEN: usize = 64;
const ARD_CRED_BLOCK_LEN: usize = ARD_CRED_FIELD_LEN * 2;

/// Encrypts a 16-byte VNC authentication challenge using RFC 6143 DES (bit-reversed key).
pub fn vnc_des_response(password: &str, challenge: &[u8; 16]) -> [u8; 16] {
    let mut raw_key = Zeroizing::new([0u8; 8]);
    let bytes = password.as_bytes();
    let take = bytes.len().min(8);
    for i in 0..take {
        raw_key[i] = bytes[i].reverse_bits();
    }
    let subkeys = Zeroizing::new(des_subkeys(&raw_key));
    let mut out = [0u8; 16];
    let b0 = des_encrypt_block(
        u64::from_be_bytes(challenge[0..8].try_into().unwrap()),
        &subkeys,
    );
    let b1 = des_encrypt_block(
        u64::from_be_bytes(challenge[8..16].try_into().unwrap()),
        &subkeys,
    );
    out[0..8].copy_from_slice(&b0.to_be_bytes());
    out[8..16].copy_from_slice(&b1.to_be_bytes());
    out
}

/// Completes Apple Remote Desktop Diffie-Hellman (security type 30) authentication.
///
/// Returns `[aes128_ecb_credentials (128 B) || client_public_key (key_len B)]`.
pub fn ard_dh_response(
    generator: u16,
    prime: &[u8],
    server_pub: &[u8],
    username: &str,
    password: &str,
) -> Result<Vec<u8>> {
    let key_len = prime.len();
    if key_len == 0 || key_len > MAX_DH_KEY_BYTES || server_pub.len() != key_len {
        return Err(Error::Protocol("invalid ARD DH key length".to_owned()));
    }
    let mut priv_bytes = Zeroizing::new(vec![0u8; key_len]);
    getrandom::fill(&mut priv_bytes).map_err(|_| Error::Randomness)?;
    ard_dh_with_private(
        generator,
        prime,
        server_pub,
        &priv_bytes,
        username,
        password,
    )
}

fn ard_dh_with_private(
    generator: u16,
    prime: &[u8],
    server_pub: &[u8],
    priv_bytes: &[u8],
    username: &str,
    password: &str,
) -> Result<Vec<u8>> {
    let key_len = prime.len();
    let p = BigUint::from_bytes_be(prime);
    if p <= BigUint::from(1u8) {
        return Err(Error::Protocol("invalid ARD DH prime".to_owned()));
    }
    let g = BigUint::from(generator);
    let a = BigUint::from_bytes_be(priv_bytes);
    let b_pub = BigUint::from_bytes_be(server_pub);

    let client_pub = pad_biguint(&g.modpow(&a, &p), key_len);
    let shared = Zeroizing::new(pad_biguint(&b_pub.modpow(&a, &p), key_len));
    let aes_key = Zeroizing::new(md5(&shared));

    let mut plain = Zeroizing::new([0u8; ARD_CRED_BLOCK_LEN]);
    fill_ard_field(&mut plain[0..ARD_CRED_FIELD_LEN], username)?;
    fill_ard_field(&mut plain[ARD_CRED_FIELD_LEN..ARD_CRED_BLOCK_LEN], password)?;

    let cipher = Aes128::new_from_slice(&*aes_key)
        .map_err(|_| Error::Protocol("invalid ARD AES key".to_owned()))?;
    let mut encrypted = [0u8; ARD_CRED_BLOCK_LEN];
    for chunk in 0..(ARD_CRED_BLOCK_LEN / 16) {
        let offset = chunk * 16;
        let mut block = aes::Block::clone_from_slice(&plain[offset..offset + 16]);
        cipher.encrypt_block(&mut block);
        encrypted[offset..offset + 16].copy_from_slice(&block);
    }

    let mut response = Vec::with_capacity(ARD_CRED_BLOCK_LEN + key_len);
    response.extend_from_slice(&encrypted);
    response.extend_from_slice(&client_pub);
    Ok(response)
}

fn fill_ard_field(dest: &mut [u8], text: &str) -> Result<()> {
    let bytes = text.as_bytes();
    let copy_len = bytes.len().min(ARD_CRED_FIELD_LEN - 1);
    dest[..copy_len].copy_from_slice(&bytes[..copy_len]);
    dest[copy_len] = 0;
    if copy_len + 1 < dest.len() {
        getrandom::fill(&mut dest[copy_len + 1..]).map_err(|_| Error::Randomness)?;
    }
    Ok(())
}

fn pad_biguint(value: &BigUint, len: usize) -> Vec<u8> {
    let raw = value.to_bytes_be();
    if raw.len() >= len {
        return raw[raw.len() - len..].to_vec();
    }
    let mut out = vec![0u8; len];
    out[len - raw.len()..].copy_from_slice(&raw);
    out
}

const MD5_S: [u32; 64] = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9,
    14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15,
    21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
];

const MD5_K: [u32; 64] = [
    0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee, 0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
    0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be, 0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
    0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa, 0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
    0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed, 0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
    0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c, 0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
    0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05, 0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
    0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039, 0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
    0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1, 0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
];

/// RFC 1321 MD5 used solely for Apple ARD (type 30) DH key derivation.
pub fn md5(input: &[u8]) -> [u8; 16] {
    let bit_len = (input.len() as u64).wrapping_mul(8);
    let mut padded = Vec::with_capacity(input.len() + 72);
    padded.extend_from_slice(input);
    padded.push(0x80);
    while padded.len() % 64 != 56 {
        padded.push(0);
    }
    padded.extend_from_slice(&bit_len.to_le_bytes());

    let mut state = [0x6745_2301u32, 0xefcd_ab89, 0x98ba_dcfe, 0x1032_5476];
    for chunk in padded.as_chunks::<64>().0 {
        md5_compress(&mut state, chunk);
    }

    let mut out = [0u8; 16];
    for (i, word) in state.iter().enumerate() {
        out[i * 4..i * 4 + 4].copy_from_slice(&word.to_le_bytes());
    }
    out
}

fn md5_compress(state: &mut [u32; 4], chunk: &[u8; 64]) {
    let mut m = [0u32; 16];
    for (i, word) in m.iter_mut().enumerate() {
        *word = u32::from_le_bytes(chunk[i * 4..i * 4 + 4].try_into().unwrap());
    }
    let (mut a, mut b, mut c, mut d) = (state[0], state[1], state[2], state[3]);
    for i in 0..64 {
        let (f, g) = match i {
            0..=15 => ((b & c) | ((!b) & d), i),
            16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
            32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
            _ => (c ^ (b | (!d)), (7 * i) % 16),
        };
        let next_a = d;
        d = c;
        c = b;
        let sum = a.wrapping_add(f).wrapping_add(MD5_K[i]).wrapping_add(m[g]);
        b = b.wrapping_add(sum.rotate_left(MD5_S[i]));
        a = next_a;
    }
    state[0] = state[0].wrapping_add(a);
    state[1] = state[1].wrapping_add(b);
    state[2] = state[2].wrapping_add(c);
    state[3] = state[3].wrapping_add(d);
}

// --- FIPS 46-3 DES (single-block ECB for RFC 6143 VNC auth) ---

const PC1: [u8; 56] = [
    57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18, 10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60,
    52, 44, 36, 63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22, 14, 6, 61, 53, 45, 37, 29,
    21, 13, 5, 28, 20, 12, 4,
];

const PC2: [u8; 48] = [
    14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10, 23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2, 41, 52,
    31, 37, 47, 55, 30, 40, 51, 45, 33, 48, 44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];

const KEY_SHIFTS: [u32; 16] = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];

const IP: [u8; 64] = [
    58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4, 62, 54, 46, 38, 30, 22, 14, 6,
    64, 56, 48, 40, 32, 24, 16, 8, 57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3, 61,
    53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];

const FP: [u8; 64] = [
    40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31, 38, 6, 46, 14, 54, 22, 62, 30,
    37, 5, 45, 13, 53, 21, 61, 29, 36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
    34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];

const E_TABLE: [u8; 48] = [
    32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17, 16, 17, 18,
    19, 20, 21, 20, 21, 22, 23, 24, 25, 24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];

const P_TABLE: [u8; 32] = [
    16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10, 2, 8, 24, 14, 32, 27, 3, 9, 19,
    13, 30, 6, 22, 11, 4, 25,
];

const SBOX: [[u8; 64]; 8] = [
    [
        14, 4, 13, 1, 2, 15, 11, 8, 3, 10, 6, 12, 5, 9, 0, 7, 0, 15, 7, 4, 14, 2, 13, 1, 10, 6, 12,
        11, 9, 5, 3, 8, 4, 1, 14, 8, 13, 6, 2, 11, 15, 12, 9, 7, 3, 10, 5, 0, 15, 12, 8, 2, 4, 9,
        1, 7, 5, 11, 3, 14, 10, 0, 6, 13,
    ],
    [
        15, 1, 8, 14, 6, 11, 3, 4, 9, 7, 2, 13, 12, 0, 5, 10, 3, 13, 4, 7, 15, 2, 8, 14, 12, 0, 1,
        10, 6, 9, 11, 5, 0, 14, 7, 11, 10, 4, 13, 1, 5, 8, 12, 6, 9, 3, 2, 15, 13, 8, 10, 1, 3, 15,
        4, 2, 11, 6, 7, 12, 0, 5, 14, 9,
    ],
    [
        10, 0, 9, 14, 6, 3, 15, 5, 1, 13, 12, 7, 11, 4, 2, 8, 13, 7, 0, 9, 3, 4, 6, 10, 2, 8, 5,
        14, 12, 11, 15, 1, 13, 6, 4, 9, 8, 15, 3, 0, 11, 1, 2, 12, 5, 10, 14, 7, 1, 10, 13, 0, 6,
        9, 8, 7, 4, 15, 14, 3, 11, 5, 2, 12,
    ],
    [
        7, 13, 14, 3, 0, 6, 9, 10, 1, 2, 8, 5, 11, 12, 4, 15, 13, 8, 11, 5, 6, 15, 0, 3, 4, 7, 2,
        12, 1, 10, 14, 9, 10, 6, 9, 0, 12, 11, 7, 13, 15, 1, 3, 14, 5, 2, 8, 4, 3, 15, 0, 6, 10, 1,
        13, 8, 9, 4, 5, 11, 12, 7, 2, 14,
    ],
    [
        2, 12, 4, 1, 7, 10, 11, 6, 8, 5, 3, 15, 13, 0, 14, 9, 14, 11, 2, 12, 4, 7, 13, 1, 5, 0, 15,
        10, 3, 9, 8, 6, 4, 2, 1, 11, 10, 13, 7, 8, 15, 9, 12, 5, 6, 3, 0, 14, 11, 8, 12, 7, 1, 14,
        2, 13, 6, 15, 0, 9, 10, 4, 5, 3,
    ],
    [
        12, 1, 10, 15, 9, 2, 6, 8, 0, 13, 3, 4, 14, 7, 5, 11, 10, 15, 4, 2, 7, 12, 9, 5, 6, 1, 13,
        14, 0, 11, 3, 8, 9, 14, 15, 5, 2, 8, 12, 3, 7, 0, 4, 10, 1, 13, 11, 6, 4, 3, 2, 12, 9, 5,
        15, 10, 11, 14, 1, 7, 6, 0, 8, 13,
    ],
    [
        4, 11, 2, 14, 15, 0, 8, 13, 3, 12, 9, 7, 5, 10, 6, 1, 13, 0, 11, 7, 4, 9, 1, 10, 14, 3, 5,
        12, 2, 15, 8, 6, 1, 4, 11, 13, 12, 3, 7, 14, 10, 15, 6, 8, 0, 5, 9, 2, 6, 11, 13, 8, 1, 4,
        10, 7, 9, 5, 0, 15, 14, 2, 3, 12,
    ],
    [
        13, 2, 8, 4, 6, 15, 11, 1, 10, 9, 3, 14, 5, 0, 12, 7, 1, 15, 13, 8, 10, 3, 7, 4, 12, 5, 6,
        11, 0, 14, 9, 2, 7, 11, 4, 1, 9, 12, 14, 2, 0, 6, 10, 13, 15, 3, 5, 8, 2, 1, 14, 7, 4, 10,
        8, 13, 15, 12, 9, 0, 3, 5, 6, 11,
    ],
];

fn permute(input: u64, in_bits: u32, table: &[u8]) -> u64 {
    let mut out = 0u64;
    for &pos in table {
        let bit = (input >> (in_bits - u32::from(pos))) & 1;
        out = (out << 1) | bit;
    }
    out
}

fn des_subkeys(key: &[u8; 8]) -> [u64; 16] {
    let k = u64::from_be_bytes(*key);
    let perm = permute(k, 64, &PC1);
    let mut c = ((perm >> 28) & 0x0fff_ffff) as u32;
    let mut d = (perm & 0x0fff_ffff) as u32;
    let mut subkeys = [0u64; 16];
    for (i, &shift) in KEY_SHIFTS.iter().enumerate() {
        c = ((c << shift) | (c >> (28 - shift))) & 0x0fff_ffff;
        d = ((d << shift) | (d >> (28 - shift))) & 0x0fff_ffff;
        let cd = (u64::from(c) << 28) | u64::from(d);
        subkeys[i] = permute(cd, 56, &PC2);
    }
    subkeys
}

fn des_feistel(r: u32, subkey: u64) -> u32 {
    let expanded = permute(u64::from(r), 32, &E_TABLE) ^ subkey;
    let mut s_out = 0u32;
    for (i, sbox) in SBOX.iter().enumerate() {
        let chunk = ((expanded >> (42 - i * 6)) & 0x3f) as usize;
        let row = ((chunk & 0x20) >> 4) | (chunk & 1);
        let col = (chunk >> 1) & 0x0f;
        s_out = (s_out << 4) | u32::from(sbox[row * 16 + col]);
    }
    permute(u64::from(s_out), 32, &P_TABLE) as u32
}

fn des_encrypt_block(block: u64, subkeys: &[u64; 16]) -> u64 {
    let ip = permute(block, 64, &IP);
    let mut l = (ip >> 32) as u32;
    let mut r = ip as u32;
    for &subkey in subkeys {
        let next_l = r;
        r = l ^ des_feistel(r, subkey);
        l = next_l;
    }
    let pre_fp = (u64::from(r) << 32) | u64::from(l);
    permute(pre_fp, 64, &FP)
}

#[cfg(test)]
mod tests {
    use aes::cipher::{BlockDecrypt, KeyInit};
    use aes::Aes128;

    use super::*;

    fn hex(bytes: &[u8]) -> String {
        bytes.iter().map(|b| format!("{b:02x}")).collect()
    }

    #[test]
    fn md5_rfc_1321_vectors() {
        assert_eq!(hex(&md5(b"")), "d41d8cd98f00b204e9800998ecf8427e");
        assert_eq!(hex(&md5(b"a")), "0cc175b9c0f1b6a831c399e269772661");
        assert_eq!(hex(&md5(b"abc")), "900150983cd24fb0d6963f7d28e17f72");
        assert_eq!(
            hex(&md5(b"message digest")),
            "f96b697d7cb7938d525a2f31aaf161d0"
        );
        assert_eq!(
            hex(&md5(b"abcdefghijklmnopqrstuvwxyz")),
            "c3fcd3d76192e4007dfb496cca67e13b"
        );
    }

    #[test]
    fn des_nist_standard_vector() {
        let key = [0x13, 0x34, 0x57, 0x79, 0x9b, 0xbc, 0xdf, 0xf1];
        let subkeys = des_subkeys(&key);
        let cipher = des_encrypt_block(0x0123_4567_89ab_cdef, &subkeys);
        assert_eq!(cipher, 0x85e8_1354_0f0a_b405);
    }

    #[test]
    fn vnc_des_uses_bit_reversed_password() {
        let challenge = [
            0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee,
            0xff, 0x00,
        ];
        let resp = vnc_des_response("secret", &challenge);
        assert_ne!(resp, challenge);
        assert_eq!(resp, vnc_des_response("secret", &challenge));
        assert_ne!(resp, vnc_des_response("other", &challenge));
    }

    #[test]
    fn ard_dh_roundtrip_decrypts_credentials() {
        let generator = 2u16;
        let prime = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xdf];
        let server_priv = [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x13];
        let p = BigUint::from_bytes_be(&prime);
        let g = BigUint::from(generator);
        let s_priv = BigUint::from_bytes_be(&server_priv);
        let server_pub = pad_biguint(&g.modpow(&s_priv, &p), prime.len());

        let resp = ard_dh_response(generator, &prime, &server_pub, "alice", "hunter2!").unwrap();
        assert_eq!(resp.len(), 128 + prime.len());

        let client_pub = BigUint::from_bytes_be(&resp[128..]);
        let shared = pad_biguint(&client_pub.modpow(&s_priv, &p), prime.len());
        let aes_key = md5(&shared);
        let cipher = Aes128::new_from_slice(&aes_key).unwrap();

        let mut plain = [0u8; 128];
        for i in 0..8 {
            let mut block = aes::Block::clone_from_slice(&resp[i * 16..i * 16 + 16]);
            cipher.decrypt_block(&mut block);
            plain[i * 16..i * 16 + 16].copy_from_slice(&block);
        }
        let user_end = plain[..64].iter().position(|&b| b == 0).unwrap();
        let pass_end = plain[64..].iter().position(|&b| b == 0).unwrap();
        assert_eq!(&plain[..user_end], b"alice");
        assert_eq!(&plain[64..64 + pass_end], b"hunter2!");
    }
}
