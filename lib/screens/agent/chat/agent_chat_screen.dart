import 'package:broski/agent/agent_providers.dart';
import 'package:broski/agent/notify/session_viewing.dart';
import 'package:broski/agent/session/agent_session_state.dart';
import 'package:broski/agent/session/session_link.dart';
import 'package:broski/contract/generated/contract.dart';
import 'package:broski/providers/appearance_provider.dart';
import 'package:broski/screens/agent/chat/chat_header.dart';
import 'package:broski/screens/agent/chat/chat_more_sheet.dart';
import 'package:broski/screens/agent/chat/chat_sidebar.dart';
import 'package:broski/screens/agent/chat/chat_timeline.dart';
import 'package:broski/screens/agent/chat/interaction_bar.dart';
import 'package:broski/screens/agent/chat/link_banner.dart';
import 'package:broski/screens/agent/chat/live_strips.dart';
import 'package:broski/screens/agent/chat/stop_bar.dart';
import 'package:broski/screens/agent/composer/composer.dart';
import 'package:broski/screens/agent/composer/composer_rules.dart';
import 'package:broski/screens/agent/shared/offline_banner.dart';
import 'package:broski/screens/chat/chat_read_only_footer.dart';
import 'package:broski/theme/opencode_theme.dart';
import 'package:broski/utils/responsive.dart';
import 'package:broski/widgets/adaptive_container.dart';
import 'package:broski/widgets/app_background.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

Future<void> openSession(BuildContext context, SessionRef session) =>
    Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => AgentChatScreen(session: session),
      ),
    );

/// One session's conversation, in the app's chat: its background, slim
/// header, messages and tool cards, the bars above the input and the input
/// bar, with the sidebar at the right edge. When the live session goes on
/// under a new id (`session_replaced`), the screen follows it.
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
    return Scaffold(
      backgroundColor: OpenCodeTheme.of(context).background,
      endDrawer: ChatSidebar(state: state),
      drawerEdgeDragWidth: 40,
      body: Stack(
        children: [
          const AppBackground(screenId: AppScreen.chat),
          SafeArea(
            child: AdaptiveContainer(
              width: ContentWidth.wide,
              child: Builder(builder: (context) => _body(context, state)),
            ),
          ),
        ],
      ),
    );
  }

  Widget _body(BuildContext context, AgentSessionState state) {
    final capabilities = ref.watch(capabilitiesProvider(_session.backend));
    final saved = ref.watch(liveProvider) ? null : state.history.savedAt;
    void openSidebar() => Scaffold.of(context).openEndDrawer();
    final more = _more(context, state, capabilities);
    return Column(
      children: [
        ChatHeader(
          title: state.summary?.title?.text ?? 'Session',
          usage: state.snapshot.usage,
          onOpenSidebar: openSidebar,
          onMore: saved == null ? more : null,
        ),
        LinkBanner(
          link: state.link,
          contract: ref.watch(contractStateProvider).value,
          onRetry: () => ref.read(sessionProvider(_session).notifier).attach(),
        ),
        if (saved != null) OfflineBanner(savedAt: saved),
        Expanded(
          child: GestureDetector(
            behavior: HitTestBehavior.translucent,
            onTap: () => FocusScope.of(context).unfocus(),
            child: ChatTimeline(
              session: _session,
              capabilities: capabilities,
              onEdit: (input) => _draft.text = input.text,
            ),
          ),
        ),
        LiveStrips(session: _session, state: state, onOpenPlan: openSidebar),
        InteractionBar(session: _session, state: state),
        StopBar(session: _session, state: state),
        ?_input(state, capabilities, more),
      ],
    );
  }

  /// Opens the More sheet; null when the sheet would be empty.
  VoidCallback? _more(
    BuildContext context,
    AgentSessionState state,
    Capabilities? capabilities,
  ) {
    if (capabilities == null) return null;
    final offers = chatMoreOffers(
      ref,
      session: _session,
      state: state,
      capabilities: capabilities,
    );
    if (!offers) return null;
    return () => showChatMore(
      context,
      ref,
      session: _session,
      state: state,
      capabilities: capabilities,
    );
  }

  /// The input bar where the session takes input; the read-only footer
  /// where it is only watched; nothing until its capabilities are known.
  Widget? _input(
    AgentSessionState state,
    Capabilities? capabilities,
    VoidCallback? more,
  ) {
    if (capabilities != null && state.controllable) {
      return Composer(
        session: _session,
        state: state,
        capabilities: capabilities,
        text: _draft,
        onMenu: more,
      );
    }
    if (state.capabilities == null) return null;
    return const ChatReadOnlyFooter(
      message: 'This session is open elsewhere and can only be watched here.',
    );
  }
}
