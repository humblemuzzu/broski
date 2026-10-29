import 'package:broski/contract/generated/contract.dart';

/// The old protocol shares the socket, and two of its frame types (`abort`,
/// `error`) are also contract message types, so every contract message travels
/// inside one frame type (core README §4).
const contractFrameType = 'contract';

Map<String, Object?> contractFrame(ClientMessage message) => {
  'type': contractFrameType,
  'message': message.toJson(),
};

/// One frame from the bridge socket, as the contract client reads it.
sealed class InboundFrame {
  const InboundFrame();
}

/// A frame of the old protocol, which the old services handle.
final class OldProtocolFrame extends InboundFrame {
  const OldProtocolFrame();
}

final class ContractInbound extends InboundFrame {
  const ContractInbound(this.message);

  final ServerMessage message;
}

/// A contract frame that does not decode: the bridge broke the contract, or
/// sent something newer than this app said it speaks.
final class UnreadableContract extends InboundFrame {
  const UnreadableContract({required this.requestId, required this.problem});

  /// The request the frame answers, when it names one this app can read.
  final String? requestId;
  final String problem;
}

InboundFrame readFrame(Map<String, Object?> frame) {
  if (frame['type'] != contractFrameType) return const OldProtocolFrame();
  final message = frame['message'];
  if (frame.length != 2 || message is! Map<String, Object?>) {
    return const UnreadableContract(
      requestId: null,
      problem: 'a contract frame is {"type":"contract","message":{…}}',
    );
  }
  try {
    return ContractInbound(ServerMessage.fromJson(message));
  } on FormatException catch (error) {
    final requestId = message['requestId'];
    return UnreadableContract(
      requestId: requestId is String ? requestId : null,
      problem: error.message,
    );
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
  BackendCallResponse(:final requestId) => requestId,
};
