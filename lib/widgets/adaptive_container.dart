import 'package:flutter/material.dart';

import '../utils/responsive.dart';

/// Centers and constrains content to a max width on iPad.
///
/// **On iPhone, this is a zero-overhead pass-through** — returns [child]
/// directly with no wrapper widgets, no layout changes, no pixel differences.
///
/// On iPad, wraps [child] in `Center` + `ConstrainedBox` so content doesn't
/// stretch edge-to-edge on wide screens.
///
/// Usage:
/// ```dart
/// body: AdaptiveContainer(
///   width: ContentWidth.standard,
///   child: existingContent,
/// )
/// ```
class AdaptiveContainer extends StatelessWidget {
  const AdaptiveContainer({
    super.key,
    required this.child,
    this.width = ContentWidth.standard,
  });

  /// The content to display.
  final Widget child;

  /// Which width preset to use on iPad.
  /// Ignored on iPhone (always pass-through).
  final ContentWidth width;

  @override
  Widget build(BuildContext context) {
    // ── iPhone: direct pass-through — zero overhead ──
    if (!Responsive.isTablet(context)) return child;

    final maxW = Responsive.maxWidth(context, width);
    if (maxW == double.infinity) return child;

    // ── iPad: center content at the preset max width ──
    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxW),
        child: child,
      ),
    );
  }
}
