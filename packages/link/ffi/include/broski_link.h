#ifndef BROSKI_LINK_H
#define BROSKI_LINK_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/*
 * Rust owns every BlBuf: free it once with bl_buf_free, passing the struct
 * returned here; never free() the pointer, never read it afterwards. An empty
 * result has ptr = NULL and len = 0, which bl_buf_free accepts. Input pointers
 * are borrowed for the call only: this library copies what it keeps and never
 * frees caller memory; NULL is valid only with len == 0. BlClient is opaque,
 * owns one link and a copy of the secret, is not thread-safe, and is freed with
 * bl_client_free exactly once. 0 ok, -1 invalid argument, -2 protocol/crypto
 * (see bl_last_error), -3 backpressure (retry after an ack), -99 internal
 * panic; 1 means a value was produced, 0 that there was nothing to report.
 */

typedef struct BlBuf {
  uint8_t *ptr;
  size_t len;
  size_t cap;
} BlBuf;

typedef struct BlClient BlClient;

uint32_t bl_abi_version(void);

int32_t bl_sha256(const uint8_t *data, size_t len, uint8_t *out32);

void bl_buf_free(BlBuf buf);

/* 1 and the message of the last failing call on this thread, 0 when none. */
int32_t bl_last_error(BlBuf *out);

int32_t bl_identity_generate(BlBuf *out_secret, BlBuf *out_public);

int32_t bl_identity_public(const uint8_t *secret, size_t len, BlBuf *out_public);

int32_t bl_bundle_id(const uint8_t *pub, size_t len, BlBuf *out_id);

int32_t bl_bundle_fingerprint(const uint8_t *pub, size_t len, uint8_t *out32);

int32_t bl_pairing_parse(const uint8_t *uri, size_t len, BlBuf *out_json);

BlClient *bl_client_new(const uint8_t *secret, size_t secret_len,
                        const uint8_t *server_pub, size_t pub_len);

void bl_client_free(BlClient *c);

/* Pair mode when pairing_secret32 is the QR's single-use 32-byte secret,
 * Connect mode when it is NULL. */
int32_t bl_client_connect(BlClient *c, const uint8_t *pairing_secret32_or_null,
                          uint64_t now_ms, BlBuf *out_msg1);

/* One whole WebSocket message: msg2 first, then one sealed frame per message. */
int32_t bl_client_handle(BlClient *c, const uint8_t *data, size_t len,
                         uint64_t now_ms);

int32_t bl_client_send(BlClient *c, uint32_t stream, const uint8_t *data,
                       size_t len, uint64_t now_ms);

int32_t bl_client_poll_transmit(BlClient *c, BlBuf *out);

/* 1 when an event was written, 0 when none is pending.
 *   kind 1 Connected:  code = resumed (0 new session: resync, 1 resumed)
 *   kind 2 Message:    stream, and *out_bytes holds the payload
 *   kind 3 PeerClosed: code;   kind 4 Dead: the connection is gone */
int32_t bl_client_poll_event(BlClient *c, uint32_t *kind, uint32_t *stream,
                             uint32_t *code, BlBuf *out_bytes);

int64_t bl_client_poll_timeout(BlClient *c);

void bl_client_handle_timeout(BlClient *c, uint64_t now_ms);

/* The network connection is gone; the session survives for the next connect. */
void bl_client_disconnect(BlClient *c);

#ifdef __cplusplus
}
#endif

#endif /* BROSKI_LINK_H */
