import 'package:csv/csv.dart';
import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

import '../../theme/opencode_theme.dart';

class CsvFileViewer extends StatefulWidget {
  const CsvFileViewer({
    super.key,
    required this.content,
    required this.filename,
  });

  final String content;
  final String filename;

  @override
  State<CsvFileViewer> createState() => _CsvFileViewerState();
}

class _CsvFileViewerState extends State<CsvFileViewer> {
  late List<List<dynamic>> _rows;
  bool _hasHeader = true;

  @override
  void initState() {
    super.initState();
    _parseCSV();
  }

  void _parseCSV() {
    const converter = CsvToListConverter();
    _rows = converter.convert(widget.content);
  }

  @override
  Widget build(BuildContext context) {
    final theme = OpenCodeTheme.of(context);

    if (_rows.isEmpty) {
      return Center(
        child: Column(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Icon(Icons.table_chart_outlined, size: 64, color: theme.textMuted),
            const SizedBox(height: 16),
            Text('Empty CSV file', style: TextStyle(color: theme.textMuted)),
          ],
        ),
      );
    }

    final headerRow = _hasHeader && _rows.isNotEmpty ? _rows.first : null;
    final dataRows = _hasHeader && _rows.isNotEmpty
        ? _rows.skip(1).toList()
        : _rows;

    return Container(
      color: theme.background,
      child: Column(
        children: [
          Container(
            padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
            color: theme.backgroundPanel,
            child: Row(
              children: [
                Icon(Icons.table_chart, size: 16, color: theme.textMuted),
                const SizedBox(width: 8),
                Text(
                  '${_rows.length} rows × ${_rows.isNotEmpty ? _rows.first.length : 0} columns',
                  style: TextStyle(color: theme.textMuted, fontSize: 12),
                ),
                const Spacer(),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Header row',
                      style: TextStyle(color: theme.textMuted, fontSize: 12),
                    ),
                    const SizedBox(width: 8),
                    Switch(
                      value: _hasHeader,
                      onChanged: (value) => setState(() => _hasHeader = value),
                      activeTrackColor: theme.primary.withValues(alpha: 0.5),
                      thumbColor: WidgetStateProperty.all(theme.primary),
                    ),
                  ],
                ),
              ],
            ),
          ),
          Expanded(
            child: SingleChildScrollView(
              child: SingleChildScrollView(
                scrollDirection: Axis.horizontal,
                child: DataTable(
                  headingRowColor: WidgetStateProperty.all(
                    theme.backgroundPanel,
                  ),
                  dataRowColor: WidgetStateProperty.all(theme.background),
                  border: TableBorder.all(color: theme.borderSubtle, width: 1),
                  columns: headerRow != null
                      ? headerRow
                            .map(
                              (cell) => DataColumn(
                                label: Text(
                                  cell.toString(),
                                  style: GoogleFonts.inter(
                                    fontWeight: FontWeight.w600,
                                    color: theme.text,
                                    fontSize: 13,
                                  ),
                                ),
                              ),
                            )
                            .toList()
                      : List.generate(
                          _rows.isNotEmpty ? _rows.first.length : 0,
                          (index) => DataColumn(
                            label: Text(
                              'Column ${index + 1}',
                              style: GoogleFonts.inter(
                                fontWeight: FontWeight.w600,
                                color: theme.text,
                                fontSize: 13,
                              ),
                            ),
                          ),
                        ),
                  rows: dataRows
                      .map(
                        (row) => DataRow(
                          cells: row
                              .map(
                                (cell) => DataCell(
                                  Text(
                                    cell.toString(),
                                    style: GoogleFonts.jetBrainsMono(
                                      fontSize: 12,
                                      color: theme.text,
                                    ),
                                  ),
                                ),
                              )
                              .toList(),
                        ),
                      )
                      .toList(),
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}
