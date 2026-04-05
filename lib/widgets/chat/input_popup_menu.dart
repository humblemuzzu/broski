import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// Shows a themed popup menu anchored near [tapPosition].
///
/// Used for thinking level, permission mode, and other inline chip pickers.
/// All options come from the caller — nothing is hardcoded.
Future<String?> showChipPopup({
  required BuildContext context,
  required Offset tapPosition,
  required List<String> values,
  required String? currentValue,
  required String Function(String) formatLabel,
  Color? accentColor,
}) {
  final theme = OpenCodeTheme.of(context);
  final accent = accentColor ?? theme.primary;
  final screenSize = MediaQuery.of(context).size;
  // Position above the tap point, clamped to screen
  final menuHeight = values.length * 44.0 + 16;
  final top = (tapPosition.dy - menuHeight - 8).clamp(
    MediaQuery.of(context).padding.top + 8,
    screenSize.height - menuHeight - 8,
  );

  return showMenu<String>(
    context: context,
    position: RelativeRect.fromLTRB(
      (tapPosition.dx - 60).clamp(12.0, screenSize.width - 180),
      top,
      (screenSize.width - tapPosition.dx - 100).clamp(12.0, screenSize.width),
      screenSize.height - top - menuHeight,
    ),
    color: theme.backgroundMenu,
    shape: RoundedRectangleBorder(
      borderRadius: Radii.brMd,
      side: BorderSide(color: theme.borderSubtle, width: 0.5),
    ),
    elevation: 8,
    items: values.map((v) {
      final isSelected = v == currentValue;
      return PopupMenuItem<String>(
        value: v,
        height: 44,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 20,
              child: isSelected
                  ? Icon(AppIcons.check, size: 15, color: accent)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              formatLabel(v),
              style: TextStyle(
                color: isSelected ? accent : theme.text,
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      );
    }).toList(),
  );
}

/// Shows a thinking/effort popup with optional "Speed" section for fast mode.
///
/// When [showFastToggle] is true, a "Speed" section with Fast/Normal appears
/// above the thinking levels. Fast mode is a separate concept from effort.
/// CC: per-model `supportsFastMode` from SDK. CX: `ServiceTier.fast/flex`.
Future<void> showThinkingPopup({
  required BuildContext context,
  required Offset tapPosition,
  required List<String> thinkingValues,
  required String? currentThinking,
  required String Function(String) formatLabel,
  required void Function(String) onThinkingChanged,
  // Fast mode (CC/CX only, per-model)
  bool showFastToggle = false,
  bool fastEnabled = false,
  void Function(bool)? onFastChanged,
  Color? accentColor,
}) async {
  final theme = OpenCodeTheme.of(context);
  final accent = accentColor ?? theme.primary;
  final screenSize = MediaQuery.of(context).size;

  // Build menu items
  final items = <PopupMenuEntry<String>>[];

  // Speed section (only if model supports fast mode)
  if (showFastToggle) {
    // Section header
    items.add(
      PopupMenuItem<String>(
        enabled: false,
        height: 28,
        child: Text(
          'Speed',
          style: TextStyle(
            color: theme.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
      ),
    );
    // Fast option
    items.add(
      PopupMenuItem<String>(
        value: '_fast_on',
        height: 40,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 20,
              child: fastEnabled
                  ? Icon(AppIcons.check, size: 15, color: accent)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              'Fast',
              style: TextStyle(
                color: fastEnabled ? accent : theme.text,
                fontSize: 14,
                fontWeight: fastEnabled ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
    // Normal option
    items.add(
      PopupMenuItem<String>(
        value: '_fast_off',
        height: 40,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 20,
              child: !fastEnabled
                  ? Icon(AppIcons.check, size: 15, color: accent)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              'Normal',
              style: TextStyle(
                color: !fastEnabled ? accent : theme.text,
                fontSize: 14,
                fontWeight: !fastEnabled ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
    // Divider between Speed and Thinking sections
    items.add(const PopupMenuDivider(height: 8));
  }

  // Thinking section header (only show label if we also have Speed section)
  if (showFastToggle) {
    items.add(
      PopupMenuItem<String>(
        enabled: false,
        height: 28,
        child: Text(
          'Reasoning',
          style: TextStyle(
            color: theme.textMuted,
            fontSize: 11,
            fontWeight: FontWeight.w600,
            letterSpacing: 0.5,
          ),
        ),
      ),
    );
  }

  // Thinking level items
  for (final v in thinkingValues) {
    final isSelected = v == currentThinking;
    items.add(
      PopupMenuItem<String>(
        value: v,
        height: 44,
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            SizedBox(
              width: 20,
              child: isSelected
                  ? Icon(AppIcons.check, size: 15, color: accent)
                  : null,
            ),
            const SizedBox(width: 8),
            Text(
              formatLabel(v),
              style: TextStyle(
                color: isSelected ? accent : theme.text,
                fontSize: 14,
                fontWeight: isSelected ? FontWeight.w600 : FontWeight.w400,
              ),
            ),
          ],
        ),
      ),
    );
  }

  // Calculate menu height
  final totalItems = items.length;
  final menuHeight = totalItems * 40.0 + 24;
  final top = (tapPosition.dy - menuHeight - 8).clamp(
    MediaQuery.of(context).padding.top + 8,
    screenSize.height - menuHeight - 8,
  );

  final result = await showMenu<String>(
    context: context,
    position: RelativeRect.fromLTRB(
      (tapPosition.dx - 60).clamp(12.0, screenSize.width - 180),
      top,
      (screenSize.width - tapPosition.dx - 100).clamp(12.0, screenSize.width),
      screenSize.height - top - menuHeight,
    ),
    color: theme.backgroundMenu,
    shape: RoundedRectangleBorder(
      borderRadius: Radii.brMd,
      side: BorderSide(color: theme.borderSubtle, width: 0.5),
    ),
    elevation: 8,
    items: items,
  );

  if (result == null) return;
  if (result == '_fast_on') {
    onFastChanged?.call(true);
  } else if (result == '_fast_off') {
    onFastChanged?.call(false);
  } else {
    onThinkingChanged(result);
  }
}
