String normalizeProjectPath(String? value) {
  var path = (value ?? '').trim();
  if (path.isEmpty) return '';

  path = path.replaceAll('\\', '/');
  path = path.replaceAll(RegExp(r'/+'), '/');

  if (path.length > 1 && path.endsWith('/')) {
    path = path.substring(0, path.length - 1);
  }

  return path;
}

List<String> _pathVariants(String path) {
  final normalized = normalizeProjectPath(path);
  if (normalized.isEmpty) return const [];

  final variants = <String>{normalized};

  // macOS often exposes /private/var while some tools return /var.
  if (normalized.startsWith('/private/')) {
    variants.add(normalized.substring('/private'.length));
  }
  if (normalized.startsWith('/var/')) {
    variants.add('/private$normalized');
  }

  return variants.toList();
}

List<String> _segments(String path) {
  return normalizeProjectPath(
    path,
  ).split('/').where((s) => s.isNotEmpty).toList(growable: false);
}

String _tail(String path, int count) {
  final segs = _segments(path);
  if (segs.isEmpty) return '';
  final start = segs.length - count;
  final slice = segs.sublist(start < 0 ? 0 : start);
  return slice.join('/').toLowerCase();
}

bool _prefixOrEqual(String a, String b) {
  if (a == b) return true;
  return a.startsWith('$b/') || b.startsWith('$a/');
}

bool projectPathMatches(String candidatePath, String? selectedPath) {
  if (selectedPath == null) return true;

  final candidateNorm = normalizeProjectPath(candidatePath);
  final selectedNorm = normalizeProjectPath(selectedPath);

  if (candidateNorm.isEmpty || selectedNorm.isEmpty) {
    return candidateNorm == selectedNorm;
  }

  final candidateVariants = _pathVariants(
    candidateNorm,
  ).map((p) => p.toLowerCase()).toList(growable: false);
  final selectedVariants = _pathVariants(
    selectedNorm,
  ).map((p) => p.toLowerCase()).toList(growable: false);

  for (final candidate in candidateVariants) {
    for (final selected in selectedVariants) {
      if (_prefixOrEqual(candidate, selected)) return true;
    }
  }

  // Fallback: match stable path tails to survive workspace-root differences
  // (e.g. symlinked root, mounted dev dirs).
  final candidateTail2 = _tail(candidateNorm, 2);
  final selectedTail2 = _tail(selectedNorm, 2);
  if (candidateTail2.isNotEmpty && candidateTail2 == selectedTail2) {
    return true;
  }

  final candidateTail1 = _tail(candidateNorm, 1);
  final selectedTail1 = _tail(selectedNorm, 1);
  if (candidateTail1.isNotEmpty && candidateTail1 == selectedTail1) {
    return true;
  }

  return false;
}
