import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../models/file_attachment.dart';
import '../models/pi.dart';
import '../providers/pi_provider.dart';
import '../theme/design_tokens.dart';
import '../widgets/app_background.dart';
import 'package:broski/theme/app_icons.dart';
import 'pi/pi_extension_ui_request_handler.dart';
import 'sheets/pi_file_tag_picker_sheet.dart';
import 'sheets/pi_session_sidebar_sheet.dart';

class PiChatScreen extends ConsumerStatefulWidget {
  const PiChatScreen.draft({super.key, required this.cwd, this.title})
    : sessionPath = null;

  const PiChatScreen.session({
    super.key,
    required this.cwd,
    required this.sessionPath,
    this.title,
  });

  final String cwd;
  final String? sessionPath;
  final String? title;

  @override
  ConsumerState<PiChatScreen> createState() => _PiChatScreenState();
}

class _PiChatScreenState extends ConsumerState<PiChatScreen> {
  final TextEditingController _controller = TextEditingController();
  final ScrollController _scrollController = ScrollController();

  StreamSubscription<PiStreamMessage>? _streamSub;

  bool _loading = true;
  bool _busy = false;

  PiState? _state;
  String? _sessionId;
  String? _dynamicTitle;
  final List<FileAttachment> _composerAttachments = [];
  final List<_PiEntry> _entries = [];
  final StringBuffer _streamAssistant = StringBuffer();
  final StringBuffer _streamThinking = StringBuffer();

  @override
  void initState() {
    super.initState();
    _initialize();
  }

  @override
  void dispose() {
    _streamSub?.cancel();
    _controller.dispose();
    _scrollController.dispose();
    super.dispose();
  }

  Future<void> _initialize() async {
    final bridge = ref.read(piBridgeServiceProvider);

    try {
      if (widget.sessionPath != null && widget.sessionPath!.isNotEmpty) {
        await bridge.switchSession(
          sessionPath: widget.sessionPath!,
          projectPath: widget.cwd,
        );
      }

      final state = await bridge.getState(projectPath: widget.cwd);
      final messages = await bridge.getMessages(projectPath: widget.cwd);

      if (!mounted) return;

      setState(() {
        _state = state;
        _sessionId = state.sessionId;
        _dynamicTitle = state.sessionName;
        _busy = state.isStreaming;
        _entries
          ..clear()
          ..addAll(messages.map(_mapBridgeMessage));
        _loading = false;
      });

      await _streamSub?.cancel();
      _streamSub = bridge.streamMessages.listen(_onStreamMessage);
      _scrollToBottom();
    } catch (error) {
      if (!mounted) return;
      setState(() => _loading = false);
      _showSnack('Failed to initialize Pi chat: $error');
    }
  }

  _PiEntry _mapBridgeMessage(Map<String, dynamic> message) {
    final role = message['role'] as String? ?? 'system';

    if (role == 'user') {
      return _PiEntry.user(
        text: message['content'] as String? ?? '',
        timestampMs: message['timestamp'] as int?,
      );
    }

    if (role == 'assistant') {
      final text = message['text'] as String? ?? '';
      final thinking = message['thinking'] as String?;
      final provider = message['provider'] as String?;
      final model = message['model'] as String?;

      final lines = <String>[];
      if (thinking != null && thinking.trim().isNotEmpty) {
        lines.add('🤔 $thinking');
      }
      if (text.trim().isNotEmpty) {
        lines.add(text);
      }
      if ((provider ?? '').isNotEmpty || (model ?? '').isNotEmpty) {
        lines.add('[$provider/$model]');
      }

      return _PiEntry.assistant(
        text: lines.join('\n\n'),
        timestampMs: message['timestamp'] as int?,
      );
    }

    if (role == 'toolResult') {
      final toolName = message['toolName'] as String? ?? 'tool';
      final content = message['content'] as String? ?? '';
      final isError = message['isError'] as bool? ?? false;
      return _PiEntry.system(
        text: isError
            ? '⚠️ Tool $toolName failed\n$content'
            : '🛠️ Tool $toolName\n$content',
        timestampMs: message['timestamp'] as int?,
      );
    }

    return _PiEntry.system(
      text: '${message['role'] ?? 'event'}: ${message.toString()}',
      timestampMs: message['timestamp'] as int?,
    );
  }

