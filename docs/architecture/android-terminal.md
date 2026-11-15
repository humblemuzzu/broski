# The Android terminal module

The terminal screen emulates on the phone (contract README §20.2): the bridge ships PTY bytes, and
`:terminal` (`apps/android/terminal`, namespace `com.muzammil.broski.terminal`) runs them through
libghostty-vt. It is not part of BroskiCore: no Rust, no UniFFI, one C library and a small JNI shim.

`scripts/build-android-terminal.sh` (idempotent; downloads are checked against pinned SHA-256 sums and
kept, with each built library, in `$BROSKI_CACHE`, `~/.cache/broski` by default):

| Input | Version | Pinned by |
|---|---|---|
| Zig | 0.17.1 (libghostty-vt 1.0.1's `build.zig.zon` asks for 0.17.x; its build refuses any other minor) | SHA-256 per host: aarch64/x86_64 macOS and Linux |
| libghostty-vt | 1.0.1 (`vt-1.0.1`, the newest release on lib.ghostty.org), source and deps tarballs from `release.files.ghostty.org` | SHA-256 from the release's `SHA256SUMS` |

It builds the static library per target offline from the deps tarball (`--system`, a fresh
`ZIG_GLOBAL_CACHE_DIR` each time, as `PACKAGING-LIBGHOSTTY.md` asks), `-Doptimize=ReleaseFast
-Dcpu=baseline -Dstrip=true`, for `aarch64-linux-android26` and `x86_64-linux-android26` (the
library's own build finds the NDK through `ANDROID_NDK_HOME`, which the script sets to the catalog's),
then links `src/main/c/*.c` with it using the NDK's clang (`-Wl,-z,max-page-size=16384`,
`--gc-sections`, stripped) into `src/main/jniLibs/<abi>/libbroski_terminal.so`, and with `zig cc` into
the host library `src/test/native/libbroski_terminal.{dylib,so}` the JVM tests load. Both outputs are
gitignored. A first run takes about four minutes; a second only relinks.

The JNI surface (`Native.kt`, wrapped by `VtTerminal`): create and free a terminal; write bytes,
returning what the terminal answers the program (device attributes, cursor reports, through
`GHOSTTY_TERMINAL_OPT_WRITE_PTY`); reset; resize with cell pixels; default colours; `update`, which
copies the render state's dirty rows (codepoint or grapheme cluster, resolved colours, style flags,
width, selection) and the cursor, colours and scrollbar into int arrays and gives each rewritten row a
new version; encode a key with the encoder set from the terminal's own modes (cursor keys, Kitty
flags); bracketed paste and its safety check; scroll; select a range or a word; and plain text of the
selection or the screen (the formatter, unwrapped and trimmed, as Ghostty copies). Grapheme
clustering (mode 2027) is on by default, as in Ghostty. Kitty graphics are not drawn: the renderer
reads no image placements, and no PNG decoder is installed, so images a program sends take no room
on the phone.

**Tests** (`terminal/src/test`, JUnit over the host build): colours, styles, wide characters and
clusters reach the cells; only changed rows get a new version; the cursor; a resize; a query is
answered; keys follow the program's key mode; bracketed paste and its safety; selection and its text;
scrollback; reset. The test task declares `src/test/native` as an input, so a rebuilt shim reruns
them. **R8**: `terminal/consumer-rules.pro` keeps `Native`'s native methods and the `Frame.cluster`
callback the shim calls by name.
