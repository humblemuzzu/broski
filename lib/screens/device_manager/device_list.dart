import 'package:broski/models/device.dart';
import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:flutter/material.dart';

/// What the device list is showing instead of devices: a spinner, the reason it
/// could not load, or nothing connected yet.
class DeviceListPlaceholder extends StatelessWidget {
  const DeviceListPlaceholder.loading({super.key})
    : loading = true,
      failure = null,
      onRetry = null;

  const DeviceListPlaceholder.empty({super.key})
    : loading = false,
      failure = null,
      onRetry = null;

  const DeviceListPlaceholder.failed({
    super.key,
    required String this.failure,
    required VoidCallback this.onRetry,
  }) : loading = false;

  final bool loading;
  final String? failure;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    if (loading) return const Center(child: CircularProgressIndicator());
    final ocTheme = OpenCodeTheme.of(context);
    final message = failure;
    if (message != null) {
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
              message,
              style: TextStyle(color: ocTheme.textMuted, fontSize: 12),
            ),
            const SizedBox(height: Spacing.lg),
            ElevatedButton(onPressed: onRetry, child: const Text('Retry')),
          ],
        ),
      );
    }
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
}

/// The devices this machine reports, with this phone first.
class DeviceListView extends StatelessWidget {
  const DeviceListView({
    super.key,
    required this.devices,
    required this.thisDeviceId,
    required this.onRefresh,
    required this.onDisconnect,
  });

  final List<DeviceInfo> devices;
  final String? thisDeviceId;
  final Future<void> Function() onRefresh;
  final void Function(DeviceInfo device) onDisconnect;

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final sorted = List<DeviceInfo>.of(devices)
      ..sort((a, b) {
        if (a.deviceId == thisDeviceId) return -1;
        if (b.deviceId == thisDeviceId) return 1;
        return a.connectedAt.compareTo(b.connectedAt);
      });
    return RefreshIndicator(
      onRefresh: onRefresh,
      child: ListView.builder(
        padding: Insets.card,
        itemCount: sorted.length,
        itemBuilder: (context, index) {
          final device = sorted[index];
          final isThisDevice = device.deviceId == thisDeviceId;
          return DeviceCard(
            device: device,
            isThisDevice: isThisDevice,
            onDisconnect: isThisDevice ? null : () => onDisconnect(device),
            ocTheme: ocTheme,
          );
        },
      ),
    );
  }
}

/// One device: what it is, how long it has been here, and how fast it answers.
class DeviceCard extends StatelessWidget {
  const DeviceCard({
    super.key,
    required this.device,
    required this.isThisDevice,
    required this.onDisconnect,
    required this.ocTheme,
  });

  final DeviceInfo device;
  final bool isThisDevice;
  final VoidCallback? onDisconnect;
  final OpenCodeTheme ocTheme;

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
                _platformIcon,
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
                      if (isThisDevice) _thisDeviceBadge(),
                    ],
                  ),
                  const SizedBox(height: Spacing.xs),
                  Row(
                    children: [
                      Container(
                        width: 6,
                        height: 6,
                        decoration: BoxDecoration(
                          color: ocTheme.success,
                          shape: BoxShape.circle,
                        ),
                      ),
                      const SizedBox(width: 6),
                      Text(
                        device.rttMs > 0 ? '${device.rttMs}ms' : 'Connected',
                        style: TextStyle(
                          color: ocTheme.textMuted,
                          fontSize: 13,
                        ),
                      ),
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

  Widget _thisDeviceBadge() => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(
      color: ocTheme.primary.withValues(alpha: 0.15),
      borderRadius: Radii.brSm,
    ),
    child: Text(
      'This device',
      style: TextStyle(color: ocTheme.primary, fontSize: 11),
    ),
  );

  IconData get _platformIcon {
    switch (device.platform.toLowerCase()) {
      case 'ios':
      case 'android':
        return AppIcons.phone;
      case 'macos':
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
}
