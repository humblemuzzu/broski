import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/notify/session_viewing.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/agent/ui/chat/chat_header.dart';
import 'package:broski/agent/ui/chat/chat_timeline.dart';
import 'package:broski/agent/ui/chat/interaction_bar.dart';
import 'package:broski/agent/ui/chat/link_banner.dart';
import 'package:broski/agent/ui/chat/live_strips.dart';
import 'package:broski/agent/ui/chat/stop_bar.dart';
import 'package:broski/agent/ui/composer/composer.dart';
import 'package:broski/agent/ui/composer/composer_rules.dart';
import 'package:broski/agent/ui/shared/offline_banner.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/theme/app_typography.dart';
import 'package:broski/theme/design_tokens.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

Future<void> openSession(BuildContext context, SessionRef session) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AgentChatScreen(session: session),
      ),
    );

/// One session's conversation. When the live session goes on under a new id
/// (`session_replaced`), the screen follows it.
class AgentChatScreen extends ConsumerStatefulWidget {
  const AgentChatScreen({super.key, required this.session});

  final SessionRef session;

  @override
  ConsumerState<AgentChatScreen> createState() => _AgentChatScreenState();
}

class _AgentChatScreenState extends ConsumerState<AgentChatScreen> {
  late SessionRef _session = widget.session;
  final _draft = TextEditingController();
  late final SessionViewing _viewing = ref.read(sessionViewingProvider);

  @override
  void initState() {
    super.initState();
    _viewing.opened(_session);
  }

  @override
  void dispose() {
    _viewing.closed(_session);
    _draft.dispose();
    super.dispose();
  }

  void _follow(SessionRef next) {
    _viewing.closed(_session);
    _viewing.opened(next);
    setState(() => _session = next);
  }

  void _followReplacement() => ref.listen(
    sessionProvider(_session).select((state) => state.link),
    (_, link) {
      if (link case LinkReplaced(:final next)) {
        _follow(next);
      }
    },
  );

  void _takeReturnedInput() => ref.listen(
    sessionProvider(_session).select((state) => state.returnedInput),
    (_, returned) {
      if (returned.isEmpty) return;
      final merged = withReturnedInput(returned, _draft.text);
      _draft.value = TextEditingValue(
        text: merged,
        selection: TextSelection.collapsed(offset: merged.length),
      );
      ref
          .read(sessionProvider(_session).notifier)
          .controls
          .clearReturnedInput();
    },
  );

  @override
  Widget build(BuildContext context) {
    _followReplacement();
    _takeReturnedInput();
    final state = ref.watch(sessionProvider(_session));
    final capabilities = ref.watch(capabilitiesProvider(_session.backend));
    final saved = state.history.savedAt;
    return Scaffold(
      appBar: AppBar(
        title: ChatTitle(state: state),
        actions: [
          if (capabilities != null && saved == null)
            ChatActions(
              session: _session,
              state: state,
              capabilities: capabilities,
            ),
        ],
      ),
      body: SafeArea(
        child: Column(
          children: [
            LinkBanner(
              link: state.link,
              contract: ref.watch(contractStateProvider).value,
              onRetry: () =>
                  ref.read(sessionProvider(_session).notifier).attach(),
            ),
            if (saved != null) OfflineBanner(savedAt: saved),
            Expanded(
              child: ChatTimeline(
                session: _session,
                capabilities: capabilities,
                onEdit: (input) => _draft.text = input.text,
              ),
            ),
            LiveStrips(session: _session, state: state),
            InteractionBar(session: _session, state: state),
            StopBar(session: _session, state: state),
            ?_input(state, capabilities),
          ],
        ),
      ),
    );
  }

  /// The composer where the session takes input; a note where it is only
  /// watched; nothing until its capabilities are known.
  Widget? _input(AgentSessionState state, Capabilities? capabilities) {
    if (capabilities != null && state.controllable) {
      return Composer(
        session: _session,
        state: state,
        capabilities: capabilities,
        text: _draft,
      );
    }
    if (state.capabilities == null) return null;
    return Padding(
      padding: Insets.screen,
      child: Text(
        'This session is open elsewhere and can only be watched here.',
        style: AppTypography.bodySmall(),
      ),
    );
  }
}
