The plan, in order:

- [x] Delete the old renderer from Rust, the facade, iOS and Android
- [x] Commit the deletion
- [ ] Build the new parser
  - [ ] Blocks: paragraphs, headings, lists, quotes, fences, tables
  - [ ] Inlines: emphasis, code, links, autolinks, file paths
    1. Bare URLs end before trailing punctuation.
    2. `src/a.ts:42` opens the file at line 42.
    3. A path inside a fenced block is left alone.
- [ ] Draw it on both apps

A list that starts at 7:

7. Seventh
8. Eighth
9. Ninth
10. Tenth — the gutter must fit two digits without the text shifting
11. Eleventh

A loose list (blank lines between items) reads with more air:

- **Phones.** iPhone SE at 375 pt is the narrowest screen we support.

- **Landscape.** About 874 pt on a Pro: prose stays at a readable width, tables and code may use it all.

- **Text size.** From the smallest Dynamic Type size up to AX5.

Deep nesting:

- one
  - two
    - three
      - four
        - five
          - six: indentation stops growing here so a phone keeps its width
