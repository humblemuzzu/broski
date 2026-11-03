import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// How far a transfer is, as a thin bar in the accent colour. A null [value]
/// says the size is not known yet.
class TransferProgressBar extends StatelessWidget {
  const TransferProgressBar({super.key, this.value});

  final double? value;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return ClipRRect(
      borderRadius: Radii.brFull,
      child: LinearProgressIndicator(
        value: value,
        minHeight: 3,
        backgroundColor: theme.borderSubtle.withValues(alpha: 0.3),
        valueColor: AlwaysStoppedAnimation(theme.primary),
      ),
    );
  }
}
