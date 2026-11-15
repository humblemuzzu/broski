buildscript {
    repositories {
        mavenCentral()
    }
    dependencies {
        // AGP's built-in Kotlin compiles with the Kotlin Gradle plugin on this classpath; without it,
        // AGP 9.5.1 brings its own 2.2.10.
        classpath(libs.kotlin.gradle.plugin)
    }
}

plugins {
    alias(libs.plugins.android.library) apply false
}
