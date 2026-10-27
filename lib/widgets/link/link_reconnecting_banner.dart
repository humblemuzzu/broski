import 'package:broski/providers/link/lan_search_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/link_endpoint.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/link_status_presentation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The banner shown while the app is trying to reach the machine, in the link's
/// own words, so a phone looking for a Mac that moved says so.
class LinkReconnectingBanner extends ConsumerWidget {
  const LinkReconnectingBanner({super.key, required this.onCancel});

  final VoidCallback onCancel;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    return SafeArea(
      bottom: false,
      child: Container(
        margin: const EdgeInsets.fromLTRB(16, 4, 16, 0),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
        decoration: BoxDecoration(
          color: theme.primary.withValues(alpha: 0.12),
          borderRadius: Radii.brLg,
          border: Border.all(color: theme.primary.withValues(alpha: 0.25)),
        ),
        child: Row(
          children: [
            SizedBox(
              width: 14,
              height: 14,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                color: theme.primary,
              ),
            ),
            const SizedBox(width: 10),
            Expanded(child: Text(_detail(ref), style: _style(theme.text))),
            GestureDetector(
              onTap: onCancel,
              child: Text('Cancel', style: _style(theme.textMuted)),
            ),
          ],
        ),
      ),
    );
  }

  String _detail(WidgetRef ref) {
    final status = ref.watch(linkStatusProvider);
    final machines = ref.watch(machinesProvider);
    final name = machineWithId(
      machines.machines,
      machines.selectedId ?? '',
    )?.name;
    if (status == null || name == null) return 'Reconnecting…';
    return presentLinkStatus(
      status: status,
      machineName: name,
      now: DateTime.now(),
      lanSearch: ref.watch(lanSearchProvider),
    ).state;
  }

  TextStyle _style(Color color) =>
      TextStyle(color: color, fontSize: 12, fontWeight: FontWeight.w500);
}
