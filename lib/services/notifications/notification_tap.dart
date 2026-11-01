import 'dart:convert';

/// The session a tapped notification is about: what the machine's push names
/// (`backend`, `session`, `request`, and the machine it came from) and what a
/// local notification carries as its payload.
final class NotificationTap {
  const NotificationTap({
    required this.backend,
    required this.session,
    this.request,
    this.machine,
  });

  final String backend;
  final String session;
  final String? request;

  /// The paired machine whose session it is; null for a notification that
  /// does not say, which is about the machine the app is on.
  final String? machine;

  /// A tap from a push (a map the platform hands over) or a local
  /// notification (a JSON string); null for anything that does not name a
  /// backend and a session, such as the plain session id older local
  /// notifications carry.
  static NotificationTap? parse(Object? payload) {
    final map = switch (payload) {
      final Map<Object?, Object?> map => map,
      final String text => _decode(text),
      _ => null,
    };
    if (map == null) return null;
    final backend = map['backend'];
    final session = map['session'];
    if (backend is! String || backend.isEmpty) return null;
    if (session is! String || session.isEmpty) return null;
    return NotificationTap(
      backend: backend,
      session: session,
      request: _nonEmpty(map['request']),
      machine: _nonEmpty(map['machine']),
    );
  }

  static String? _nonEmpty(Object? value) =>
      value is String && value.isNotEmpty ? value : null;

  /// The payload a local notification for this session carries.
  String toPayload() => jsonEncode({
    'backend': backend,
    'session': session,
    if (request != null) 'request': request,
    if (machine != null) 'machine': machine,
  });

  static Map<Object?, Object?>? _decode(String text) {
    try {
      final decoded = jsonDecode(text);
      return decoded is Map<Object?, Object?> ? decoded : null;
    } on FormatException {
      return null;
    }
  }

  @override
  bool operator ==(Object other) =>
      other is NotificationTap &&
      other.backend == backend &&
      other.session == session &&
      other.request == request &&
      other.machine == machine;

  @override
  int get hashCode => Object.hash(backend, session, request, machine);
}
