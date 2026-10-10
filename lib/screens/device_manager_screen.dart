import 'package:broski/models/device.dart';
import 'package:broski/providers/connection_provider.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
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
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.error, size: 48, color: ocTheme.error),
            const SizedBox(height: Spacing.lg),
            Text(
              'Failed to load devices',
              style: TextStyle(color: ocTheme.text),
            ),
            const SizedBox(height: Spacing.sm),
            Text(
              _error!,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            const SizedBox(height: Spacing.lg),
            ElevatedButton(onPressed: _loadDevices, child: const Text('Retry')),
          ],
        ),
      );
    }
    if (_devices == null || _devices!.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(AppIcons.devices, size: 48, color: ocTheme.textMuted),
            const SizedBox(height: Spacing.lg),
            Text(
              'No devices connected',
              style: TextStyle(color: ocTheme.textMuted),
            ),
          ],
        ),
      );
    }
    final sortedDevices = List<DeviceInfo>.from(_devices!);
    sortedDevices.sort((a, b) {
      if (a.deviceId == thisDeviceId) return -1;
      if (b.deviceId == thisDeviceId) return 1;
      return a.connectedAt.compareTo(b.connectedAt);
    });
    return RefreshIndicator(
      onRefresh: _loadDevices,
      child: ListView.builder(
        padding: Insets.card,
        itemCount: sortedDevices.length,
        itemBuilder: (context, index) {
          final device = sortedDevices[index];
          final isThisDevice = device.deviceId == thisDeviceId;
          return _DeviceCard(
            device: device,
            isThisDevice: isThisDevice,
            onDisconnect: isThisDevice ? null : () => _disconnectDevice(device),
            ocTheme: ocTheme,
          );
        },
      ),
    );
  }
}

class _DeviceCard extends StatelessWidget {
  const _DeviceCard({
    required this.device,
    required this.isThisDevice,
    required this.onDisconnect,
    required this.ocTheme,
  });
  final DeviceInfo device;
  final bool isThisDevice;
  final VoidCallback? onDisconnect;
  final OpenCodeTheme ocTheme;
  IconData _getPlatformIcon() {
    switch (device.platform.toLowerCase()) {
      case 'ios':
        return AppIcons.phone;
      case 'android':
        return AppIcons.phone;
      case 'macos':
        return AppIcons.laptop;
      case 'windows':
        return AppIcons.laptop;
      case 'linux':
        return AppIcons.computer;
      case 'web':
        return AppIcons.globe;
      default:
        return AppIcons.devices;
    }
  }

  Color _getConnectionColor() {
    switch (device.connectionType.toLowerCase()) {
      case 'local':
        return ocTheme.success;
      default:
        return ocTheme.textMuted;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Card(
      color: ocTheme.backgroundPanel,
      margin: Insets.bottomMd,
      shape: RoundedRectangleBorder(
        borderRadius: Radii.brMd,
        side: isThisDevice
            ? BorderSide(color: ocTheme.primary, width: 2)
            : BorderSide(color: ocTheme.border),
      ),
      child: Padding(
        padding: Insets.card,
        child: Row(
          children: [
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(
                color: ocTheme.backgroundElement,
                borderRadius: Radii.brMd,
              ),
              child: Icon(
                _getPlatformIcon(),
                color: isThisDevice ? ocTheme.primary : ocTheme.text,
                size: 24,
              ),
            ),
            const SizedBox(width: Spacing.lg),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          device.deviceName,
                          style: TextStyle(
                            color: ocTheme.text,
                            fontWeight: FontWeight.w600,
                            fontSize: 16,
                          ),
                        ),
                      ),
                      if (isThisDevice)
                        Container(
                          padding: const EdgeInsets.symmetric(
                            horizontal: 8,
                            vertical: 2,
                          ),
                          decoration: BoxDecoration(
                            color: ocTheme.primary.withValues(alpha: 0.2),
                            borderRadius: Radii.brXs,
                          ),
                          child: Text(
                            'This Device',
                            style: TextStyle(
                              color: ocTheme.primary,
                              fontSize: 10,
                              fontWeight: FontWeight.w600,
                            ),
                          ),
                        ),
                    ],
                  ),
                  const SizedBox(height: Spacing.xs),
                  Row(
                    children: [
                      Container(
                        width: 8,
                        height: 8,
                        decoration: BoxDecoration(
                          color: _getConnectionColor(),
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        device.connectionType,
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 13,
                        ),
                      ),
                      if (device.rttMs > 0) ...[
                        const SizedBox(width: Spacing.sm),
                        Text(
                          '${device.rttMs}ms',
                          style: TextStyle(
                            color: ocTheme.textMuted,
                            fontSize: 13,
                          ),
                        ),
                      ],
                    ],
                  ),
                  const SizedBox(height: Spacing.xxs),
                  Text(
                    'Connected ${device.connectedDurationText}',
                    style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
                  ),
                  if (device.currentView != null) ...[
                    const SizedBox(height: Spacing.xs),
                    Text(
                      device.currentView!.sessionId != null
                          ? 'Viewing session'
                          : device.currentView!.projectPath ?? 'Browsing',
                      style: TextStyle(
                        color: ocTheme.textMuted,
                        fontSize: 11,
                        fontStyle: FontStyle.italic,
                      ),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                ],
              ),
            ),
            if (onDisconnect != null)
              IconButton(
                icon: Icon(AppIcons.close, color: ocTheme.error),
                onPressed: onDisconnect,
                tooltip: 'Disconnect',
              ),
          ],
        ),
      ),
    );
  }
}
