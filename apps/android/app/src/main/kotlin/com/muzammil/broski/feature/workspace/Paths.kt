package com.muzammil.broski.feature.workspace

/** A path inside `folder`, as the bridge spells directories: POSIX, no trailing slash but the root's. */
fun childPath(folder: String, name: String): String = if (folder.endsWith("/")) folder + name else "$folder/$name"

/** The last component of a path, or the path itself for the root. */
fun lastComponent(path: String): String = path.trimEnd('/').substringAfterLast('/').ifEmpty { path }

/** The folder a path lies in. */
fun parentPath(path: String): String = path.trimEnd('/').substringBeforeLast('/', "").ifEmpty { "/" }

/** `path` with the home folder written `~`, as a terminal shows it. */
fun shortPath(path: String, home: String?): String = when {
    home.isNullOrEmpty() -> path
    path == home -> "~"
    path.startsWith("$home/") -> "~" + path.removePrefix(home)
    else -> path
}
