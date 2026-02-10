import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:xterm/xterm.dart';

import '../models/terminal_settings.dart';
import '../providers/selection_provider.dart';
import '../providers/service_providers.dart';
import '../providers/terminal_settings_provider.dart';
import '../screens/terminal_settings_screen.dart';
import '../theme/design_tokens.dart';
import '../theme/opencode_theme.dart';
import '../utils/input_batcher.dart' show SmartInputBatcher;
import '../utils/terminal_output_throttler.dart' show SmartOutputThrottler;
import '../widgets/terminal_quick_toolbar.dart';
import '../widgets/terminal_selection_overlay.dart';

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
  late Terminal _terminal;
  late final TerminalController _terminalController;
  final _terminalViewKey = GlobalKey<TerminalViewState>();
  final _terminalFocusNode = FocusNode();
  StreamSubscription? _outputSubscription;
  bool _isConnected = false;
  bool _isConnecting = true;
  String? _error;

  late SmartInputBatcher _inputBatcher;
  late SmartOutputThrottler _outputThrottler;

  Timer? _resizeDebounce;
  int? _lastSentRows;
  int? _lastSentCols;
  Map<String, dynamic>? _lastHealth;

  TerminalSettings? _appliedSettings;
  bool _normalizeSmartQuotesEnabled = true;

  @override
  void initState() {
    super.initState();
    _terminalController = TerminalController();
    _inputBatcher = SmartInputBatcher(onFlush: _sendInput);
    _terminal = Terminal(maxLines: 10000);
    _terminal.onOutput = (data) =>
        _inputBatcher.add(_normalizeTerminalInput(data));
    _terminal.onResize = (cols, rows, _, __) => _scheduleResize(rows, cols);
    _outputThrottler = SmartOutputThrottler(onFlush: _terminal.write);
    _connectToPty();
  }

  @override
  void dispose() {
    _outputSubscription?.cancel();
    _disconnectPty();
    _resizeDebounce?.cancel();
    _inputBatcher.dispose();
    _outputThrottler.dispose();
    _terminalFocusNode.dispose();
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
            _outputThrottler.add(data);
          }
        } else if (event['type'] == 'pty_exit') {
          _outputThrottler.flush();
          setState(() {
            _isConnected = false;
            _error = 'Terminal session ended (exit code: ${event['exitCode']})';
          });
        } else if (event['type'] == 'pty_error') {
          if (!mounted) return;
          final msg = event['error']?.toString() ?? 'Terminal error';
          final ocTheme = OpenCodeTheme.of(context);
          ScaffoldMessenger.of(context).showSnackBar(
            SnackBar(content: Text(msg), backgroundColor: ocTheme.error),
          );
        } else if (event['type'] == 'pty_health') {
          _lastHealth = event;
          if (mounted) setState(() {});
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
            _terminalFocusNode.requestFocus();
            _terminalViewKey.currentState?.requestKeyboard();
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

  void _scheduleResize(int rows, int cols) {
    if (!_isConnected) return;
    if (rows <= 0 || cols <= 0) return;
    if (_lastSentRows == rows && _lastSentCols == cols) return;

    _resizeDebounce?.cancel();
    _resizeDebounce = Timer(const Duration(milliseconds: 100), () {
      if (!_isConnected) return;
      if (_lastSentRows == rows && _lastSentCols == cols) return;
      _lastSentRows = rows;
      _lastSentCols = cols;
      final bridge = ref.read(bridgeServiceProvider);
      final selection = ref.read(selectionProvider);
      bridge.resizePty(
        widget.ptyId,
        rows,
        cols,
        projectPath: selection.project?.path,
      );
    });
  }

  void _applySettings(TerminalSettings settings) {
    _appliedSettings = settings;
    _normalizeSmartQuotesEnabled = settings.normalizeSmartQuotes;

    // Recreate terminal if maxLines changed
    if (_terminal.maxLines != settings.maxLines) {
      _outputThrottler.flush();
      _outputThrottler.dispose();
      _terminal = Terminal(maxLines: settings.maxLines);
      _terminal.onOutput = (data) =>
          _inputBatcher.add(_normalizeTerminalInput(data));
      _terminal.onResize = (cols, rows, _, __) => _scheduleResize(rows, cols);
      _outputThrottler = SmartOutputThrottler(onFlush: _terminal.write);
      if (mounted) setState(() {});
    }

    // Smart batchers are self-tuning - no manual config needed!
    // They automatically:
    // - Send single keystrokes INSTANTLY
    // - Batch only during rapid typing or paste
    // - Throttle output only during floods (cat bigfile, npm install)
  }

  String _normalizeTerminalInput(String data) {
    if (!_normalizeSmartQuotesEnabled || data.isEmpty) return data;
    // iOS smart punctuation can emit curly quotes which break shells.
    return data
        .replaceAll('\u201C', '"')
        .replaceAll('\u201D', '"')
        .replaceAll('\u2018', "'")
        .replaceAll('\u2019', "'");
  }

  @override
  Widget build(BuildContext context) {
    final ocTheme = OpenCodeTheme.of(context);
    final terminalSettings = ref.watch(terminalSettingsProvider);
    if (_appliedSettings != terminalSettings) {
      _applySettings(terminalSettings);
    }

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
            SizedBox(width: Spacing.sm),
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
              Builder(
                builder: (context) {
                  final isResponsive =
                      (_lastHealth?['isResponsive'] as bool?) ?? true;
                  final color = isResponsive
                      ? ocTheme.success
                      : ocTheme.warning;
                  final label = isResponsive ? 'Connected' : 'Stalled';
                  return Container(
                    padding: const EdgeInsets.symmetric(
                      horizontal: 8,
                      vertical: 4,
                    ),
                    decoration: BoxDecoration(
                      color: color.withValues(alpha: 0.15),
                      borderRadius: Radii.brSm,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Container(
                          width: 6,
                          height: 6,
                          decoration: BoxDecoration(
                            color: color,
                            shape: BoxShape.circle,
                          ),
                        ),
                        const SizedBox(width: 6),
                        Text(
                          label,
                          style: TextStyle(
                            color: color,
                            fontSize: 12,
                            fontWeight: FontWeight.w500,
                          ),
                        ),
                      ],
                    ),
                  );
                },
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
          IconButton(
            icon: Icon(Icons.tune, color: ocTheme.textMuted),
            onPressed: () {
              Navigator.of(context).push(
                MaterialPageRoute(
                  builder: (_) => const TerminalSettingsScreen(),
                ),
              );
            },
            tooltip: 'Terminal settings',
          ),
        ],
      ),
      body: _buildBody(ocTheme, terminalSettings),
    );
  }

  Widget _buildBody(OpenCodeTheme ocTheme, TerminalSettings settings) {
    if (_isConnecting) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            CircularProgressIndicator(color: ocTheme.primary),
            SizedBox(height: Spacing.lg),
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
            SizedBox(height: Spacing.lg),
            Text(
              'Connection Failed',
              style: TextStyle(
                color: ocTheme.text,
                fontSize: 18,
                fontWeight: FontWeight.w600,
              ),
            ),
            SizedBox(height: Spacing.sm),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 32),
              child: Text(
                _error!,
                style: TextStyle(color: ocTheme.textMuted),
                textAlign: TextAlign.center,
              ),
            ),
            SizedBox(height: Spacing.xxl),
            ElevatedButton.icon(
              onPressed: _connectToPty,
              icon: const Icon(Icons.refresh, size: 18),
              label: const Text('Retry'),
              style: ElevatedButton.styleFrom(
                backgroundColor: ocTheme.primary,
                foregroundColor: ocTheme.selectedListItemText,
              ),
            ),
          ],
        ),
      );
    }

    final bottomOverlayPadding = settings.showQuickToolbar ? 56.0 : 0.0;

    return Column(
      children: [
        Expanded(
          child: Container(
            color: ocTheme.background,
            padding: Insets.cardXs,
            child: Stack(
              children: [
                TerminalView(
                  key: _terminalViewKey,
                  _terminal,
                  controller: _terminalController,
                  theme: _buildTerminalTheme(ocTheme),
                  textStyle: TerminalStyle(
                    fontSize: settings.fontSize,
                    fontFamily: settings.fontFamily,
                  ),
                  focusNode: _terminalFocusNode,
                  autofocus: true,
                  keyboardType: TextInputType.text,
                  deleteDetection: settings.deleteDetection,
                  hardwareKeyboardOnly: settings.hardwareKeyboardOnly,
                  readOnly: false,
                ),
                if (settings.showSelectionToolbar)
                  TerminalSelectionOverlay(
                    terminal: _terminal,
                    controller: _terminalController,
                    bottomPadding: bottomOverlayPadding,
                  ),
              ],
            ),
          ),
        ),
        if (settings.showQuickToolbar)
          TerminalQuickToolbar(terminal: _terminal),
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
