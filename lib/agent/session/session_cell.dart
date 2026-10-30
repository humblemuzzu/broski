import 'package:broski/agent/cache/agent_cache.dart';
import 'package:broski/agent/client/contract_client.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/session_notices.dart';
import 'package:broski/contract/generated/contract.dart';

/// One session's state as the parts of its controller share it: each part
/// reads [current] and changes it only through [update].
abstract interface class SessionCell {
  SessionRef get ref;
  ContractClient get client;

  /// Where the finished history is kept for the times the link is down.
  AgentCache? get cache;
  AgentSessionState get current;

  /// The controller was disposed: answers that arrive later change nothing.
  bool get closed;

  void update(AgentSessionState Function(AgentSessionState state) change);

  void notify(NoticeLevel level, String text);

  SessionNotice notice(NoticeLevel level, String text);

  /// Ends early when the controller is disposed; check [closed] after it.
  Future<void> wait(Duration delay);

  /// Attaches again from the last position applied, if the session is live.
  void reattach();
}
