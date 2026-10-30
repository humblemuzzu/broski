import 'package:broski/providers/app_info_provider.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The app's version at the foot of Settings.
class AppVersionLine extends ConsumerWidget {
  const AppVersionLine({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final version = ref.watch(appVersionProvider);
    final theme = Theme.of(context);
    return Center(
      child: Padding(
        padding: Insets.bottomSm,
        child: Text(
          'Broski v$version',
          style: TextStyle(
            color: theme.colorScheme.onSurface.withValues(alpha: 0.25),
            fontSize: 12,
            fontWeight: FontWeight.w500,
          ),
        ),
      ),
    );
  }
}
