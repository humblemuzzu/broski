/** The cast every decoder goes through, so a value of the wrong shape is a `FormatException`. */
export const DART_AS = `T _as<T>(Object? value, String path) => value is T
    ? value
    : throw FormatException('$path: expected $T, got \${value.runtimeType}');
`;

/**
 * The Dart every generated part shares, written once into the library file: decoding that fails
 * only with `FormatException`, and deep value equality for lists and maps.
 */
export const DART_RUNTIME = `${DART_AS}
void _expectShape(
  Map<String, Object?> json,
  String owner,
  Set<String> fields,
  Map<String, String> tags,
) {
  for (final key in json.keys) {
    if (!fields.contains(key)) {
      throw FormatException('$owner: unknown field $key');
    }
  }
  for (final MapEntry(:key, :value) in tags.entries) {
    if (json[key] != value) {
      throw FormatException('$owner: $key must be $value');
    }
  }
}

bool _equal(Object? a, Object? b) {
  if (a is List<Object?> && b is List<Object?>) {
    if (a.length != b.length) return false;
    for (var index = 0; index < a.length; index++) {
      if (!_equal(a[index], b[index])) return false;
    }
    return true;
  }
  if (a is Map<String, Object?> && b is Map<String, Object?>) {
    if (a.length != b.length) return false;
    for (final MapEntry(:key, :value) in a.entries) {
      if (!b.containsKey(key) || !_equal(value, b[key])) return false;
    }
    return true;
  }
  return a == b;
}

int _hash(Object? value) => switch (value) {
  final List<Object?> list => Object.hashAll(list.map(_hash)),
  final Map<String, Object?> map => Object.hashAllUnordered(
    map.entries.map((entry) => Object.hash(entry.key, _hash(entry.value))),
  ),
  _ => value.hashCode,
};
`;

export const JSON_VALUE_DECLARATION = `sealed class JsonValue {
  const JsonValue();

  factory JsonValue.fromJson(Object? json) => switch (json) {
    null => const JsonNull(),
    final bool value => JsonBool(value),
    final num value => JsonNumber(value),
    final String value => JsonString(value),
    final List<Object?> value => JsonList([
      for (final item in value) JsonValue.fromJson(item),
    ]),
    final Map<String, Object?> value => JsonObject({
      for (final entry in value.entries) entry.key: JsonValue.fromJson(entry.value),
    }),
    _ => throw FormatException('Not a JSON value: $json'),
  };

  Object? toJson();

  @override
  bool operator ==(Object other) =>
      other is JsonValue && _equal(toJson(), other.toJson());

  @override
  int get hashCode => _hash(toJson());

  @override
  String toString() => 'JsonValue(\${toJson()})';
}

final class JsonNull extends JsonValue {
  const JsonNull();

  @override
  Object? toJson() => null;
}

final class JsonBool extends JsonValue {
  const JsonBool(this.value);

  final bool value;

  @override
  Object? toJson() => value;
}

final class JsonNumber extends JsonValue {
  const JsonNumber(this.value);

  final num value;

  @override
  Object? toJson() => value;
}

final class JsonString extends JsonValue {
  const JsonString(this.value);

  final String value;

  @override
  Object? toJson() => value;
}

final class JsonList extends JsonValue {
  const JsonList(this.value);

  final List<JsonValue> value;

  @override
  Object? toJson() => [for (final item in value) item.toJson()];
}

final class JsonObject extends JsonValue {
  const JsonObject(this.value);

  final Map<String, JsonValue> value;

  @override
  Object? toJson() => {for (final entry in value.entries) entry.key: entry.value.toJson()};
}
`;
