import 'package:csv/csv.dart';
import 'package:flutter/material.dart';
import '../../theme/app_typography.dart';

import '../../theme/design_tokens.dart';
import '../../theme/opencode_theme.dart';
import 'package:broski/theme/app_icons.dart';

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
            Icon(AppIcons.table, size: 64, color: theme.textMuted),
            SizedBox(height: Spacing.lg),
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
            padding: Insets.listItemDense,
            color: theme.backgroundPanel,
            child: Row(
              children: [
                Icon(AppIcons.table, size: 16, color: theme.textMuted),
                SizedBox(width: Spacing.sm),
                Text(
                  '${_rows.length} rows × ${_rows.isNotEmpty ? _rows.first.length : 0} columns',
                  style: AppTypography.label(color: theme.textMuted),
                ),
                const Spacer(),
                Row(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      'Header row',
                      style: AppTypography.label(color: theme.textMuted),
                    ),
                    SizedBox(width: Spacing.sm),
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
                                  style: TextStyle(
                                    fontFamily: AppTypography.uiFontFamily,
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
                              style: TextStyle(
                                fontFamily: AppTypography.uiFontFamily,
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
                                    style: AppTypography.codeSmall(
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
