# The grammars `highlight` knows

Sublime Text syntaxes, copied unchanged from bat **v0.26.1** (`979ba226`), the curation two-face
0.5.2 packages, with bat's own patches applied (`assets/patches/*.patch`, as its `assets/create.sh`
applies them). `build.rs` compiles every `.sublime-syntax` file here into one syntect dump the library
embeds; nothing reads these files at run time.

Why a subset rather than two-face's whole set: two-face's dump alone added 0.94 MB to the Android
arm64 library (the whole rendering crate +3.13 MB, past the 3 MB budget); this set adds 0.26 MB
(+2.43 MB in all). A syntect set cannot be cut down after it is built (its contexts point at each
other by index), so the subset is built from source.

| Directory | Source | Commit | License |
|---|---|---|---|
| `sublimehq-packages/` | [sublimehq/Packages](https://github.com/sublimehq/Packages), bat's `assets/syntaxes/01_Packages` | `759d6eed` | `sublimehq-packages/LICENSE` |
| `extra/TypeScript/` (TypeScript, TypeScriptReact) | bat's `02_Extra/TypeScript.sublime-syntax`, `TypsecriptReact.sublime-syntax`, converted from [Microsoft/TypeScript-Sublime-Plugin](https://github.com/Microsoft/TypeScript-Sublime-Plugin) | `ba45efd0` | Apache 2.0 |
| `extra/Kotlin/` | bat's `02_Extra/Kotlin.sublime-syntax`, from [vkostyukov/kotlin-sublime-package](https://github.com/vkostyukov/kotlin-sublime-package) | `aeeed278` | Apache 2.0 |
| `extra/Swift/` | bat's `02_Extra/Swift.sublime-syntax`, from [quiqueg/Swift-Sublime-Package](https://github.com/quiqueg/Swift-Sublime-Package) | `fef17119` | MIT |
| `extra/TOML/` | [jasonwilliams/sublime_toml_highlighting](https://github.com/jasonwilliams/sublime_toml_highlighting) | `f5a57e8b` | MIT |
| `extra/Docker/` | [asbjornenge/Docker.tmbundle](https://github.com/asbjornenge/Docker.tmbundle) `Syntaxes/Dockerfile.sublime-syntax` | `0f6b7bc8` | MIT |
| `extra/Dart/` | bat's `02_Extra/Dart.sublime-syntax`, from [elMuso/Dartlight](https://github.com/elMuso/Dartlight) | `2734901b` | MIT |

From sublimehq/Packages: Bash (with `commands-builtin-shell-bash`), C, C++, C#, CSS, Diff, Go,
Groovy (Gradle), HTML, Java (with JavaDoc), JavaScript, JSON, Lua, Makefile, Markdown,
Objective-C, Python, Ruby, Rust, SQL, XML, YAML, and the regular-expression grammars JavaScript and
Python embed. A language a grammar embeds that is not here (a fenced block in Markdown, say) shows as
plain text: syntect links a missing grammar to plain text.

To add a language, copy its `.sublime-syntax` file (and its license) from the same bat release, add
it to this table, and check its tokens in `src/highlight/tests.rs`.
