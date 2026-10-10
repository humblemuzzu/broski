import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/screens/sheets/machines_sheet.dart';
import 'package:broski/services/link/link_endpoint.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/link_status_indicator.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// The Connection section's link row: the machine in use with its live state,
/// and the way into the machines sheet.
///
/// Carries the section's screen insets, and draws nothing while no machine is
/// paired, so a legacy QR connection keeps that section to itself.
class MachinesConnectionCard extends ConsumerWidget {
  const MachinesConnectionCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final machines = ref.watch(machinesProvider).machines;
    if (machines.isEmpty) return const SizedBox.shrink();

    final theme = OpenCodeTheme.of(context);
    final selectedName = ref.watch(
      machinesProvider.select(
        (state) => machineWithId(state.machines, state.selectedId ?? '')?.name,
      ),
    );
    return Padding(
      padding: Insets.screenH,
      child: InkWell(
        onTap: () => showMachinesSheet(context),
        borderRadius: Radii.brLg,
        child: Container(
          padding: Insets.card,
          decoration: BoxDecoration(
            color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.5),
            borderRadius: Radii.brLg,
            border: Border.all(color: theme.borderSubtle),
          ),
          child: Row(
            children: [
              Icon(AppIcons.laptop, color: theme.primary, size: 22),
              const SizedBox(width: Spacing.md),
              Expanded(child: _MachineRow(name: selectedName)),
              Icon(AppIcons.chevronRight, size: 20, color: theme.textMuted),
            ],
          ),
        ),
      ),
    );
  }
}

class _MachineRow extends StatelessWidget {
  const _MachineRow({required this.name});

  final String? name;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          name ?? 'Machines',
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: theme.text,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: Spacing.xs),
        if (name == null)
          Text(
            'No machine selected',
            style: AppTypography.labelSmall(color: theme.textMuted),
          )
        else
          const LinkStatusIndicator(showMachine: false),
      ],
    );
  }
}
