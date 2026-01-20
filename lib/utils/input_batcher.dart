import 'dart:async';

typedef InputFlushCallback = void Function(String data);

/// Smart input batcher that provides INSTANT response for normal typing
/// while batching only rapid input (fast typing, pastes).
///
/// Key insight: Users notice latency on single keystrokes, but won't notice
/// 8ms batching when typing at 100+ WPM or pasting.
class SmartInputBatcher {
  SmartInputBatcher({
    required this.onFlush,
    this.rapidTypingThresholdMs = 50,
    this.batchWindowMs = 8,
    this.pasteThreshold = 3,
    this.immediateFlushChars = const {'\r', '\t', '\x03', '\x04', '\x1b'},
  });

  final InputFlushCallback onFlush;

  /// If two inputs arrive within this time, we're in "rapid mode"
  int rapidTypingThresholdMs;

  /// How long to batch in rapid mode (lower = more responsive)
  int batchWindowMs;

  /// If input length >= this, treat as paste (batch it)
  int pasteThreshold;

  /// These chars always flush immediately (Enter, Tab, Ctrl+C, Ctrl+D, Esc)
  final Set<String> immediateFlushChars;

  final StringBuffer _buffer = StringBuffer();
  Timer? _batchTimer;
  DateTime? _lastInputTime;
  bool _inRapidMode = false;

  /// Add input - decides whether to send immediately or batch
  void add(String data) {
    if (data.isEmpty) return;

    final now = DateTime.now();
    final timeSinceLast = _lastInputTime != null
        ? now.difference(_lastInputTime!).inMilliseconds
        : 1000; // First input = not rapid
    _lastInputTime = now;

    // Check if we should flush immediately
    if (_shouldFlushImmediately(data)) {
      // Flush any pending buffer first
      if (_buffer.isNotEmpty) {
        _flushBuffer();
      }
      // Then send this data immediately
      onFlush(data);
      _inRapidMode = false;
      return;
    }

    // Detect rapid typing or paste
    final isPaste = data.length >= pasteThreshold;
    final isRapidTyping = timeSinceLast < rapidTypingThresholdMs;

    if (isPaste || isRapidTyping) {
      // RAPID MODE: Batch for efficiency
      _inRapidMode = true;
      _buffer.write(data);
      _scheduleBatchFlush();
    } else {
      // NORMAL MODE: Send immediately for instant feedback
      _inRapidMode = false;
      // Flush any pending rapid-mode buffer first
      if (_buffer.isNotEmpty) {
        _flushBuffer();
      }
      // Send this char immediately
      onFlush(data);
    }
  }

  bool _shouldFlushImmediately(String data) {
    for (final char in immediateFlushChars) {
      if (data.contains(char)) return true;
    }
    return false;
  }

  void _scheduleBatchFlush() {
    _batchTimer?.cancel();
    _batchTimer = Timer(Duration(milliseconds: batchWindowMs), _flushBuffer);
  }

  void _flushBuffer() {
    _batchTimer?.cancel();
    _batchTimer = null;

    if (_buffer.isEmpty) return;

    final data = _buffer.toString();
    _buffer.clear();
    onFlush(data);
  }

  /// Force flush any pending data
  void flush() {
    _flushBuffer();
  }

  void dispose() {
    _batchTimer?.cancel();
    _batchTimer = null;
    _buffer.clear();
  }

  /// For debugging
  bool get isInRapidMode => _inRapidMode;
  bool get hasPendingData => _buffer.isNotEmpty;
}
