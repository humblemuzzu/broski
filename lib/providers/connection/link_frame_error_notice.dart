import 'package:broski/app/app_messenger.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Tells the user when the app refused a frame it could not decode, so a screen
/// that stops updating is explained instead of guessed at.
final linkFrameErrorNoticeProvider = Provider<void>((ref) {
  final socket = ref.watch(webSocketServiceProvider);
  final subscription = socket.frameErrors.listen(showAppNotice);
  ref.onDispose(subscription.cancel);
});
