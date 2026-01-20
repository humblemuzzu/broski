import 'dart:async';

typedef InputBatchFlush = void Function(String data);

class InputBatcher {
  InputBatcher({
    required this.onFlush,
    this.batchWindow = const Duration(milliseconds: 16),
    this.maxChars = 1000,
    this.immediateFlushChars = const {'\r', '\t', '\x03', '\x04'},
  });

  final InputBatchFlush onFlush;
  Duration batchWindow;
  int maxChars;

  /// If the buffer contains any of these chars, flush immediately.
  final Set<String> immediateFlushChars;

  final StringBuffer _buffer = StringBuffer();
  Timer? _timer;

  bool get hasBufferedData => _buffer.length > 0;

  void add(String data) {
    if (data.isEmpty) return;

    _buffer.write(data);

    if (_buffer.length >= maxChars || _shouldFlushImmediately(data)) {
      flush();
      return;
    }

    _timer ??= Timer(batchWindow, flush);
  }

  bool _shouldFlushImmediately(String data) {
    for (final ch in immediateFlushChars) {
      if (data.contains(ch)) return true;
    }
    return false;
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
