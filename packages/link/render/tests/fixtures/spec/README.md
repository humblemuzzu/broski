# The official examples

The formatter's spec test (`render/src/format/tests/spec.rs`) runs every example in these files.

- `commonmark-0.31.2.json` — the examples of the CommonMark Spec 0.31.2, exactly as published at
  <https://spec.commonmark.org/0.31.2/spec.json>. Copyright © 2014–24 John MacFarlane, licensed
  under the [Creative Commons Attribution-ShareAlike 4.0 International
  licence](https://creativecommons.org/licenses/by-sa/4.0/) (CC BY-SA 4.0).
- `gfm-0.29-extensions.json` — the examples the GitHub Flavored Markdown Spec 0.29
  (<https://github.com/github/cmark-gfm/blob/master/test/spec.txt>) marks as extensions: `table`,
  `strikethrough`, `autolink`, `tagfilter`, and the task-list examples it marks `disabled`
  (here `tasklist`). Converted from `spec.txt` to the same JSON shape, with `→` read as a tab and
  each example's number as the spec counts it. The GFM spec is based on the CommonMark Spec and is
  licensed the same way, under CC BY-SA 4.0.

These files are test data only; nothing of them is built into the apps.
