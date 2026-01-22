import 'package:flutter/material.dart';

import '../../theme/opencode_theme.dart';

/// A reusable detail sheet for displaying tool/card details.
/// Opens at 50% height, draggable to 90%.
///
/// Usage:
/// ```dart
/// DetailSheet.show(
///   context: context,
///   title: 'Read',
///   child: ReadDetailContent(file: file, content: content),
/// );
/// ```
class DetailSheet extends StatelessWidget {
  final String title;
  final Widget child;
  final Widget? trailing;

  const DetailSheet({
    super.key,
    required this.title,
    required this.child,
    this.trailing,
  });

  /// Static method to show the sheet as a modal bottom sheet
  static Future<T?> show<T>({
    required BuildContext context,
    required String title,
    required Widget child,
    Widget? trailing,
    double initialSize = 0.5,
    double maxSize = 0.9,
    double minSize = 0.25,
  }) {
    return showModalBottomSheet<T>(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) => DraggableScrollableSheet(
        initialChildSize: initialSize,
        maxChildSize: maxSize,
        minChildSize: minSize,
        expand: false,
        builder: (context, scrollController) {
          return DetailSheet(
            title: title,
            trailing: trailing,
            child: SingleChildScrollView(
              controller: scrollController,
              child: child,
            ),
          );
        },
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Container(
      decoration: BoxDecoration(
        color: theme.backgroundPanel,
        borderRadius: const BorderRadius.vertical(top: Radius.circular(20)),
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          // Drag handle
          Padding(
            padding: const EdgeInsets.only(top: 12, bottom: 8),
            child: Container(
              width: 40,
              height: 4,
              decoration: BoxDecoration(
                color: theme.textMuted.withValues(alpha: 0.3),
                borderRadius: BorderRadius.circular(2),
              ),
            ),
          ),

          // Header row
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            child: Row(
              children: [
                // Close button
                IconButton(
                  onPressed: () => Navigator.of(context).pop(),
                  icon: Icon(Icons.close, color: theme.textMuted, size: 24),
                  padding: EdgeInsets.zero,
                  constraints: const BoxConstraints(),
                ),

                // Title (centered)
                Expanded(
                  child: Text(
                    title,
                    textAlign: TextAlign.center,
                    style: TextStyle(
                      color: theme.text,
                      fontSize: 16,
                      fontWeight: FontWeight.w600,
                    ),
                  ),
                ),

                // Trailing widget or spacer
                if (trailing != null)
                  trailing!
                else
                  const SizedBox(width: 24), // Balance the close button
              ],
            ),
          ),

          // Divider
          Divider(height: 1, color: theme.borderSubtle),

          // Content
          Flexible(child: child),
        ],
      ),
    );
  }
}

/// A section within DetailSheet with label and content box.
/// Used to organize content into labeled sections.
class DetailSection extends StatelessWidget {
  final String label;
  final Widget child;
  final EdgeInsets? padding;

  const DetailSection({
    super.key,
    required this.label,
    required this.child,
    this.padding,
  });

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    return Padding(
      padding: padding ?? const EdgeInsets.all(16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Section label
          Padding(
            padding: const EdgeInsets.only(bottom: 8),
            child: Text(
              label.toUpperCase(),
              style: TextStyle(
                color: theme.textMuted,
                fontSize: 11,
                fontWeight: FontWeight.w600,
                letterSpacing: 0.5,
              ),
            ),
          ),

          // Content box
          Container(
            width: double.infinity,
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: theme.backgroundElement,
              borderRadius: BorderRadius.circular(8),
              border: Border.all(
                color: theme.borderSubtle.withValues(alpha: 0.5),
                width: 1,
              ),
            ),
            child: child,
          ),
        ],
      ),
    );
  }
}
