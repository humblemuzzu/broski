import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../providers/service_providers.dart';

Future<String?> showPiFileTagPickerSheet({
  required BuildContext context,
  required String cwd,
}) {
  return showModalBottomSheet<String>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    builder: (_) => _PiFileTagPickerSheet(cwd: cwd),
  );
}

class _PiFileTagPickerSheet extends ConsumerStatefulWidget {
  const _PiFileTagPickerSheet({required this.cwd});

  final String cwd;

  @override
  ConsumerState<_PiFileTagPickerSheet> createState() =>
      _PiFileTagPickerSheetState();
}

class _PiFileTagPickerSheetState extends ConsumerState<_PiFileTagPickerSheet> {
  final _controller = TextEditingController();
  Timer? _debounce;

  bool _loading = false;
  List<String> _results = const [];

  @override
  void initState() {
    super.initState();
    _search('');
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _controller.dispose();
    super.dispose();
  }

  void _onQueryChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 160), () {
      _search(value);
    });
  }

  Future<void> _search(String query) async {
    setState(() => _loading = true);
    try {
      final bridge = ref.read(bridgeServiceProvider);
      final results = await bridge.searchFilesAndDirs(
        query,
        projectPath: widget.cwd,
      );
      if (!mounted) return;
      setState(() {
        _results = results;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _results = const [];
        _loading = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final bottom = MediaQuery.of(context).viewInsets.bottom;

    return SafeArea(
      child: Padding(
        padding: EdgeInsets.fromLTRB(16, 0, 16, bottom + 12),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: _controller,
              autofocus: true,
              onChanged: _onQueryChanged,
              decoration: const InputDecoration(
                hintText: 'Search files or folders to tag',
                prefixIcon: Icon(Icons.search),
              ),
            ),
            const SizedBox(height: 10),
            SizedBox(
              height: 360,
              child: _loading
                  ? const Center(child: CircularProgressIndicator())
                  : _results.isEmpty
                  ? const Center(child: Text('No paths found'))
                  : ListView.separated(
                      itemCount: _results.length,
                      separatorBuilder: (_, __) => const Divider(height: 1),
                      itemBuilder: (context, index) {
                        final path = _results[index];
                        return ListTile(
                          dense: true,
                          leading: Icon(
                            path.endsWith('/')
                                ? Icons.folder_outlined
                                : Icons.description_outlined,
                          ),
                          title: Text(
                            path,
                            maxLines: 2,
                            overflow: TextOverflow.ellipsis,
                          ),
                          onTap: () => Navigator.pop(context, path),
                        );
                      },
                    ),
            ),
          ],
        ),
      ),
    );
  }
}
