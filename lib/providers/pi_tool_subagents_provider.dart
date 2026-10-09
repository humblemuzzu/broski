import 'package:broski/models/runtime/runtime_session_summary.dart';
import 'package:broski/providers/service_providers.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Composite key for the Pi tool subagents provider. We need both `sessionId`
/// (to look up the parent session) and `cwd` so the bridge's dynamic subagent
/// registry can discover user-configured extension tools for this working
/// directory. Keying by `sessionId` alone would cause cache collisions and
/// drop the cwd context the bridge needs.
class PiToolSubagentsKey {
  final String sessionId;
  final String cwd;

  const PiToolSubagentsKey({required this.sessionId, required this.cwd});

  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      (other is PiToolSubagentsKey &&
          other.sessionId == sessionId &&
          other.cwd == cwd);

  @override
  int get hashCode => Object.hash(sessionId, cwd);
}

/// Lazy-loads Pi tool subagent invocations (Task, oracle, finder, librarian,
/// code_review, look_at, read_github, web_search, plus any user-configured
/// extension tool that spawns a child agent) for a given parent Pi session.
///
/// Detection is dynamic — the bridge uses Pi's `ResourceLoader` to discover
/// every tool that's loaded for the cwd, so custom user subagents show up
/// automatically without needing a hardcoded list.
///
/// Filters to `sessionKind == 'subagent' && backendData['kind'] ==
/// 'pi_tool_invocation'` — Pi handoff children (real sessions) are excluded
/// because they're rendered separately by `_PiChildSessionCard`.
final piToolSubagentsProvider =
    FutureProvider.family<List<RuntimeSessionSummary>, PiToolSubagentsKey>((
      ref,
      key,
    ) async {
      final bridge = ref.watch(bridgeServiceProvider);
      final children = await bridge.listSessionChildren(
        backend: 'pi',
        sessionId: key.sessionId,
        cwd: key.cwd.isEmpty ? null : key.cwd,
      );
      return children
          .where(
            (c) =>
                c.sessionKind == 'subagent' &&
                (c.backendData?['kind'] == 'pi_tool_invocation'),
          )
          .toList();
    });
