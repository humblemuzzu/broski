import 'package:broski/contract/generated/contract.dart';

/// A prompt this phone sent, shown before the session echoes it as a
/// `user_message` with the same `clientRequestId` (contract §10).
final class OutgoingPrompt {
  const OutgoingPrompt({required this.input, required this.delivery});

  final PromptInput input;
  final PromptDelivery delivery;

  ClientRequestId get clientRequestId => input.clientRequestId;

  /// Not sent, or not confirmed: the person may send it again, edit it or
  /// drop it.
  bool get waitsForPerson => switch (delivery) {
    PromptNotSent() || PromptUnconfirmed() => true,
    PromptSending() || PromptTaken() => false,
  };

  OutgoingPrompt delivered(PromptDelivery next) =>
      OutgoingPrompt(input: input, delivery: next);
}

sealed class PromptDelivery {
  const PromptDelivery();
}

final class PromptSending extends PromptDelivery {
  const PromptSending();
}

/// The bridge took it; the run, the steer or the queue item follows.
final class PromptTaken extends PromptDelivery {
  const PromptTaken(this.accepted);

  final PromptAccepted accepted;
}

/// Whether the bridge took it is unknown. Sending it again with the same
/// `clientRequestId` is safe: the bridge de-duplicates accepted prompts. When
/// [resending], the phone does that itself, once attached again or after a
/// wait; otherwise it waits for the person, who may also edit or discard it.
final class PromptUnconfirmed extends PromptDelivery {
  const PromptUnconfirmed(this.reason, {required this.resending});

  final String reason;
  final bool resending;
}

/// Not sent: the backend refused it, or it can never be carried. The person
/// retries, edits or discards it.
final class PromptNotSent extends PromptDelivery {
  const PromptNotSent(this.reason);

  final String reason;
}
