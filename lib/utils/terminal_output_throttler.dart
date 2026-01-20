import 'dart:async';

typedef OutputFlushCallback = void Function(String data);

/// Smart output throttler that provides INSTANT display for normal output
/// while throttling only high-volume floods (cat bigfile, npm install, etc).
///
/// Key insight: Small outputs (command prompts, single lines) should appear
/// instantly. Only batch when there's a flood that would freeze the UI.
class SmartOutputThrottler {
  SmartOutputThrottler({
    required this.onFlush,
    this.instantThreshold = 500,
    this.floodThresholdBytesPerSec = 10000,
    this.throttleIntervalMs = 16,
    this.maxBufferSize = 256 * 1024,
  });

  final OutputFlushCallback onFlush;

  /// Output chunks smaller than this are written instantly (bytes)
  int instantThreshold;

  /// If we receive more than this per second, switch to throttle mode
  int floodThresholdBytesPerSec;

  /// In throttle mode, flush at this interval (16ms = 60fps)
  int throttleIntervalMs;

  /// Safety limit - flush if buffer exceeds this
  int maxBufferSize;

  final StringBuffer _buffer = StringBuffer();
  Timer? _throttleTimer;

  // Flood detection
  int _bytesThisSecond = 0;
  DateTime? _secondStart;
  bool _inFloodMode = false;

  /// Add output - decides whether to write immediately or throttle
  void add(String data) {
    if (data.isEmpty) return;

    _updateFloodDetection(data.length);

    // Small output + not in flood mode = INSTANT
    if (data.length < instantThreshold && !_inFloodMode) {
      // Flush any pending throttled data first
      if (_buffer.isNotEmpty) {
        _flushBuffer();
      }
      // Write immediately
      onFlush(data);
      return;
    }

    // Large output or flood mode = THROTTLE
    _buffer.write(data);

    // Safety valve
    if (_buffer.length >= maxBufferSize) {
      _flushBuffer();
      return;
    }

    // Schedule throttled flush
    _scheduleThrottleFlush();
  }

  void _updateFloodDetection(int bytes) {
    final now = DateTime.now();

    if (_secondStart == null ||
        now.difference(_secondStart!).inMilliseconds >= 1000) {
      // New second - check if last second was a flood
      _inFloodMode = _bytesThisSecond > floodThresholdBytesPerSec;
      _bytesThisSecond = bytes;
      _secondStart = now;
    } else {
      _bytesThisSecond += bytes;
      // Check mid-second if we've exceeded threshold
      if (_bytesThisSecond > floodThresholdBytesPerSec) {
        _inFloodMode = true;
      }
    }

    // Exit flood mode if we haven't received much data
    if (_inFloodMode && _bytesThisSecond < floodThresholdBytesPerSec ~/ 4) {
      _inFloodMode = false;
    }
  }

  void _scheduleThrottleFlush() {
    if (_throttleTimer != null) return; // Already scheduled

    _throttleTimer = Timer(
      Duration(milliseconds: throttleIntervalMs),
      _flushBuffer,
    );
  }

  void _flushBuffer() {
    _throttleTimer?.cancel();
    _throttleTimer = null;

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
    _throttleTimer?.cancel();
    _throttleTimer = null;
    _buffer.clear();
  }

  /// For debugging
  bool get isInFloodMode => _inFloodMode;
  bool get hasPendingData => _buffer.isNotEmpty;
  int get bytesThisSecond => _bytesThisSecond;
}
