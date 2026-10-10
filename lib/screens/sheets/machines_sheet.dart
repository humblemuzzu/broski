import 'package:broski/providers/connection_provider.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:broski/screens/device_manager_screen.dart';
import 'package:broski/screens/scan_screen.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/widgets/chat/detail_sheet.dart';
import 'package:broski/widgets/link/machine_list_item.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Opens the machines this phone is paired with.
Future<void> showMachinesSheet(BuildContext context) => DetailSheet.show<void>(
  context: context,
  title: 'Machines',
  initialSize: 0.6,
  child: const MachinesSheet(),
);

class MachinesSheet extends ConsumerWidget {
  const MachinesSheet({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final theme = OpenCodeTheme.of(context);
    final state = ref.watch(machinesProvider);
    return Padding(
      padding: Insets.screenH,
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          if (state.machines.isEmpty)
            Text(
              'No machines paired yet.',
              style: AppTypography.bodySmall(color: theme.textMuted),
            )
          else
            for (final machine in state.machines)
              MachineListItem(
                machine: machine,
                selected: machine.id == state.selectedId,
              ),
          const SizedBox(height: Spacing.lg),
          if (ref.watch(connectionProvider.select((c) => c.isConnected))) ...[
            OutlinedButton.icon(
              onPressed: () => Navigator.of(context).push(
                MaterialPageRoute(builder: (_) => const DeviceManagerScreen()),
              ),
              icon: const Icon(AppIcons.devices, size: 18),
              label: const Text('Devices on this machine'),
            ),
            const SizedBox(height: Spacing.sm),
          ],
          OutlinedButton.icon(
            onPressed: () => Navigator.of(
              context,
            ).push(MaterialPageRoute(builder: (_) => const ScanScreen())),
            icon: const Icon(AppIcons.add, size: 18),
            label: const Text('Add machine'),
          ),
        ],
      ),
    );
  }
}
