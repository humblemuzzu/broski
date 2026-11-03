/// [items] split into the sections [groupOf] names, in the order each name
/// first appears; items with no name form one section without a title.
List<({String? group, List<T> items})> groupedInOrder<T>(
  List<T> items,
  String? Function(T item) groupOf,
) {
  final sections = <String?, List<T>>{};
  for (final item in items) {
    sections.putIfAbsent(groupOf(item), () => []).add(item);
  }
  return [
    for (final MapEntry(:key, :value) in sections.entries)
      (group: key, items: value),
  ];
}
