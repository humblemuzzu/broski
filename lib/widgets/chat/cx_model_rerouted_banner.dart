import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';
import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';

/// Inline banner shown when Codex reroutes the model (e.g., capacity fallback).
class CxModelReroutedBanner extends StatelessWidget {
  const CxModelReroutedBanner({
    super.key,
    required this.fromModel,
    required this.toModel,
    this.reason,
  });

  final String fromModel;
  final String toModel;
  final String? reason;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
      decoration: BoxDecoration(
        color: theme.warning.withValues(alpha: 0.1),
        borderRadius: Radii.brSm,
        border: Border.all(color: theme.warning.withValues(alpha: 0.3)),
      ),
      child: Row(
        children: [
          Icon(Icons.swap_horiz, size: 16, color: theme.warning),
          const SizedBox(width: 8),
          Expanded(
            child: Text.rich(
              TextSpan(
                children: [
                  const TextSpan(text: 'Model rerouted: '),
                  TextSpan(
                    text: fromModel,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  const TextSpan(text: ' → '),
                  TextSpan(
                    text: toModel,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                  if (reason != null && reason!.isNotEmpty)
                    TextSpan(text: ' ($reason)'),
                ],
                style: AppTypography.bodySmall(color: theme.text),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
