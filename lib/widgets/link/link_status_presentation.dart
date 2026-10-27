import 'package:broski/services/link/discovery/lan_search.dart';
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
  BridgeLinkStatus? bridge,
  LanSearchState lanSearch = LanSearchState.quiet,
}) {
  final bridgeView = connectionHoldsBridge(status)
      ? bridgeStatusView(bridge: bridge, machineName: machineName)
      : null;
  if (bridgeView != null) return bridgeView;
  final lastSeen = status.lastSeen;
  final seen = lastSeen == null ? null : formatLinkTime(lastSeen, now);
  switch (status.state) {
    case LinkConnectionState.connected:
      return _connected(status.route, machineName);
    case LinkConnectionState.connecting:
    case LinkConnectionState.waiting:
      return switch (lanSearch) {
        LanSearchState.looking => _looking(machineName),
        LanSearchState.absent => _absent(machineName),
        LanSearchState.quiet => _connecting(machineName, status.closeCode),
      };
    case LinkConnectionState.machineAsleep:
      return _asleep(seen, machineName);
    case LinkConnectionState.machineOffline:
      return _offline(seen, machineName);
    case LinkConnectionState.closed:
      return status.closeCode == LinkCloseCode.revoked
          ? _revoked
          : _disconnected;
  }
}

/// Whether the link is carrying this bridge at all. A bridge status left behind
/// by a link that is now asleep or offline says nothing about the machine: only
/// a connected link can be waiting on its bridge.
bool connectionHoldsBridge(LinkStatus status) =>
    status.state == LinkConnectionState.connected;

/// The machine's bridge process, or null while it is up and the link status is
/// the one worth showing.
LinkStatusView? bridgeStatusView({
  required BridgeLinkStatus? bridge,
  required String machineName,
}) => bridge == null ? null : _bridge(bridge.state, "$machineName's bridge");

/// How urgent a bridge state is, in the tones the link uses.
LinkStatusTone bridgeTone(BridgeStatusState state) =>
    _bridge(state, 'Bridge')?.tone ?? LinkStatusTone.ok;

/// Whether the bridge crashed on a link that can carry the restart request.
bool canRestartBridge(LinkStatus? status, BridgeLinkStatus? bridge) =>
    status != null &&
    connectionHoldsBridge(status) &&
    bridge?.state == BridgeStatusState.crashed;

/// What the machine's last close code means while the link reconnects.
String? linkCloseDetail(int? code) => switch (code) {
  LinkCloseCode.shuttingDown => 'Mac is restarting',
  LinkCloseCode.bridgeOverflow || LinkCloseCode.sessionError => 'Session reset',
  LinkCloseCode.idleExpired => 'Session timed out',
  _ => null,
};

/// The bridge state without a machine name, for a row that already shows one.
String? bridgeStatusLabel(BridgeLinkStatus bridge) =>
    _bridge(bridge.state, 'Bridge')?.label;

LinkStatusView? _bridge(BridgeStatusState state, String subject) =>
    switch (state) {
      BridgeStatusState.up => null,
      BridgeStatusState.starting => (
        label: '$subject is starting…',
        state: 'Bridge starting…',
        icon: AppIcons.sync,
        tone: LinkStatusTone.pending,
      ),
      BridgeStatusState.connecting => (
        label: '$subject is connecting…',
        state: 'Bridge connecting…',
        icon: AppIcons.sync,
        tone: LinkStatusTone.pending,
      ),
      BridgeStatusState.down => (
        label: '$subject is down',
        state: 'Bridge down',
        icon: AppIcons.wifiOff,
        tone: LinkStatusTone.down,
      ),
      BridgeStatusState.crashed => (
        label: '$subject crashed',
        state: 'Bridge crashed',
        icon: AppIcons.warning,
        tone: LinkStatusTone.down,
      ),
      BridgeStatusState.unknown => (
        label: '$subject is not ready',
        state: 'Bridge not ready',
        icon: AppIcons.sync,
        tone: LinkStatusTone.pending,
      ),
    };

const LinkStatusView _disconnected = (
  label: 'Disconnected',
  state: 'Disconnected',
  icon: AppIcons.signalOff,
  tone: LinkStatusTone.down,
);

/// The machine ended the session because this phone is no longer paired.
const LinkStatusView _revoked = (
  label: 'Removed from this machine · pair again',
  state: 'Removed · pair again',
  icon: AppIcons.unlink,
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

LinkStatusView _connecting(String machineName, int? closeCode) {
  final detail = linkCloseDetail(closeCode);
  final what = detail == null ? 'Connecting…' : 'Connecting… · $detail';
  return (
    label: detail == null
        ? 'Connecting to $machineName…'
        : 'Connecting to $machineName… · $detail',
    state: what,
    icon: AppIcons.sync,
    tone: LinkStatusTone.pending,
  );
}

LinkStatusView _looking(String machineName) => (
  label: 'Looking for $machineName on this network…',
  state: 'Looking on this network…',
  icon: AppIcons.search,
  tone: LinkStatusTone.pending,
);

LinkStatusView _absent(String machineName) => (
  label: '$machineName is offline',
  state: 'Offline',
  icon: AppIcons.wifiOff,
  tone: LinkStatusTone.down,
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
