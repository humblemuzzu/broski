import 'package:broski/contract/generated/contract.dart';

/// The last [contractMaxTextChars] UTF-16 units of [text], never starting
/// inside a surrogate pair.
String newestText(String text) {
  if (text.length <= contractMaxTextChars) return text;
  final tail = text.substring(text.length - contractMaxTextChars);
  final first = tail.codeUnitAt(0);
  return first >= 0xdc00 && first <= 0xdfff ? tail.substring(1) : tail;
}
