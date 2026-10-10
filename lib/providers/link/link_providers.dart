import 'package:broski/providers/service_providers.dart';
import 'package:broski/services/link/device_identity_store.dart';
import 'package:broski/services/link/machine_store.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final deviceIdentityStoreProvider = Provider<DeviceIdentityStore>(
  (ref) => DeviceIdentityStore(),
);

final machineStoreProvider = Provider<MachineStore>(
  (ref) => MachineStore(ref.watch(storageServiceProvider)),
);
