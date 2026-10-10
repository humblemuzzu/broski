import 'package:broski/models/transcript_page.dart';
import 'package:flutter/widgets.dart';

/// The message at the top of the viewport, captured before older messages are prepended.
class TranscriptScrollAnchor {
  const TranscriptScrollAnchor({
    required this.messageId,
    required this.topOffset,
  });

  final String messageId;

  /// Global y of the message's top edge when the page fetch started.
  final double topOffset;
}

/// Hands out one stable [GlobalKey] per message so the loaded window can be measured in place.
class TranscriptAnchorKeys {
  final Map<String, GlobalKey> _keys = <String, GlobalKey>{};

  GlobalKey keyFor(String messageId) =>
      _keys.putIfAbsent(messageId, () => GlobalKey());

  /// The key a message already has, without giving one to a message that was never laid out.
  GlobalKey? existingKey(String messageId) => _keys[messageId];
}

/// The first laid-out message that is at least partly on screen, or null when none of the window is
/// visible. Messages scrolled off the top are skipped: they would be dropped from the cache while
/// the page is being laid out.
TranscriptScrollAnchor? captureTranscriptAnchor({
  required List<String> messageIds,
  required TranscriptAnchorKeys keys,
}) {
  double? topOffset;
  String? messageId;
  for (final id in messageIds) {
    final box = _boxFor(keys.existingKey(id));
    if (box == null) continue;
    final top = box.localToGlobal(Offset.zero).dy;
    if (top + box.size.height <= 0) continue;
    if (topOffset == null || top < topOffset) {
      topOffset = top;
      messageId = id;
    }
  }
  if (messageId == null || topOffset == null) return null;
  return TranscriptScrollAnchor(messageId: messageId, topOffset: topOffset);
}

/// Holds the window still after older messages were prepended, re-checking as laid-out heights
/// settle.
///
/// The first frame only shifts by the height the page added, because a full page pushes the anchor
/// far below the build window and it cannot be measured yet. Once it is back on screen, later
/// frames correct what the estimate cannot see: heights above the anchor that are not final yet
/// (images, tool cards) and messages appended at the bottom while the page was in flight. Bounded
/// so a layout that keeps moving cannot spin here forever.
Future<void> restoreTranscriptScroll({
  required ScrollController controller,
  required TranscriptAnchorKeys keys,
  required TranscriptScrollAnchor? anchor,
  required double offsetBefore,
  required double extentBefore,
  int maxFrames = 5,
}) async {
  var coarseDone = false;
  for (var frame = 0; frame < maxFrames; frame++) {
    await WidgetsBinding.instance.endOfFrame;
    if (!controller.hasClients) return;
    if (!coarseDone) {
      controller.jumpTo(
        preservedScrollOffset(
          currentOffset: offsetBefore,
          maxExtentBefore: extentBefore,
          maxExtentAfter: controller.position.maxScrollExtent,
        ),
      );
      coarseDone = true;
      continue;
    }
    if (anchor == null) return;
    final box = _boxFor(keys.existingKey(anchor.messageId));
    if (box == null) {
      // The estimate overshot by whatever arrived in the same frame, which leaves the anchor above
      // the build window; step back and look again.
      controller.jumpTo(
        (controller.position.pixels - controller.position.viewportDimension)
            .clamp(
              controller.position.minScrollExtent,
              controller.position.maxScrollExtent,
            ),
      );
      continue;
    }
    final drift = box.localToGlobal(Offset.zero).dy - anchor.topOffset;
    if (drift == 0) continue;
    controller.jumpTo(
      (controller.position.pixels + drift).clamp(
        controller.position.minScrollExtent,
        controller.position.maxScrollExtent,
      ),
    );
  }
}

RenderBox? _boxFor(GlobalKey? key) {
  final object = key?.currentContext?.findRenderObject();
  if (object is! RenderBox || !object.hasSize || object.size.height <= 0) {
    return null;
  }
  return object;
}