  void _onStreamMessage(PiStreamMessage message) {
    if (!mounted) return;

    if (_sessionId != null &&
        (message.sessionId?.isNotEmpty ?? false) &&
        message.sessionId != _sessionId) {
      return;
    }

    switch (message.type) {
      case 'agent-start':
        setState(() => _busy = true);
        break;

      case 'text-delta':
        final delta = message.textDelta;
        if (delta != null) {
          _streamAssistant.write(delta);
          setState(() {});
          _scrollToBottom();
        }
        break;

      case 'thinking-delta':
        final delta = message.thinkingDelta;
        if (delta != null) {
          _streamThinking.write(delta);
          setState(() {});
        }
        break;

      case 'tool-exec-start':
        final name = message.raw['toolName'] as String? ?? 'tool';
        final args = message.raw['args'];
        _entries.add(_PiEntry.system(text: '▶️ $name started\n${args ?? ''}'));
        setState(() {});
        _scrollToBottom();
        break;

      case 'tool-exec-end':
        final name = message.raw['toolName'] as String? ?? 'tool';
        final result = message.raw['result'];
        final isError = message.raw['isError'] as bool? ?? false;
        _entries.add(
          _PiEntry.system(
            text: isError
                ? '❌ $name failed\n${result ?? ''}'
                : '✅ $name finished\n${result ?? ''}',
          ),
        );
        setState(() {});
        _scrollToBottom();
        break;

      case 'message-done':
      case 'agent-end':
        _flushStreamingAssistant();
        _refreshState();
        break;

      case 'compaction-start':
        _entries.add(_PiEntry.system(text: '🧹 Auto-compaction started'));
        setState(() {});
        break;

      case 'compaction-end':
        _entries.add(_PiEntry.system(text: '🧹 Auto-compaction finished'));
        setState(() {});
        break;

      case 'retry-start':
        _entries.add(_PiEntry.system(text: '🔁 Retry started'));
        setState(() {});
        break;

      case 'retry-end':
        _entries.add(_PiEntry.system(text: '🔁 Retry ended'));
        setState(() {});
        break;

      case 'extension-ui-request':
        {
          final bridge = ref.read(piBridgeServiceProvider);
          unawaited(
            handlePiExtensionUiRequest(
              context: context,
              bridge: bridge,
              request: message,
              projectPath: widget.cwd,
              composerController: _controller,
              onSetTitle: (title) {
                if (!mounted) return;
                setState(() => _dynamicTitle = title);
              },
            ),
          );
          break;
        }

      case 'error':
        _entries.add(
          _PiEntry.error(text: message.errorMessage ?? 'Unknown Pi error'),
        );
        _busy = false;
        setState(() {});
        _showSnack(message.errorMessage ?? 'Unknown Pi error');
        break;
    }
  }

  void _flushStreamingAssistant() {
    final thinking = _streamThinking.toString().trim();
    final text = _streamAssistant.toString().trim();

    if (thinking.isNotEmpty || text.isNotEmpty) {
      final lines = <String>[];
      if (thinking.isNotEmpty) lines.add('🤔 $thinking');
      if (text.isNotEmpty) lines.add(text);
      _entries.add(_PiEntry.assistant(text: lines.join('\n\n')));
    }

    _streamThinking.clear();
    _streamAssistant.clear();
    _busy = false;
    setState(() {});
    _scrollToBottom();
  }

