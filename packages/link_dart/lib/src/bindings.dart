import 'dart:ffi';

const String _assetId = 'package:broski_link/src/bindings.dart';

/// Length of a SHA-256 digest, in bytes.
const int sha256DigestLength = 32;

/// Length of a device identity secret, in bytes.
const int identitySecretLength = 3617;

/// Length of a public bundle, in bytes.
const int publicBundleLength = 1217;

/// A Rust-owned byte buffer; hand it back to [blBufFree] unchanged.
final class BlBuf extends Struct {
  external Pointer<Uint8> ptr;

  @Size()
  external int len;

  @Size()
  external int cap;
}

final class BlClient extends Opaque {}

@Native<Uint32 Function()>(symbol: 'bl_abi_version', assetId: _assetId)
external int blAbiVersion();

@Native<Int32 Function(Pointer<Uint8>, Size, Pointer<Uint8>)>(
  symbol: 'bl_sha256',
  assetId: _assetId,
)
external int blSha256(Pointer<Uint8> data, int length, Pointer<Uint8> out);

@Native<Void Function(BlBuf)>(symbol: 'bl_buf_free', assetId: _assetId)
external void blBufFree(BlBuf buf);

@Native<Int32 Function(Pointer<BlBuf>)>(
  symbol: 'bl_last_error',
  assetId: _assetId,
)
external int blLastError(Pointer<BlBuf> out);

@Native<Int32 Function(Pointer<BlBuf>, Pointer<BlBuf>)>(
  symbol: 'bl_identity_generate',
  assetId: _assetId,
)
external int blIdentityGenerate(
  Pointer<BlBuf> outSecret,
  Pointer<BlBuf> outPublic,
);

@Native<Int32 Function(Pointer<Uint8>, Size, Pointer<BlBuf>)>(
  symbol: 'bl_identity_public',
  assetId: _assetId,
)
external int blIdentityPublic(
  Pointer<Uint8> secret,
  int secretLength,
  Pointer<BlBuf> outPublic,
);

@Native<Int32 Function(Pointer<Uint8>, Size, Pointer<BlBuf>)>(
  symbol: 'bl_bundle_id',
  assetId: _assetId,
)
external int blBundleId(
  Pointer<Uint8> bundle,
  int bundleLength,
  Pointer<BlBuf> outId,
);

@Native<Int32 Function(Pointer<Uint8>, Size, Pointer<Uint8>)>(
  symbol: 'bl_bundle_fingerprint',
  assetId: _assetId,
)
external int blBundleFingerprint(
  Pointer<Uint8> bundle,
  int bundleLength,
  Pointer<Uint8> out32,
);

@Native<Int32 Function(Pointer<Uint8>, Size, Pointer<BlBuf>)>(
  symbol: 'bl_pairing_parse',
  assetId: _assetId,
)
external int blPairingParse(
  Pointer<Uint8> uri,
  int uriLength,
  Pointer<BlBuf> outJson,
);

@Native<Pointer<BlClient> Function(Pointer<Uint8>, Size, Pointer<Uint8>, Size)>(
  symbol: 'bl_client_new',
  assetId: _assetId,
)
external Pointer<BlClient> blClientNew(
  Pointer<Uint8> secret,
  int secretLength,
  Pointer<Uint8> bundle,
  int bundleLength,
);

@Native<Void Function(Pointer<BlClient>)>(
  symbol: 'bl_client_free',
  assetId: _assetId,
)
external void blClientFree(Pointer<BlClient> client);

@Native<
  Int32 Function(Pointer<BlClient>, Pointer<Uint8>, Uint64, Pointer<BlBuf>)
>(symbol: 'bl_client_connect', assetId: _assetId)
external int blClientConnect(
  Pointer<BlClient> client,
  Pointer<Uint8> pairingSecret32,
  int nowMs,
  Pointer<BlBuf> outMsg1,
);

@Native<Int32 Function(Pointer<BlClient>, Pointer<Uint8>, Size, Uint64)>(
  symbol: 'bl_client_handle',
  assetId: _assetId,
)
external int blClientHandle(
  Pointer<BlClient> client,
  Pointer<Uint8> data,
  int length,
  int nowMs,
);

@Native<
  Int32 Function(Pointer<BlClient>, Uint32, Pointer<Uint8>, Size, Uint64)
>(symbol: 'bl_client_send', assetId: _assetId)
external int blClientSend(
  Pointer<BlClient> client,
  int stream,
  Pointer<Uint8> data,
  int length,
  int nowMs,
);

@Native<Int32 Function(Pointer<BlClient>, Pointer<BlBuf>)>(
  symbol: 'bl_client_poll_transmit',
  assetId: _assetId,
)
external int blClientPollTransmit(Pointer<BlClient> client, Pointer<BlBuf> out);

@Native<
  Int32 Function(
    Pointer<BlClient>,
    Pointer<Uint32>,
    Pointer<Uint32>,
    Pointer<Uint32>,
    Pointer<BlBuf>,
  )
>(symbol: 'bl_client_poll_event', assetId: _assetId)
external int blClientPollEvent(
  Pointer<BlClient> client,
  Pointer<Uint32> kind,
  Pointer<Uint32> stream,
  Pointer<Uint32> code,
  Pointer<BlBuf> outBytes,
);

@Native<Int64 Function(Pointer<BlClient>)>(
  symbol: 'bl_client_poll_timeout',
  assetId: _assetId,
)
external int blClientPollTimeout(Pointer<BlClient> client);

@Native<Void Function(Pointer<BlClient>, Uint64)>(
  symbol: 'bl_client_handle_timeout',
  assetId: _assetId,
)
external void blClientHandleTimeout(Pointer<BlClient> client, int nowMs);

@Native<Void Function(Pointer<BlClient>)>(
  symbol: 'bl_client_disconnect',
  assetId: _assetId,
)
external void blClientDisconnect(Pointer<BlClient> client);
