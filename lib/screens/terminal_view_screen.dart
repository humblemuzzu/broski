import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';

import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../theme/opencode_theme.dart';

class TerminalViewScreen extends ConsumerStatefulWidget {
  const TerminalViewScreen({
    super.key,
    required this.ptyId,
    required this.title,
  });

  final String ptyId;
  final String title;

  @override
  ConsumerState<TerminalViewScreen> createState() => _TerminalViewScreenState();
}

class _TerminalViewScreenState extends ConsumerState<TerminalViewScreen> {
  late final Terminal _terminal;
  StreamSubscription? _outputSubscription;
  bool _isConnected = false;
  bool _isConnecting = true;
  String? _error;
  final _focusNode = FocusNode();

  @override
  void initState() {
    super.initState();
    _terminal = Terminal(maxLines: 10000);
    _terminal.onOutput = _sendInput;
    _connectToPty();
  }

  @override
  void dispose() {
    _outputSubscription?.cancel();
    _disconnectPty();
    _focusNode.dispose();
    super.dispose();
  }

  Future<void> _connectToPty() async {
    setState(() {
      _isConnecting = true;
      _error = null;
    });

    try {
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);

      _outputSubscription = bridge.ptyEvents.listen((event) {
        if (event['ptyId'] != widget.ptyId) return;

        if (event['type'] == 'pty_output') {
          final data = event['data'] as String? ?? '';
          if (data.isNotEmpty) {
            _terminal.write(data);
          }
        } else if (event['type'] == 'pty_exit') {
          setState(() {
            _isConnected = false;
            _error = 'Terminal session ended (exit code: ${event['exitCode']})';
          });
        }
      });

      final connected = await bridge.connectPty(
        widget.ptyId,
        projectPath: selection.project?.path,
      );

      if (mounted) {
        setState(() {
          _isConnected = connected;
          _isConnecting = false;
          if (!connected) {
            _error = 'Failed to connect to terminal';
          }
        });

        if (connected) {
          _terminal.write('\x1b[2J\x1b[H');
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _focusNode.requestFocus();
          });
        }
      }
    } catch (e) {
      if (mounted) {
        setState(() {
          _isConnecting = false;
          _error = e.toString();
        });
      }
    }
  }

  void _disconnectPty() {
    final bridge = ref.read(bridgeServiceProvider);
    bridge.disconnectPty(widget.ptyId);
  }

  void _sendInput(String data) {
    if (!_isConnected) return;
    final bridge = ref.read(bridgeServiceProvider);
    bridge.sendPtyInput(widget.ptyId, data);
  }

  void _handleResize(int rows, int cols) {
    if (!_isConnected) return;
    final bridge = ref.read(bridgeServiceProvider);
    final selection = ref.read(selectionProvider);
    bridge.resizePty(
      widget.ptyId,
      rows,
      cols,
      projectPath: selection.project?.path,
    );
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);

    return Scaffold(
      backgroundColor: ocTheme.background,
      appBar: AppBar(
        backgroundColor: ocTheme.background,
        elevation: 0,
        leading: IconButton(
          icon: Icon(Icons.arrow_back, color: ocTheme.text),
          onPressed: () => Navigator.of(context).pop(),
        ),
        title: Row(
          children: [
            Icon(Icons.terminal, size: 20, color: ocTheme.primary),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                widget.title,
                style: TextStyle(
                  fontSize: 16,
                  fontWeight: FontWeight.w600,
                  color: ocTheme.text,
                ),
                overflow: TextOverflow.ellipsis,
              ),
            ),
            if (_isConnected)
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(
                  color: ocTheme.success.withValues(alpha: 0.15),
                  borderRadius: BorderRadius.circular(8),
                ),
                child: Row(
                  mainAxisSize: MainAxisSize.min,
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
                      'Connected',
                      style: TextStyle(
                        color: ocTheme.success,
                        fontSize: 12,
                        fontWeight: FontWeight.w500,
                      ),
                    ),
                  ],
                ),
              ),
          ],
        ),
        actions: [
          if (_isConnected)
            IconButton(
              icon: Icon(Icons.refresh, color: ocTheme.textMuted),
              onPressed: _connectToPty,
              tooltip: 'Reconnect',
            ),
        ],
      ),
      body: _buildBody(ocTheme),
    );
  }

  Widget _buildBody(OpenCodeTheme ocTheme) {
    if (_isConnecting) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: ocTheme.primary),
            const SizedBox(height: 16),
            Text(
              'Connecting to terminal...',
              style: TextStyle(color: ocTheme.textMuted),
            ),
          ],
        ),
      );
    }

    if (_error != null && !_isConnected) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.error_outline, size: 48, color: ocTheme.error),
            const SizedBox(height: 16),
            Text(
              'Connection Failed',
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            const SizedBox(height: 8),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                _error!,
                style: TextStyle(color: ocTheme.textMuted),
                textAlign: TextAlign.center,
              ),
            ),
            const SizedBox(height: 24),
            ElevatedButton.icon(
              onPressed: _connectToPty,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: Colors.white,
              ),
            ),
          ],
        ),
      );
    }

    return KeyboardListener(
      focusNode: _focusNode,
      autofocus: true,
      onKeyEvent: _handleKeyEvent,
      child: LayoutBuilder(
        builder: (context, constraints) {
          return GestureDetector(
            onTap: () => _focusNode.requestFocus(),
            child: Container(
              color: ocTheme.background,
              padding: const EdgeInsets.all(8),
              child: TerminalView(
                _terminal,
                theme: _buildTerminalTheme(ocTheme),
                textStyle: const TerminalStyle(
                  fontSize: 14,
                  fontFamily: 'JetBrains Mono',
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  void _handleKeyEvent(KeyEvent event) {
    if (event is! KeyDownEvent && event is! KeyRepeatEvent) return;

    String? data;

    if (event.logicalKey == LogicalKeyboardKey.enter) {
      data = '\r';
    } else if (event.logicalKey == LogicalKeyboardKey.backspace) {
      data = '\x7f';
    } else if (event.logicalKey == LogicalKeyboardKey.tab) {
      data = '\t';
    } else if (event.logicalKey == LogicalKeyboardKey.escape) {
      data = '\x1b';
    } else if (event.logicalKey == LogicalKeyboardKey.arrowUp) {
      data = '\x1b[A';
    } else if (event.logicalKey == LogicalKeyboardKey.arrowDown) {
      data = '\x1b[B';
    } else if (event.logicalKey == LogicalKeyboardKey.arrowRight) {
      data = '\x1b[C';
    } else if (event.logicalKey == LogicalKeyboardKey.arrowLeft) {
      data = '\x1b[D';
    } else if (event.logicalKey == LogicalKeyboardKey.home) {
      data = '\x1b[H';
    } else if (event.logicalKey == LogicalKeyboardKey.end) {
      data = '\x1b[F';
    } else if (event.logicalKey == LogicalKeyboardKey.pageUp) {
      data = '\x1b[5~';
    } else if (event.logicalKey == LogicalKeyboardKey.pageDown) {
      data = '\x1b[6~';
    } else if (event.logicalKey == LogicalKeyboardKey.delete) {
      data = '\x1b[3~';
    } else if (event.character != null && event.character!.isNotEmpty) {
      data = event.character;
    }

    if (data != null) {
      _sendInput(data);
    }
  }

  TerminalTheme _buildTerminalTheme(OpenCodeTheme ocTheme) {
    return TerminalTheme(
      background: ocTheme.background,
      foreground: ocTheme.text,
      cursor: ocTheme.primary,
      selection: ocTheme.primary.withValues(alpha: 0.3),
      black: Colors.black,
      red: ocTheme.error,
      green: ocTheme.success,
      yellow: ocTheme.warning,
      blue: ocTheme.primary,
      magenta: ocTheme.accent,
      cyan: ocTheme.info,
      white: Colors.white,
      brightBlack: Colors.grey,
      brightRed: ocTheme.error,
      brightGreen: ocTheme.success,
      brightYellow: ocTheme.warning,
      brightBlue: ocTheme.primary,
      brightMagenta: ocTheme.accent,
      brightCyan: ocTheme.info,
      brightWhite: Colors.white,
      searchHitBackground: ocTheme.warning.withValues(alpha: 0.3),
      searchHitBackgroundCurrent: ocTheme.warning.withValues(alpha: 0.6),
      searchHitForeground: ocTheme.text,
    );
  }
}
