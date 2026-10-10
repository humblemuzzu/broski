import 'package:broski/theme/app_icons.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski_link/broski_link.dart';
import 'package:flutter/widgets.dart';

/// How urgent a link state is, drawn in the theme's semantic colors.
enum LinkStatusTone { ok, pending, down }

extension LinkStatusToneColor on LinkStatusTone {
  Color color(OpenCodeTheme theme) => switch (this) {
    LinkStatusTone.ok => theme.success,
    LinkStatusTone.pending => theme.warning,
    LinkStatusTone.down => theme.error,
  };
}

/// What one link status reads as.
///
/// [label] names the machine; [state] is the same state without the name, for
/// rows that already show the machine beside it.
typedef LinkStatusView = ({
  String label,
  String state,
  IconData icon,
  LinkStatusTone tone,
});

LinkStatusView presentLinkStatus({
  required LinkStatus status,
  required String machineName,
  required DateTime now,
}) {
  final lastSeen = status.lastSeen;
  final seen = lastSeen == null ? null : formatLinkTime(lastSeen, now);
  switch (status.state) {
    case LinkConnectionState.connected:
      return _connected(status.route, machineName);
    case LinkConnectionState.connecting:
    case LinkConnectionState.waiting:
      return _connecting(machineName);
    case LinkConnectionState.machineAsleep:
      return _asleep(seen, machineName);
    case LinkConnectionState.machineOffline:
      return _offline(seen, machineName);
    case LinkConnectionState.closed:
      return _disconnected;
  }
}

const LinkStatusView _disconnected = (
  label: 'Disconnected',
  state: 'Disconnected',
  icon: AppIcons.signalOff,
  tone: LinkStatusTone.down,
);

LinkStatusView _connected(LinkRoute? route, String machineName) {
  final (state, icon) = switch (route) {
    LinkRoute.lan => ('Local network', AppIcons.wifi),
    LinkRoute.relay => ('Remote', AppIcons.globe),
    null => ('Connected', AppIcons.link),
  };
  return (
    label: '$machineName · $state',
    state: state,
    icon: icon,
    tone: LinkStatusTone.ok,
  );
}

LinkStatusView _connecting(String machineName) => (
  label: 'Connecting to $machineName…',
  state: 'Connecting…',
  icon: AppIcons.sync,
  tone: LinkStatusTone.pending,
);

LinkStatusView _asleep(String? seen, String machineName) => (
  label: seen == null
      ? '$machineName is asleep'
      : '$machineName is asleep · since $seen',
  state: seen == null ? 'Asleep' : 'Asleep · since $seen',
  icon: AppIcons.pause,
  tone: LinkStatusTone.pending,
);

LinkStatusView _offline(String? seen, String machineName) => (
  label: seen == null
      ? '$machineName is offline · not seen yet'
      : '$machineName is offline · last seen $seen',
  state: seen == null ? 'Offline · not seen yet' : 'Offline · last seen $seen',
  icon: AppIcons.wifiOff,
  tone: LinkStatusTone.down,
);

/// A short age for [time] as read at [now]: `just now`, `5m ago`, `3h ago`,
/// `yesterday`, `4d ago`.
String formatLinkTime(DateTime time, DateTime now) {
  final age = now.difference(time);
  if (age.inMinutes < 1) return 'just now';
  if (age.inMinutes < 60) return '${age.inMinutes}m ago';
  if (age.inHours < 24) return '${age.inHours}h ago';
  final days = _calendarDays(time, now);
  if (days <= 1) return 'yesterday';
  return '${days}d ago';
}

int _calendarDays(DateTime time, DateTime now) {
  final from = time.toLocal();
  final to = now.toLocal();
  return DateTime(
    to.year,
    to.month,
    to.day,
  ).difference(DateTime(from.year, from.month, from.day)).inDays;
}
