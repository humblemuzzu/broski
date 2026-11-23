import SwiftUI

/// The composer's field and its row, collapsed or expanded, from one set of children so the field
/// keeps its identity and its keyboard as the composer changes shape: a stack switched for another
/// would rebuild the text view under the person's typing.
///
/// Children, in order: the leading control, the field, the pickers, the trailing controls.
/// Collapsed, one row: leading, the field, trailing; the pickers sit invisibly where the field is.
/// Expanded, the field spans the top and the row beneath holds leading, the pickers, trailing. The
/// row stays on the bottom edge in both, so expanding grows the composer upward.
struct ComposerLayout: Layout {
    var expanded: Bool

    /// The field's text inset beyond the row's controls, and its gap above the row.
    static let fieldInset: CGFloat = 6
    static let fieldTop: CGFloat = 6
    static let fieldGap: CGFloat = 10
    static let spacing: CGFloat = 8
    /// From the leading control to the collapsed field's text.
    static let fieldLead: CGFloat = 10

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? 320
        let row = rowMeasures(width: width, subviews: subviews)
        let field = fieldSize(width: width, row: row, subviews: subviews)
        let height = expanded ? Self.fieldTop + field.height + Self.fieldGap + row.height : max(row.height, field.height)
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let row = rowMeasures(width: bounds.width, subviews: subviews)
        let field = fieldSize(width: bounds.width, row: row, subviews: subviews)
        let rowHeight = expanded ? row.height : max(row.height, field.height)
        let rowMid = bounds.maxY - rowHeight / 2
        let middleX = bounds.minX + row.leading + row.leadingGap

        subviews[0].place(at: CGPoint(x: bounds.minX, y: rowMid), anchor: .leading, proposal: .unspecified)
        subviews[3].place(at: CGPoint(x: bounds.maxX, y: rowMid), anchor: .trailing, proposal: .unspecified)
        subviews[2].place(
            at: CGPoint(x: middleX, y: rowMid), anchor: .leading,
            proposal: ProposedViewSize(width: row.middle, height: nil))
        if expanded {
            subviews[1].place(
                at: CGPoint(x: bounds.minX + Self.fieldInset, y: bounds.minY + Self.fieldTop), anchor: .topLeading,
                proposal: ProposedViewSize(field))
        } else {
            let fieldX = bounds.minX + row.leading + (row.leading > 0 ? Self.fieldLead : Self.fieldInset)
            subviews[1].place(at: CGPoint(x: fieldX, y: rowMid), anchor: .leading, proposal: ProposedViewSize(field))
        }
    }

    private struct Row {
        var leading: CGFloat
        var leadingGap: CGFloat
        var middle: CGFloat
        var trailing: CGFloat
        var height: CGFloat
    }

    private func rowMeasures(width: CGFloat, subviews: Subviews) -> Row {
        let leading = subviews[0].sizeThatFits(.unspecified)
        let trailing = subviews[3].sizeThatFits(.unspecified)
        let leadingGap = leading.width > 0 ? Self.spacing : 0
        let trailingGap = trailing.width > 0 ? Self.spacing : 0
        let middle = max(0, width - leading.width - leadingGap - trailing.width - trailingGap)
        let pickers = subviews[2].sizeThatFits(ProposedViewSize(width: middle, height: nil))
        let height = max(ComposerMetrics.control, leading.height, trailing.height, expanded ? pickers.height : 0)
        return Row(leading: leading.width, leadingGap: leadingGap, middle: middle, trailing: trailing.width, height: height)
    }

    private func fieldSize(width: CGFloat, row: Row, subviews: Subviews) -> CGSize {
        let fieldWidth: CGFloat
        if expanded {
            fieldWidth = width - 2 * Self.fieldInset
        } else {
            let lead = row.leading + (row.leading > 0 ? Self.fieldLead : Self.fieldInset)
            let trail = row.trailing + (row.trailing > 0 ? Self.spacing : Self.fieldInset)
            fieldWidth = width - lead - trail
        }
        let size = subviews[1].sizeThatFits(ProposedViewSize(width: max(0, fieldWidth), height: nil))
        return CGSize(width: max(0, fieldWidth), height: size.height)
    }
}
