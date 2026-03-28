import 'package:broski/providers/session_archive_filter_provider.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// A filter chip that toggles showing archived sessions.
/// Extracted as a standalone widget per modular architecture rules.
class ArchiveFilterChip extends ConsumerWidget {
  const ArchiveFilterChip({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final showArchived = ref.watch(showArchivedSessionsProvider);
    final oc = OpenCodeTheme.of(context);

    return FilterChip(
      label: Text(
        'Archived',
        style: TextStyle(
          color: showArchived ? oc.background : oc.textMuted,
          fontSize: 12,
        ),
      ),
      selected: showArchived,
      selectedColor: oc.primary,
      backgroundColor: oc.backgroundPanel,
      side: BorderSide(color: showArchived ? oc.primary : oc.borderSubtle),
      onSelected: (value) {
        ref.read(showArchivedSessionsProvider.notifier).state = value;
      },
      visualDensity: VisualDensity.compact,
      materialTapTargetSize: MaterialTapTargetSize.shrinkWrap,
      shape: RoundedRectangleBorder(borderRadius: Radii.brSm),
    );
  }
}
