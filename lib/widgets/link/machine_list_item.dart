import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/link/link_status_provider.dart';
import 'package:broski/providers/link/machine_switch_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/link/link_status_indicator.dart';
import 'package:broski/widgets/link/link_status_presentation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// One paired machine: what it is, whether it is the one in use, and the way to
/// switch to it or drop it.
class MachineListItem extends ConsumerWidget {
  const MachineListItem({
    super.key,
    required this.machine,
    required this.selected,
  });

  final Machine machine;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    return Container(
      margin: const EdgeInsets.only(bottom: Spacing.sm),
      decoration: BoxDecoration(
        color: selected
            ? theme.primary.withValues(alpha: 0.08)
            : theme.backgroundElement,
        borderRadius: Radii.brLg,
        border: Border.all(
          color: selected
              ? theme.primary.withValues(alpha: 0.3)
              : theme.borderSubtle,
        ),
      ),
      child: InkWell(
        onTap: selected ? null : () => _switch(ref),
        borderRadius: Radii.brLg,
        child: Padding(
          padding: Insets.cardSm,
          child: Row(
            children: [
              Icon(
                selected ? AppIcons.radioChecked : AppIcons.computer,
                size: 18,
                color: selected ? theme.primary : theme.textMuted,
              ),
              const SizedBox(width: Spacing.md),
              Expanded(
                child: _MachineSummary(machine: machine, selected: selected),
              ),
              _MachineMenu(onForget: () => _forget(context, ref)),
            ],
          ),
        ),
      ),
    );
  }

  Future<void> _switch(WidgetRef ref) =>
      ref.read(machineSwitchProvider)(machine);

  Future<void> _forget(BuildContext context, WidgetRef ref) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (dialogContext) => AlertDialog(
        title: const Text('Forget this machine?'),
        content: Text(
          '${machine.name} is removed from this phone. The machine keeps this '
          'phone in its list until you revoke it there with '
          'broski-link revoke.',
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(dialogContext, true),
            style: TextButton.styleFrom(
              foregroundColor: OpenCodeTheme.of(dialogContext).error,
            ),
            child: const Text('Forget'),
          ),
        ],
      ),
    );
    if (confirmed != true) return;
    await ref.read(machinesProvider.notifier).remove(machine.id);
  }
}

class _MachineSummary extends StatelessWidget {
  const _MachineSummary({required this.machine, required this.selected});

  final Machine machine;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    final os = machine.os;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Text(
          machine.name,
          overflow: TextOverflow.ellipsis,
          style: TextStyle(
            color: theme.text,
            fontSize: 15,
            fontWeight: FontWeight.w600,
          ),
        ),
        const SizedBox(height: Spacing.xs),
        Row(
          children: [
            if (machine.lan.isNotEmpty)
              Icon(AppIcons.wifi, size: 13, color: theme.textMuted),
            if (machine.lan.isNotEmpty && machine.relay != null)
              const SizedBox(width: Spacing.xs),
            if (machine.relay != null)
              Icon(AppIcons.globe, size: 13, color: theme.textMuted),
            if (os != null && os.isNotEmpty) ...[
              const SizedBox(width: Spacing.sm),
              Flexible(
                child: Text(
                  os,
                  overflow: TextOverflow.ellipsis,
                  style: AppTypography.labelSmall(color: theme.textMuted),
                ),
              ),
            ],
          ],
        ),
        const SizedBox(height: Spacing.sm),
        _MachineState(machine: machine, selected: selected),
      ],
    );
  }
}

/// The machine in use reports its live state; every other machine reports when
/// it was last reached.
class _MachineState extends ConsumerWidget {
  const _MachineState({required this.machine, required this.selected});

  final Machine machine;
  final bool selected;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final hasStatus = ref.watch(
      linkStatusProvider.select((status) => status != null),
    );
    if (selected && hasStatus) {
      return const LinkStatusIndicator(showMachine: false);
    }
    final at = machine.lastConnectedAt;
    return Text(
      at == null
          ? 'Not connected yet'
          : 'Last connected ${formatLinkTime(at, DateTime.now())}',
      style: AppTypography.labelSmall(
        color: OpenCodeTheme.of(context).textMuted,
      ),
    );
  }
}

class _MachineMenu extends StatelessWidget {
  const _MachineMenu({required this.onForget});

  final VoidCallback onForget;

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);
    return PopupMenuButton<String>(
      icon: Icon(AppIcons.moreVertical, size: 18, color: theme.textMuted),
      padding: EdgeInsets.zero,
      onSelected: (_) => onForget(),
      itemBuilder: (_) => const [
        PopupMenuItem(value: 'forget', child: Text('Forget this machine')),
      ],
    );
  }
}
