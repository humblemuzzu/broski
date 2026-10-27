import 'package:broski/models/device.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/screens/device_manager/device_list.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/error_utils.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

class DeviceManagerScreen extends ConsumerStatefulWidget {
  const DeviceManagerScreen({super.key});
  @override
  ConsumerState<DeviceManagerScreen> createState() =>
      _DeviceManagerScreenState();
}

class _DeviceManagerScreenState extends ConsumerState<DeviceManagerScreen> {
  List<DeviceInfo>? _devices;
  bool _loading = true;
  String? _error;
  @override
  void initState() {
    super.initState();
    _loadDevices();
  }

  Future<void> _loadDevices() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final devices = await ref.read(connectionProvider.notifier).listDevices();
      if (mounted) {
        setState(() {
          _devices = devices;
          _loading = false;
        });
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _error = humanizeError(e);
          _loading = false;
        });
      }
    }
  }

  Future<void> _disconnectDevice(DeviceInfo device) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Disconnect Device'),
        content: Text('Disconnect ${device.deviceName}?'),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(ctx, false),
            child: const Text('Cancel'),
          ),
          TextButton(
            onPressed: () => Navigator.pop(ctx, true),
            style: TextButton.styleFrom(
              foregroundColor: Theme.of(ctx).extension<OpenCodeTheme>()!.error,
            ),
            child: const Text('Disconnect'),
          ),
        ],
      ),
    );
    if (confirmed == true) {
      ref.read(connectionProvider.notifier).disconnectDevice(device.deviceId);
      await Future.delayed(const Duration(milliseconds: 300));
      _loadDevices();
    }
  }

  @override
  Widget build(BuildContext context) {
    final connection = ref.watch(connectionProvider);
    final theme = Theme.of(context);
    final ocTheme = OpenCodeTheme.of(context);
    final thisDeviceId = connection.thisDevice?.deviceId;
    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        title: const Text('Devices'),
        backgroundColor: Colors.transparent,
        actions: [
          IconButton(
            icon: const Icon(AppIcons.refresh),
            onPressed: _loadDevices,
          ),
        ],
      ),
      body: AdaptiveContainer(
        width: ContentWidth.standard,
        child: _buildBody(theme, ocTheme, thisDeviceId),
      ),
    );
  }

  Widget _buildBody(
    ThemeData theme,
    OpenCodeTheme ocTheme,
    String? thisDeviceId,
  ) {
    if (_loading) return const DeviceListPlaceholder.loading();
    final failure = _error;
    if (failure != null) {
      return DeviceListPlaceholder.failed(
        failure: failure,
        onRetry: _loadDevices,
      );
    }
    final devices = _devices;
    if (devices == null || devices.isEmpty) {
      return const DeviceListPlaceholder.empty();
    }
    return DeviceListView(
      devices: devices,
      thisDeviceId: thisDeviceId,
      onRefresh: _loadDevices,
      onDisconnect: _disconnectDevice,
    );
  }
}