  Future<void> _refreshState() async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      final state = await bridge.getState(projectPath: widget.cwd);
      if (!mounted) return;
      setState(() {
        _state = state;
        _sessionId = state.sessionId;
        _dynamicTitle = state.sessionName ?? _dynamicTitle;
      });
    } catch (_) {
      // Best effort only.
    }
  }

  Future<void> _sendPrompt() async {
    final prompt = _controller.text.trim();
    if (prompt.isEmpty) return;

    final attachments = List<FileAttachment>.from(_composerAttachments);
    _controller.clear();
    setState(() {
      final attachmentText = attachments
          .where((item) => item.base64Data == null)
          .map((item) => '@${item.path}')
          .join('\n');
      final renderedPrompt = attachmentText.isEmpty
          ? prompt
          : '$prompt\n\n$attachmentText';
      _entries.add(_PiEntry.user(text: renderedPrompt));
      _composerAttachments.clear();
    });
    _scrollToBottom();

    final bridge = ref.read(piBridgeServiceProvider);
    try {
      await bridge.chat(
        prompt: prompt,
        projectPath: widget.cwd,
        fileAttachments: attachments.isEmpty ? null : attachments,
      );
    } catch (error) {
      _showSnack('Failed to send: $error');
    }
  }

  Future<void> _abort() async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      await bridge.abort(projectPath: widget.cwd);
    } catch (error) {
      _showSnack('Failed to stop: $error');
    }
  }

  Future<void> _pickFileTag() async {
    final selected = await showPiFileTagPickerSheet(
      context: context,
      cwd: widget.cwd,
    );
    if (selected == null || selected.trim().isEmpty || !mounted) return;

    final normalized = selected.trim();
    setState(() {
      final attachment = FileAttachment.fromPath(normalized);
      if (!_composerAttachments.contains(attachment)) {
        _composerAttachments.add(attachment);
      }
    });
  }

  Future<void> _forkFromEntry(String entryId) async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      final result = await bridge.fork(
        entryId: entryId,
        projectPath: widget.cwd,
      );
      if (result.cancelled) {
        _showSnack('Fork cancelled');
        return;
      }

      if (!mounted) return;
      _controller.text = result.text;
      _controller.selection = TextSelection.fromPosition(
        TextPosition(offset: _controller.text.length),
      );
      setState(() => _loading = true);
      await _initialize();
      _showSnack('Forked session from selected message');
    } catch (error) {
      _showSnack('Fork failed: $error');
    }
  }

  Future<void> _openSessionSidebar() async {
    if (_state == null) return;

    await showPiSessionSidebarSheet(
      context: context,
      cwd: widget.cwd,
      currentSessionId: _state!.sessionId,
      state: _state,
      onOpenSession: (session) {
        Navigator.pop(context);
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => PiChatScreen.session(
              cwd: session.cwd,
              sessionPath: session.path,
              title: session.name,
            ),
          ),
        );
      },
      onForkFromEntry: (entryId) {
        Navigator.pop(context);
        unawaited(_forkFromEntry(entryId));
      },
    );

    await _refreshState();
  }

  Future<void> _showModelSheet() async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      final models = await bridge.listModels(projectPath: widget.cwd);
      if (!mounted) return;

      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        isScrollControlled: true,
        builder: (context) {
          return SafeArea(
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: models.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final model = models[index];
                final selected =
                    _state?.model?.id == model.id &&
                    _state?.model?.provider == model.provider;
                return ListTile(
                  dense: true,
                  selected: selected,
                  title: Text('${model.provider}/${model.id}'),
                  subtitle: Text(
                    '${model.name} • ctx ${model.contextWindow} • ${model.reasoning ? 'reasoning' : 'no reasoning'}',
                  ),
                  onTap: () async {
                    Navigator.pop(context);
                    await bridge.setModel(
                      provider: model.provider,
                      modelId: model.id,
                      projectPath: widget.cwd,
                    );
                    await _refreshState();
                  },
                );
              },
            ),
          );
        },
      );
    } catch (error) {
      _showSnack('Failed to load models: $error');
    }
  }

  Future<void> _cycleThinking() async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      await bridge.cycleThinkingLevel(projectPath: widget.cwd);
      await _refreshState();
    } catch (error) {
      _showSnack('Failed to change thinking level: $error');
    }
  }

  Future<void> _showCommandsSheet() async {
    final bridge = ref.read(piBridgeServiceProvider);
    try {
      final commands = await bridge.listCommands(projectPath: widget.cwd);
      if (!mounted) return;

      await showModalBottomSheet<void>(
        context: context,
        showDragHandle: true,
        builder: (context) {
          return SafeArea(
            child: ListView.separated(
              shrinkWrap: true,
              itemCount: commands.length,
              separatorBuilder: (_, __) => const Divider(height: 1),
              itemBuilder: (context, index) {
                final command = commands[index];
                return ListTile(
                  dense: true,
                  title: Text('/${command.name}'),
                  subtitle: Text(command.description ?? command.source),
                  onTap: () {
                    Navigator.pop(context);
                    _controller.text = '/${command.name} ';
                    _controller.selection = TextSelection.fromPosition(
                      TextPosition(offset: _controller.text.length),
                    );
                  },
                );
              },
            ),
          );
        },
      );
    } catch (error) {
      _showSnack('Failed to load commands: $error');
    }
  }

  void _scrollToBottom() {
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (!_scrollController.hasClients) return;
      _scrollController.animateTo(
        _scrollController.position.maxScrollExtent,
        duration: const Duration(milliseconds: 220),
        curve: Curves.easeOut,
      );
    });
  }

  void _showSnack(String message) {
    if (!mounted) return;
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  @override
  Widget build(BuildContext context) {
    final title =
        _dynamicTitle ??
        widget.title ??
        _state?.sessionName ??
        _state?.model?.name ??
        'Pi Chat';

    return Scaffold(
      backgroundColor: Colors.transparent,
      appBar: AppBar(
        title: Text(title),
        actions: [
          IconButton(
            tooltip: 'Session sidebar',
            onPressed: _openSessionSidebar,
            icon: const Icon(Icons.history_outlined),
          ),
          IconButton(
            tooltip: 'Commands',
            onPressed: _showCommandsSheet,
            icon: const Icon(AppIcons.code),
          ),
          IconButton(
            tooltip: 'Models',
            onPressed: _showModelSheet,
            icon: const Icon(Icons.auto_awesome),
          ),
          IconButton(
            tooltip: 'Thinking',
            onPressed: _cycleThinking,
            icon: const Icon(Icons.psychology_alt_outlined),
          ),
        ],
      ),
      body: Stack(
        children: [
          const AppBackground(screenId: 'chat_pi'),
          if (_loading)
            const Center(child: CircularProgressIndicator())
          else
            Column(
              children: [
                if (_state != null) _PiHeader(state: _state!, cwd: widget.cwd),
                Expanded(
                  child: ListView.builder(
                    controller: _scrollController,
                    padding: Insets.screenAll,
                    itemCount:
                        _entries.length +
                        ((_streamAssistant.isNotEmpty ||
                                _streamThinking.isNotEmpty)
                            ? 1
                            : 0),
                    itemBuilder: (context, index) {
                      if (index >= _entries.length) {
                        final thinking = _streamThinking.toString();
                        final text = _streamAssistant.toString();
                        final preview = [
                          if (thinking.isNotEmpty) '🤔 $thinking',
                          if (text.isNotEmpty) text,
                        ].join('\n\n');
                        return _PiBubble(
                          entry: _PiEntry.assistant(text: preview),
                        );
                      }

                      return _PiBubble(entry: _entries[index]);
                    },
                  ),
                ),
                if (_busy) const LinearProgressIndicator(minHeight: 2),
                SafeArea(
                  top: false,
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(12, 8, 12, 10),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (_composerAttachments.isNotEmpty)
                          Padding(
                            padding: const EdgeInsets.only(bottom: 8),
                            child: Align(
                              alignment: Alignment.centerLeft,
                              child: Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: _composerAttachments
                                    .map(
                                      (attachment) => InputChip(
                                        label: Text(
                                          attachment.displayPath,
                                          overflow: TextOverflow.ellipsis,
                                        ),
                                        onDeleted: () {
                                          setState(() {
                                            _composerAttachments.remove(
                                              attachment,
                                            );
                                          });
                                        },
                                      ),
                                    )
                                    .toList(),
                              ),
                            ),
                          ),
                        Row(
                          children: [
                            IconButton(
                              onPressed: _pickFileTag,
                              tooltip: 'Tag file or folder',
                              icon: const Icon(Icons.attach_file),
                            ),
                            Expanded(
                              child: TextField(
                                controller: _controller,
                                minLines: 1,
                                maxLines: 6,
                                decoration: const InputDecoration(
                                  hintText: 'Ask Pi... (use / for commands)',
                                  border: OutlineInputBorder(),
                                ),
                                onSubmitted: (_) => _sendPrompt(),
                              ),
                            ),
                            const SizedBox(width: 8),
                            if (_busy)
                              IconButton(
                                onPressed: _abort,
                                icon: const Icon(Icons.stop_circle_outlined),
                                tooltip: 'Stop',
                              )
                            else
                              IconButton(
                                onPressed: _sendPrompt,
                                icon: const Icon(Icons.send),
                                tooltip: 'Send',
                              ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
        ],
      ),
    );
  }
}

class _PiHeader extends StatelessWidget {
  const _PiHeader({required this.state, required this.cwd});

  final PiState state;
  final String cwd;

  @override
  Widget build(BuildContext context) {
    final model = state.model;

    return Container(
      width: double.infinity,
      margin: const EdgeInsets.fromLTRB(12, 8, 12, 4),
      padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.surface.withValues(alpha: 0.82),
        borderRadius: BorderRadius.circular(12),
      ),
      child: Wrap(
        spacing: 10,
        runSpacing: 6,
        children: [
          _Chip(
            label: model != null ? '${model.provider}/${model.id}' : 'No model',
          ),
          _Chip(label: 'Thinking: ${state.thinkingLevel.displayName}'),
          _Chip(label: 'Queue: ${state.steeringMode}/${state.followUpMode}'),
          _Chip(label: 'Retry: ${state.autoRetryEnabled ? 'on' : 'off'}'),
          if (state.isRetrying) const _Chip(label: 'Retrying…'),
          _Chip(label: 'Messages: ${state.messageCount}'),
          _Chip(label: 'Pending: ${state.pendingMessageCount}'),
          _Chip(label: 'CWD: $cwd'),
        ],
      ),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label});
  final String label;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(
        color: Theme.of(context).colorScheme.primary.withValues(alpha: 0.12),
        borderRadius: BorderRadius.circular(999),
      ),
      child: Text(
        label,
        style: const TextStyle(fontSize: 12, fontWeight: FontWeight.w500),
      ),
    );
  }
}

class _PiBubble extends StatelessWidget {
  const _PiBubble({required this.entry});

  final _PiEntry entry;

  @override
  Widget build(BuildContext context) {
    final scheme = Theme.of(context).colorScheme;

    Color bg;
    Color fg;
    CrossAxisAlignment align;

    switch (entry.role) {
      case _PiRole.user:
        bg = scheme.primary;
        fg = scheme.onPrimary;
        align = CrossAxisAlignment.end;
        break;
      case _PiRole.assistant:
        bg = scheme.surface.withValues(alpha: 0.92);
        fg = scheme.onSurface;
        align = CrossAxisAlignment.start;
        break;
      case _PiRole.error:
        bg = scheme.errorContainer;
        fg = scheme.onErrorContainer;
        align = CrossAxisAlignment.start;
        break;
      case _PiRole.system:
        bg = scheme.surfaceContainerHighest.withValues(alpha: 0.85);
        fg = scheme.onSurfaceVariant;
        align = CrossAxisAlignment.start;
        break;
    }

    return Column(
      crossAxisAlignment: align,
      children: [
        Container(
          margin: const EdgeInsets.only(bottom: 8),
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 10),
          decoration: BoxDecoration(
            color: bg,
            borderRadius: BorderRadius.circular(12),
          ),
          child: SelectableText(entry.text, style: TextStyle(color: fg)),
        ),
      ],
    );
  }
}

enum _PiRole { user, assistant, system, error }

class _PiEntry {
  const _PiEntry({required this.role, required this.text, this.timestampMs});

  final _PiRole role;
  final String text;
  final int? timestampMs;

  factory _PiEntry.user({required String text, int? timestampMs}) =>
      _PiEntry(role: _PiRole.user, text: text, timestampMs: timestampMs);

  factory _PiEntry.assistant({required String text, int? timestampMs}) =>
      _PiEntry(role: _PiRole.assistant, text: text, timestampMs: timestampMs);

  factory _PiEntry.system({required String text, int? timestampMs}) =>
      _PiEntry(role: _PiRole.system, text: text, timestampMs: timestampMs);

  factory _PiEntry.error({required String text, int? timestampMs}) =>
      _PiEntry(role: _PiRole.error, text: text, timestampMs: timestampMs);
}
