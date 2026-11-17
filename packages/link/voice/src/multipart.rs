//! A `multipart/form-data` body: text fields in order, then one file.

pub(crate) struct Part<'a> {
    pub name: &'a str,
    pub value: Value<'a>,
}

pub(crate) enum Value<'a> {
    Text(&'a str),
    File {
        file_name: &'a str,
        mime_type: &'a str,
        bytes: &'a [u8],
    },
}

/// The body and its `Content-Type` header value.
pub(crate) fn encode(parts: &[Part<'_>]) -> (String, Vec<u8>) {
    let boundary = boundary(parts);
    let mut body = Vec::with_capacity(parts.iter().map(|part| part.len() + 160).sum());
    for part in parts {
        body.extend_from_slice(format!("--{boundary}\r\n").as_bytes());
        match &part.value {
            Value::Text(text) => {
                let header = format!(
                    "Content-Disposition: form-data; name=\"{}\"\r\n\r\n",
                    part.name
                );
                body.extend_from_slice(header.as_bytes());
                body.extend_from_slice(text.as_bytes());
            }
            Value::File {
                file_name,
                mime_type,
                bytes,
            } => {
                let header = format!(
                    "Content-Disposition: form-data; name=\"{}\"; filename=\"{}\"\r\nContent-Type: {mime_type}\r\n\r\n",
                    part.name,
                    file_name.replace(['"', '\r', '\n'], "")
                );
                body.extend_from_slice(header.as_bytes());
                body.extend_from_slice(bytes);
            }
        }
        body.extend_from_slice(b"\r\n");
    }
    body.extend_from_slice(format!("--{boundary}--\r\n").as_bytes());
    (format!("multipart/form-data; boundary={boundary}"), body)
}

impl Part<'_> {
    fn content(&self) -> &[u8] {
        match &self.value {
            Value::Text(text) => text.as_bytes(),
            Value::File { bytes, .. } => bytes,
        }
    }

    fn len(&self) -> usize {
        self.content().len()
    }
}

/// A random boundary, checked against every part's content; should the system's randomness fail,
/// numbered ones until one is absent.
fn boundary(parts: &[Part<'_>]) -> String {
    let absent = |candidate: &str| {
        !parts
            .iter()
            .any(|part| contains(part.content(), candidate.as_bytes()))
    };
    let mut random = [0u8; 16];
    if getrandom::fill(&mut random).is_ok() {
        let candidate = format!(
            "broski-{}",
            random
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>()
        );
        if absent(&candidate) {
            return candidate;
        }
    }
    (0u64..)
        .map(|n| format!("broski-boundary-{n}"))
        .find(|candidate| absent(candidate))
        .expect("an absent boundary among unboundedly many")
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    haystack
        .windows(needle.len())
        .any(|window| window == needle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fields_come_in_order_and_the_file_last() {
        let parts = [
            Part {
                name: "model",
                value: Value::Text("m"),
            },
            Part {
                name: "keyterm",
                value: Value::Text("useEffect"),
            },
            Part {
                name: "file",
                value: Value::File {
                    file_name: "a\"b.m4a",
                    mime_type: "audio/mp4",
                    bytes: b"\x00\x01audio",
                },
            },
        ];
        let (content_type, body) = encode(&parts);
        let boundary = content_type
            .strip_prefix("multipart/form-data; boundary=")
            .unwrap();
        let expected = format!(
            "--{boundary}\r\nContent-Disposition: form-data; name=\"model\"\r\n\r\nm\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"keyterm\"\r\n\r\nuseEffect\r\n\
             --{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"ab.m4a\"\r\nContent-Type: audio/mp4\r\n\r\n\x00\x01audio\r\n\
             --{boundary}--\r\n"
        );
        assert_eq!(body, expected.as_bytes());
    }

    #[test]
    fn the_boundary_never_occurs_in_the_content() {
        let file = b"--broski-boundary-0 and more".to_vec();
        let parts = [Part {
            name: "file",
            value: Value::Text(std::str::from_utf8(&file).unwrap()),
        }];
        let (content_type, _) = encode(&parts);
        assert!(!contains(
            &file,
            content_type.rsplit('=').next().unwrap().as_bytes()
        ));
    }
}
