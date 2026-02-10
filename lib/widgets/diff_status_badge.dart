import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';

/// A tiny badge showing file change status: A (added), M (modified), D (deleted).
///
/// Used in:
/// - `diff_viewer.dart` (header row next to file name)
/// - Session summary diff lists
///
/// Returns [SizedBox.shrink] when [status] is null or empty.
class DiffStatusBadge extends StatelessWidget {
  const DiffStatusBadge({super.key, required this.status});

  final String? status;

  @override
  Widget build(BuildContext context) {
    if (status == null || status!.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final color = _statusColor(theme, status!);
    final label = _statusLabel(status!);

    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 5, vertical: 1),
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.18),
        borderRadius: Radii.brXs,
        border: Border.all(color: color.withValues(alpha: 0.35), width: 1),
      ),
      child: Text(
        label,
        style: GoogleFonts.jetBrainsMono(
          fontSize: 9,
          fontWeight: FontWeight.w700,
          color: color,
        ),
      ),
    );
  }

  /// Full-word label variant for larger contexts.
  static String statusLabel(String status) {
    switch (status) {
      case 'added':
        return 'Added';
      case 'deleted':
        return 'Deleted';
      case 'modified':
        return 'Modified';
      default:
        return status;
    }
  }

  static String _statusLabel(String status) {
    switch (status) {
      case 'added':
        return 'A';
      case 'deleted':
        return 'D';
      case 'modified':
        return 'M';
      default:
        return status[0].toUpperCase();
    }
  }

  static Color _statusColor(OpenCodeTheme theme, String status) {
    switch (status) {
      case 'added':
        return theme.diffAdded;
      case 'deleted':
        return theme.diffRemoved;
      case 'modified':
        return theme.info;
      default:
        return theme.textMuted;
    }
  }
}
