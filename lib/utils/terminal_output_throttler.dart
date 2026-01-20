import 'dart:async';

typedef TerminalOutputFlush = void Function(String data);

class TerminalOutputThrottler {
  TerminalOutputThrottler({
    required this.onFlush,
    this.batchWindow = const Duration(milliseconds: 16),
    this.maxBufferedChars = 256 * 1024,
    this.enableBinaryDetection = false,
    this.binarySuspicionThreshold = 0.55,
    this.onBinaryDetected,
  });

  final TerminalOutputFlush onFlush;
  Duration batchWindow;

  /// Safety valve: if buffered output exceeds this, flush immediately.
  int maxBufferedChars;

  bool enableBinaryDetection;
  double binarySuspicionThreshold;
  void Function()? onBinaryDetected;

  final StringBuffer _buffer = StringBuffer();
  Timer? _timer;
  bool _binaryAlerted = false;

  void add(String data) {
    if (data.isEmpty) return;

    if (enableBinaryDetection && !_binaryAlerted && _looksBinary(data)) {
      _binaryAlerted = true;
      onBinaryDetected?.call();
    }

    _buffer.write(data);

    if (_buffer.length >= maxBufferedChars) {
      flush();
      return;
    }

    _timer ??= Timer(batchWindow, flush);
  }

  bool _looksBinary(String data) {
    // Best-effort heuristic: ignore common terminal control bytes and whitespace.
    var total = 0;
    var suspicious = 0;
    for (final unit in data.codeUnits) {
      total++;
      final isAllowedControl =
          unit == 0x0A || // \n
          unit == 0x0D || // \r
          unit == 0x09 || // \t
          unit == 0x1B; // ESC (ANSI)
      if (isAllowedControl) continue;

      final isPrintableAscii = unit >= 0x20 && unit != 0x7F;
      if (!isPrintableAscii) suspicious++;
    }
    if (total == 0) return false;
    return (suspicious / total) >= binarySuspicionThreshold;
  }

  void flush() {
    _timer?.cancel();
    _timer = null;

    if (_buffer.length == 0) return;
    final payload = _buffer.toString();
    _buffer.clear();
    onFlush(payload);
  }

  void dispose() {
    _timer?.cancel();
    _timer = null;
    _buffer.clear();
  }
}
