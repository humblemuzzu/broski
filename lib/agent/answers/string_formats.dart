import 'package:broski/agent/answers/url/url_can_parse.dart';
import 'package:broski/contract/generated/contract.dart';

final _email = RegExp(r'^[^\s@]+@[^\s@]+\.[^\s@]+$');
final _date = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$');
final _dateTime = RegExp(
  r'^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-](\d{2}):(\d{2}))$',
  caseSensitive: false,
);

/// Whether [text] is a valid [format], as `field-check.ts` judges it: an email
/// with a dotted domain, a URI the WHATWG parser takes, a real calendar day,
/// an RFC 3339 date-time with an offset.
bool matchesFormat(StringFormat format, String text) => switch (format) {
  StringFormat.email => _email.hasMatch(text),
  StringFormat.uri => urlCanParse(text),
  StringFormat.date => switch (_date.firstMatch(text)) {
    null => false,
    final date => _isCalendarDate(date[1], date[2], date[3]),
  },
  StringFormat.dateTime => switch (_dateTime.firstMatch(text)) {
    null => false,
    final time =>
      _isCalendarDate(time[1], time[2], time[3]) &&
          _within(time[4], 23) &&
          _within(time[5], 59) &&
          _within(time[6], 60) &&
          _within(time[7], 23) &&
          _within(time[8], 59),
  },
};

/// A real day of the proleptic Gregorian calendar: "2026-02-30" is not one.
bool _isCalendarDate(String? year, String? month, String? day) {
  if (year == null || month == null || day == null) return false;
  final y = int.parse(year);
  final m = int.parse(month);
  final d = int.parse(day);
  final date = DateTime.utc(y, m, d);
  return date.year == y && date.month == m && date.day == d;
}

/// An absent group, as the offset is for `Z`, is within any bound.
bool _within(String? group, int max) =>
    group == null || int.parse(group) <= max;
