import 'package:flutter/material.dart';

/// Constrains content to a max width on tablets/iPads so layouts designed
/// for phone screens don't stretch edge-to-edge on large displays.
///
/// On phones (< 600pt), this is a no-op pass-through.
/// On tablets, it centers the content with a max width of [maxWidth].
///
/// Usage:
/// ```dart
/// body: TabletContentWrapper(child: existingBody)
/// ```
class TabletContentWrapper extends StatelessWidget {
  const TabletContentWrapper({
    super.key,
    required this.child,
    this.maxWidth = 600,
  });

  final Widget child;

  /// Maximum content width on tablets. Defaults to 600 (iPhone-like width).
  final double maxWidth;

  @override
  Widget build(BuildContext context) {
    final screenWidth = MediaQuery.of(context).size.width;

    // On phone-sized screens, just pass through — no overhead.
    if (screenWidth <= maxWidth) return child;

    return Center(
      child: ConstrainedBox(
        constraints: BoxConstraints(maxWidth: maxWidth),
        child: child,
      ),
    );
  }
}
