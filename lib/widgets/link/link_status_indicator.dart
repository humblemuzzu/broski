import 'package:broski/providers/connection/bridge_status_provider.dart';
import 'package:broski/providers/connection/link_control_provider.dart';
import 'package:broski/providers/link/lan_search_provider.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/services/link/link_endpoint.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/bridge_restart_button.dart';
import 'package:broski/widgets/link/link_status_presentation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The selected machine's link state, and nothing while the app is not on a
/// link machine.
///
/// The machine's bridge process wins over the link while it is not up: a
/// connected link to a bridge that is starting cannot answer anything.
/// [showMachine] is off where the machine is already named next to the chip.
class LinkStatusIndicator extends ConsumerWidget {
  const LinkStatusIndicator({super.key, this.showMachine = true});

  final bool showMachine;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final status = ref.watch(linkStatusProvider);
    final bridge = ref.watch(bridgeLinkStatusProvider);
    final machineName = ref.watch(
      machinesProvider.select(
        (state) => machineWithId(state.machines, state.selectedId ?? '')?.name,
      ),
    );
    if (status == null || machineName == null) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final view = presentLinkStatus(
      status: status,
      machineName: machineName,
      now: DateTime.now(),
      bridge: bridge,
      lanSearch: ref.watch(lanSearchProvider),
    );
    final color = view.tone.color(theme);
    final chip = _chip(theme, view, color);
    if (!canRestartBridge(status, bridge)) return chip;
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        chip,
        BridgeRestartButton(
          send: ref.watch(linkControlSendProvider),
          detail: bridge?.detail,
          color: color,
        ),
      ],
    );
  }

  Widget _chip(OpenCodeTheme theme, LinkStatusView view, Color color) {
    return Container(
      padding: Insets.chip,
      decoration: BoxDecoration(
        color: color.withValues(alpha: 0.1),
        borderRadius: Radii.brMd,
        border: Border.all(color: color.withValues(alpha: 0.3)),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(view.icon, size: 14, color: color),
          const SizedBox(width: Spacing.xs),
          Flexible(
            child: Text(
              showMachine ? view.label : view.state,
              overflow: TextOverflow.ellipsis,
              style: AppTypography.labelSmall(color: theme.textMuted),
            ),
          ),
        ],
      ),
    );
  }
}
