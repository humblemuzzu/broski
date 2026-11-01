import 'package:broski/models/link/machine.dart';
import 'package:broski/providers/connection/link_connection_controller.dart';
import 'package:broski/providers/link/machines_provider.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Moves the app onto [Machine]: it becomes the chosen one and the single link
/// goes to it.
final machineSwitchProvider = Provider<Future<void> Function(Machine)>(
  (ref) => (machine) async {
    await ref.read(machinesProvider.notifier).select(machine.id);
    await ref.read(linkConnectionControllerProvider).switchTo(machine);
  },
);
