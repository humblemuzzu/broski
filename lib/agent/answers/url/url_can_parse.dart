import 'package:broski/agent/answers/url/url_host.dart';

const _special = {'ftp', 'file', 'http', 'https', 'ws', 'wss'};
const _slash = 0x2f;
const _backslash = 0x5c;
const _colon = 0x3a;
const _at = 0x40;

/// Whether the WHATWG URL parser parses [input] with no base, which is what
/// `URL.canParse` answers for the contract's `uri` format. Only the outcome is
/// computed: every step that can fail is followed, nothing is built. Hosts are
/// checked by `url_host.dart`, which approximates IDNA for non-ASCII names.
bool urlCanParse(String input) {
  final points = _prepared(input);
  final schemeEnd = _schemeEnd(points);
  if (schemeEnd == null) return false;
  final scheme = String.fromCharCodes(points.sublist(0, schemeEnd));
  final rest = points.sublist(schemeEnd + 1);
  final lower = scheme.toLowerCase();
  if (lower == 'file') return _fileParses(rest);
  if (_special.contains(lower)) return _specialParses(rest);
  return _nonSpecialParses(rest);
}

/// Leading and trailing C0 controls and spaces go, and every tab or newline.
List<int> _prepared(String input) {
  final points = input.runes.toList();
  var start = 0;
  var end = points.length;
  while (start < end && points[start] <= 0x20) {
    start++;
  }
  while (end > start && points[end - 1] <= 0x20) {
    end--;
  }
  return [
    for (final point in points.sublist(start, end))
      if (point != 0x09 && point != 0x0a && point != 0x0d) point,
  ];
}

/// The index of the colon ending a valid scheme, or null when there is none.
int? _schemeEnd(List<int> points) {
  if (points.isEmpty || !_isAlpha(points.first)) return null;
  for (var index = 1; index < points.length; index++) {
    final point = points[index];
    if (point == _colon) return index;
    if (!_isAlpha(point) && !_isDigit(point) && !'+-.'.runes.contains(point)) {
      return null;
    }
  }
  return null;
}

bool _specialParses(List<int> rest) {
  var start = 0;
  while (start < rest.length &&
      (rest[start] == _slash || rest[start] == _backslash)) {
    start++;
  }
  final end = _authorityEnd(rest, start, special: true);
  return _authorityParses(rest.sublist(start, end), special: true);
}

bool _nonSpecialParses(List<int> rest) {
  if (rest.length < 2 || rest[0] != _slash || rest[1] != _slash) return true;
  final end = _authorityEnd(rest, 2, special: false);
  return _authorityParses(rest.sublist(2, end), special: false);
}

bool _fileParses(List<int> rest) {
  bool isSlash(int index) =>
      index < rest.length &&
      (rest[index] == _slash || rest[index] == _backslash);
  if (!isSlash(0) || !isSlash(1)) return true;
  final host = rest.sublist(2, _authorityEnd(rest, 2, special: true));
  final driveLetter =
      host.length == 2 &&
      _isAlpha(host[0]) &&
      (host[1] == _colon || host[1] == 0x7c);
  if (driveLetter || host.isEmpty) return true;
  return hostParses(String.fromCharCodes(host), special: true);
}

int _authorityEnd(List<int> points, int start, {required bool special}) {
  for (var index = start; index < points.length; index++) {
    final point = points[index];
    if (point == _slash || point == 0x3f || point == 0x23) return index;
    if (special && point == _backslash) return index;
  }
  return points.length;
}

/// Credentials end at the last `@`; what follows is the host and port.
bool _authorityParses(List<int> authority, {required bool special}) {
  final at = authority.lastIndexOf(_at);
  final hostPort = at < 0 ? authority : authority.sublist(at + 1);
  if (at >= 0 && hostPort.isEmpty) return false;
  var insideBrackets = false;
  for (var index = 0; index < hostPort.length; index++) {
    final point = hostPort[index];
    if (point == _colon && !insideBrackets) {
      if (index == 0) return false;
      final host = String.fromCharCodes(hostPort.sublist(0, index));
      return hostParses(host, special: special) &&
          _portParses(hostPort.sublist(index + 1));
    }
    if (point == 0x5b) insideBrackets = true;
    if (point == 0x5d) insideBrackets = false;
  }
  if (special && hostPort.isEmpty) return false;
  return hostParses(String.fromCharCodes(hostPort), special: special);
}

bool _portParses(List<int> port) {
  var value = 0;
  for (final point in port) {
    if (!_isDigit(point)) return false;
    value = value * 10 + point - 0x30;
    if (value > 0xffff) return false;
  }
  return true;
}

bool _isAlpha(int point) =>
    (point >= 0x41 && point <= 0x5a) || (point >= 0x61 && point <= 0x7a);

bool _isDigit(int point) => point >= 0x30 && point <= 0x39;
