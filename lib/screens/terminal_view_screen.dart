import 'dart:async';

import 'package:flutter/material.dart';
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
  late final TerminalController _terminalController;
  StreamSubscription? _outputSubscription;
  bool _isConnected = false;
  bool _isConnecting = true;
  String? _error;

  // Input handling
  final _inputController = TextEditingController();
  final _inputFocusNode = FocusNode();
  String _currentInput = '';

  @override
  void initState() {
    super.initState();
    _terminal = Terminal(maxLines: 10000);
    _terminalController = TerminalController();
    _connectToPty();
  }

  @override
  void dispose() {
    _outputSubscription?.cancel();
    _disconnectPty();
    _inputController.dispose();
    _inputFocusNode.dispose();
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
          WidgetsBinding.instance.addPostFrameCallback((_) {
            _inputFocusNode.requestFocus();
            _sendResize();
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
    if (!_isConnected || data.isEmpty) return;
    final bridge = ref.read(bridgeServiceProvider);
    bridge.sendPtyInput(widget.ptyId, data);
  }

  void _handleInputChanged(String value) {
    // Detect what changed
    if (value.length > _currentInput.length) {
      // Characters added - send the new characters
      final newChars = value.substring(_currentInput.length);
      _sendInput(newChars);
    } else if (value.length < _currentInput.length) {
      // Characters deleted - send backspace for each deleted char
      final deletedCount = _currentInput.length - value.length;
      for (int i = 0; i < deletedCount; i++) {
        _sendInput('\x7f'); // DEL character
      }
    }
    _currentInput = value;
  }

  void _handleInputSubmitted(String value) {
    // Send enter key
    _sendInput('\r');
    // Clear the input field
    _inputController.clear();
    _currentInput = '';
  }

  void _sendResize() {
    const rows = 24;
    const cols = 80;
    final bridge = ref.read(bridgeServiceProvider);
    final selection = ref.read(selectionProvider);
    bridge.resizePty(
      widget.ptyId,
      rows,
      cols,
      projectPath: selection.project?.path,
    );
  }

  void _sendSpecialKey(String key) {
    switch (key) {
      case 'tab':
        _sendInput('\t');
        break;
      case 'escape':
        _sendInput('\x1b');
        break;
      case 'up':
        _sendInput('\x1b[A');
        break;
      case 'down':
        _sendInput('\x1b[B');
        break;
      case 'left':
        _sendInput('\x1b[D');
        break;
      case 'right':
        _sendInput('\x1b[C');
        break;
      case 'ctrl+c':
        _sendInput('\x03');
        break;
      case 'ctrl+d':
        _sendInput('\x04');
        break;
      case 'ctrl+z':
        _sendInput('\x1a');
        break;
      case 'ctrl+l':
        _sendInput('\x0c');
        break;
    }
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

    return Column(
      children: [
        // Terminal output display
        Expanded(
          child: Container(
            color: ocTheme.background,
            padding: const EdgeInsets.all(8),
            child: TerminalView(
              _terminal,
              controller: _terminalController,
              theme: _buildTerminalTheme(ocTheme),
              textStyle: const TerminalStyle(
                fontSize: 13,
                fontFamily: 'JetBrains Mono',
              ),
              readOnly: true, // Make it read-only, we handle input separately
            ),
          ),
        ),

        // Special keys bar
        Container(
          color: ocTheme.backgroundPanel,
          padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
          child: SingleChildScrollView(
            scrollDirection: Axis.horizontal,
            child: Row(
              children: [
                _SpecialKeyButton(
                  label: 'Tab',
                  onTap: () => _sendSpecialKey('tab'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  label: 'Esc',
                  onTap: () => _sendSpecialKey('escape'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  icon: Icons.arrow_upward,
                  onTap: () => _sendSpecialKey('up'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  icon: Icons.arrow_downward,
                  onTap: () => _sendSpecialKey('down'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  icon: Icons.arrow_back,
                  onTap: () => _sendSpecialKey('left'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  icon: Icons.arrow_forward,
                  onTap: () => _sendSpecialKey('right'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  label: 'Ctrl+C',
                  onTap: () => _sendSpecialKey('ctrl+c'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  label: 'Ctrl+D',
                  onTap: () => _sendSpecialKey('ctrl+d'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  label: 'Ctrl+Z',
                  onTap: () => _sendSpecialKey('ctrl+z'),
                  ocTheme: ocTheme,
                ),
                _SpecialKeyButton(
                  label: 'Clear',
                  onTap: () => _sendSpecialKey('ctrl+l'),
                  ocTheme: ocTheme,
                ),
              ],
            ),
          ),
        ),

        // Input field
        Container(
          color: ocTheme.backgroundPanel,
          padding: const EdgeInsets.fromLTRB(12, 8, 12, 12),
          child: SafeArea(
            top: false,
            child: Row(
              children: [
                Text(
                  '\$',
                  style: TextStyle(
                    color: ocTheme.primary,
                    fontSize: 16,
                    fontWeight: FontWeight.bold,
                    fontFamily: 'JetBrains Mono',
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    controller: _inputController,
                    focusNode: _inputFocusNode,
                    onChanged: _handleInputChanged,
                    onSubmitted: _handleInputSubmitted,
                    style: TextStyle(
                      color: ocTheme.text,
                      fontSize: 14,
                      fontFamily: 'JetBrains Mono',
                    ),
                    decoration: InputDecoration(
                      hintText: 'Type command...',
                      hintStyle: TextStyle(color: ocTheme.textMuted),
                      filled: true,
                      fillColor: ocTheme.background,
                      contentPadding: const EdgeInsets.symmetric(
                        horizontal: 12,
                        vertical: 10,
                      ),
                      border: OutlineInputBorder(
                        borderRadius: BorderRadius.circular(8),
                        borderSide: BorderSide.none,
                      ),
                    ),
                    autocorrect: false,
                    enableSuggestions: false,
                    textInputAction: TextInputAction.send,
                  ),
                ),
                const SizedBox(width: 8),
                IconButton(
                  onPressed: () => _handleInputSubmitted(_inputController.text),
                  icon: Icon(Icons.send, color: ocTheme.primary),
                  tooltip: 'Send',
                ),
              ],
            ),
          ),
        ),
      ],
    );
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

class _SpecialKeyButton extends StatelessWidget {
  const _SpecialKeyButton({
    this.label,
    this.icon,
    required this.onTap,
    required this.ocTheme,
  });

  final String? label;
  final IconData? icon;
  final VoidCallback onTap;
  final OpenCodeTheme ocTheme;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(right: 6),
      child: Material(
        color: ocTheme.background,
        borderRadius: BorderRadius.circular(6),
        child: InkWell(
          onTap: onTap,
          borderRadius: BorderRadius.circular(6),
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 6),
            child: icon != null
                ? Icon(icon, size: 16, color: ocTheme.textMuted)
                : Text(
                    label!,
                    style: TextStyle(
                      color: ocTheme.textMuted,
                      fontSize: 12,
                      fontFamily: 'JetBrains Mono',
                    ),
                  ),
          ),
        ),
      ),
    );
  }
}
