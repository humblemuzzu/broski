import 'package:broski/contract/generated/contract.dart';

/// The old protocol shares the socket, and two of its frame types (`abort`,
/// `error`) are also contract message types, so every contract message travels
/// inside one frame type (core README §4).
const contractFrameType = 'contract';

/// How every frame the bridge core sends begins, to the character
/// (`CONTRACT_FRAME_PREFIX` in the core; `frame_prefix.json` holds the two
/// together). It tells a contract frame from the old protocol's before the
/// JSON is read, so a large one can be read off the UI thread.
const contractFramePrefix = '{"type":"$contractFrameType","message":';

Map<String, Object?> contractFrame(ClientMessage message) => {
  'type': contractFrameType,
  'message': message.toJson(),
};

/// One contract frame from the bridge socket, as the contract client reads it.
sealed class InboundFrame {
  const InboundFrame();
}

final class ContractInbound extends InboundFrame {
  const ContractInbound(this.message);

  final ServerMessage message;
}

/// A contract frame that does not decode: the bridge broke the contract, or
/// sent something newer than this app said it speaks.
final class UnreadableContract extends InboundFrame {
  const UnreadableContract({
    required this.problem,
    this.requestId,
    this.session,
  });

  /// The request the frame answers, when it names one this app can read.
  final String? requestId;

  /// The session an unreadable event belongs to, when this app can tell.
  final SessionRef? session;
  final String problem;
}

/// [frame] as the contract client reads it, or null when it is not a contract
/// frame: it belongs to the old protocol, which the old services handle.
InboundFrame? readFrame(Map<String, Object?> frame) {
  if (frame['type'] != contractFrameType) return null;
  final message = frame['message'];
  if (frame.length != 2 || message is! Map<String, Object?>) {
    return const UnreadableContract(
      problem: 'a contract frame is {"type":"contract","message":{…}}',
    );
  }
  try {
    return ContractInbound(ServerMessage.fromJson(message));
  } on FormatException catch (error) {
    final requestId = message['requestId'];
    return UnreadableContract(
      requestId: requestId is String ? requestId : null,
      session: _eventSession(message),
      problem: error.message,
    );
  }
}

/// The session of the event `message` carries, when it is one that names a
/// readable session.
SessionRef? _eventSession(Map<String, Object?> message) => switch (message) {
  {'type': 'event', 'envelope': {'session': final Map<String, Object?> ref}} =>
    _sessionRef(ref),
  _ => null,
};

SessionRef? _sessionRef(Map<String, Object?> json) {
  try {
    return SessionRef.fromJson(json);
  } on FormatException {
    return null;
  }
}

/// The request [message] answers; null for pushed messages and for an error
/// about a request the bridge could not read.
String? answeredRequestId(ServerMessage message) => switch (message) {
  EventMessage() || CatalogMessage() => null,
  ErrorResponse(:final requestId) => requestId,
  HelloResponse(:final requestId) ||
  BackendsListResponse(:final requestId) ||
  BackendStatusResponse(:final requestId) ||
  ModelsListResponse(:final requestId) ||
  CommandsListResponse(:final requestId) ||
  ModesListResponse(:final requestId) ||
  SessionsListResponse(:final requestId) ||
  SessionGetResponse(:final requestId) ||
  SessionCreateResponse(:final requestId) ||
  SessionForkResponse(:final requestId) ||
  SessionRenameResponse(:final requestId) ||
  SessionDeleteResponse(:final requestId) ||
  SessionArchiveResponse(:final requestId) ||
  SessionAttachResponse(:final requestId) ||
  SessionDetachResponse(:final requestId) ||
  TranscriptReadResponse(:final requestId) ||
  AttachmentReadResponse(:final requestId) ||
  PromptResponse(:final requestId) ||
  AbortResponse(:final requestId) ||
  InteractionAnswerResponse(:final requestId) ||
  QueueCancelResponse(:final requestId) ||
  ModelSetResponse(:final requestId) ||
  ThinkingSetResponse(:final requestId) ||
  ModeSetResponse(:final requestId) ||
  CompactResponse(:final requestId) ||
  CompactionCancelResponse(:final requestId) ||
  RetryCancelResponse(:final requestId) ||
  BackendCallResponse(:final requestId) => requestId,
};
