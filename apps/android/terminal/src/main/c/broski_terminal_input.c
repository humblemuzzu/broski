// Keys, pastes, scrolling, selection and text out of the terminal, for Native.

#define _GNU_SOURCE // memmem on glibc, for the host build the JVM tests load
#include <stdlib.h>
#include <string.h>
#include "broski_terminal.h"

static jbyteArray bytes_of(JNIEnv *env, const uint8_t *data, size_t len) {
  jbyteArray out = (*env)->NewByteArray(env, (jsize)len);
  if (out && len) (*env)->SetByteArrayRegion(env, out, 0, (jsize)len, (const jbyte *)data);
  return out;
}

static jstring string_of(JNIEnv *env, const uint8_t *utf8, size_t len) {
  // NewStringUTF wants modified UTF-8 and a NUL: decode through String(byte[], "UTF-8") instead.
  jclass string_class = (*env)->FindClass(env, "java/lang/String");
  jmethodID init = (*env)->GetMethodID(env, string_class, "<init>", "([BLjava/lang/String;)V");
  jbyteArray bytes = bytes_of(env, utf8, len);
  jstring charset = (*env)->NewStringUTF(env, "UTF-8");
  if (!init || !bytes || !charset) return NULL;
  return (jstring)(*env)->NewObject(env, string_class, init, bytes, charset);
}

// The bytes a key sends to the program, encoded for the key mode the program asked for (cursor
// keys, keypad, Kitty keyboard flags). `text` is what the key types without Ctrl or Alt applied.
JNIEXPORT jbyteArray JNICALL FN(encodeKey)(JNIEnv *env, jclass cls, jlong handle, jint key, jint mods, jstring text,
                                          jint unshifted) {
  (void)cls;
  Vt *v = vt(handle);
  const char *utf8 = text ? (*env)->GetStringUTFChars(env, text, NULL) : NULL;
  GhosttyString string = {(const uint8_t *)utf8, utf8 ? strlen(utf8) : 0};
  ghostty_key_encoder_set_from_terminal(v->encoder, v->terminal);
  ghostty_key_event_set_action(v->event, GHOSTTY_KEY_ACTION_PRESS);
  ghostty_key_event_set_key(v->event, (GhosttyKey)key);
  ghostty_key_event_set_mods(v->event, (GhosttyMods)mods);
  ghostty_key_event_set_consumed_mods(v->event, string.len ? (GhosttyMods)(mods & GHOSTTY_MODS_SHIFT) : 0);
  ghostty_key_event_set_utf8(v->event, string);
  ghostty_key_event_set_unshifted_codepoint(v->event, (uint32_t)unshifted);
  uint8_t buf[128];
  size_t written = 0;
  GhosttyResult result = ghostty_key_encoder_encode(v->encoder, v->event, buf, sizeof buf, &written);
  ghostty_key_event_set_utf8(v->event, (GhosttyString){0});
  if (utf8) (*env)->ReleaseStringUTFChars(env, text, utf8);
  return bytes_of(env, buf, result == GHOSTTY_SUCCESS ? written : 0);
}

static bool mode(Vt *v, GhosttyMode which) {
  GhosttyTerminalModeConfig config = {.mode = which, .value = false};
  return ghostty_terminal_get(v->terminal, GHOSTTY_TERMINAL_DATA_MODE, &config) == GHOSTTY_SUCCESS && config.value;
}

// The bytes a paste sends, framed for bracketed paste when the program turned it on.
JNIEXPORT jbyteArray JNICALL FN(paste)(JNIEnv *env, jclass cls, jlong handle, jbyteArray text) {
  (void)cls;
  Vt *v = vt(handle);
  jsize len = (*env)->GetArrayLength(env, text);
  char *data = malloc((size_t)len + 1);
  if (!data) return NULL;
  (*env)->GetByteArrayRegion(env, text, 0, len, (jbyte *)data);
  bool bracketed = mode(v, GHOSTTY_MODE_BRACKETED_PASTE);
  size_t needed = 0;
  ghostty_paste_encode(data, (size_t)len, bracketed, NULL, 0, &needed);
  uint8_t *out = malloc(needed ? needed : 1);
  size_t written = 0;
  jbyteArray result = NULL;
  if (out && ghostty_paste_encode(data, (size_t)len, bracketed, out, needed, &written) == GHOSTTY_SUCCESS) {
    result = bytes_of(env, out, written);
  }
  free(out);
  free(data);
  return result;
}

// Whether a paste of `text` could run commands as it lands: a line break with bracketed paste off,
// or the bracketed paste end sequence inside it.
JNIEXPORT jboolean JNICALL FN(pasteIsSafe)(JNIEnv *env, jclass cls, jlong handle, jbyteArray text) {
  (void)cls;
  Vt *v = vt(handle);
  jsize len = (*env)->GetArrayLength(env, text);
  jbyte *data = (*env)->GetByteArrayElements(env, text, NULL);
  if (!data) return JNI_FALSE;
  bool safe = ghostty_paste_is_safe((const char *)data, (size_t)len) ||
              (mode(v, GHOSTTY_MODE_BRACKETED_PASTE) && memmem(data, (size_t)len, "\x1b[201~", 6) == NULL);
  (*env)->ReleaseByteArrayElements(env, text, data, JNI_ABORT);
  return safe ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT void JNICALL FN(scroll)(JNIEnv *env, jclass cls, jlong handle, jint rows) {
  (void)env; (void)cls;
  GhosttyTerminalScrollViewport behavior = {.tag = GHOSTTY_TERMINAL_SCROLL_VIEWPORT_DELTA, .value = {.delta = rows}};
  ghostty_terminal_scroll_viewport(vt(handle)->terminal, behavior);
}

JNIEXPORT void JNICALL FN(scrollToBottom)(JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  GhosttyTerminalScrollViewport behavior = {.tag = GHOSTTY_TERMINAL_SCROLL_VIEWPORT_BOTTOM};
  ghostty_terminal_scroll_viewport(vt(handle)->terminal, behavior);
}

static bool viewport_ref(Vt *v, jint col, jint row, GhosttyGridRef *out) {
  if (col < 0 || row < 0) return false;
  GhosttyPoint point = {.tag = GHOSTTY_POINT_TAG_VIEWPORT, .value = {.coordinate = {.x = (uint16_t)col, .y = (uint32_t)row}}};
  return ghostty_terminal_grid_ref(v->terminal, point, out) == GHOSTTY_SUCCESS;
}

// Selects from one viewport cell to another, both included, in reading order.
JNIEXPORT jboolean JNICALL FN(select)(JNIEnv *env, jclass cls, jlong handle, jint c1, jint r1, jint c2, jint r2) {
  (void)env; (void)cls;
  Vt *v = vt(handle);
  GhosttySelection selection = {0};
  if (!viewport_ref(v, c1, r1, &selection.start) || !viewport_ref(v, c2, r2, &selection.end)) return JNI_FALSE;
  return ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_SELECTION, &selection) == GHOSTTY_SUCCESS;
}

JNIEXPORT jboolean JNICALL FN(selectWord)(JNIEnv *env, jclass cls, jlong handle, jint col, jint row) {
  (void)env; (void)cls;
  Vt *v = vt(handle);
  GhosttyTerminalSelectWordOptions options = GHOSTTY_INIT_SIZED(GhosttyTerminalSelectWordOptions);
  GhosttySelection selection = {0};
  if (!viewport_ref(v, col, row, &options.ref)) return JNI_FALSE;
  if (ghostty_terminal_select_word(v->terminal, &options, &selection) != GHOSTTY_SUCCESS) return JNI_FALSE;
  return ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_SELECTION, &selection) == GHOSTTY_SUCCESS;
}

JNIEXPORT void JNICALL FN(clearSelection)(JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  ghostty_terminal_set(vt(handle)->terminal, GHOSTTY_TERMINAL_OPT_SELECTION, NULL);
}

// Plain text, the way Ghostty copies it: wrapped lines joined, trailing spaces trimmed. The
// selection's text when `selected`, else the whole screen with its scrollback; null when there is
// no selection.
JNIEXPORT jstring JNICALL FN(text)(JNIEnv *env, jclass cls, jlong handle, jboolean selected) {
  (void)cls;
  Vt *v = vt(handle);
  GhosttySelection selection = {0};
  if (selected && ghostty_terminal_get(v->terminal, GHOSTTY_TERMINAL_DATA_SELECTION, &selection) != GHOSTTY_SUCCESS) {
    return NULL;
  }
  GhosttyFormatter formatter = NULL;
  if (ghostty_formatter_terminal_new(NULL, &formatter, v->terminal) != GHOSTTY_SUCCESS) return NULL;
  bool on = true;
  ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_UNWRAP, &on);
  ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_TRIM, &on);
  if (selected) ghostty_formatter_set(formatter, GHOSTTY_FORMATTER_OPT_SELECTION, &selection);
  uint8_t *buf = NULL;
  size_t len = 0;
  jstring out = NULL;
  if (ghostty_formatter_format_alloc(formatter, NULL, &buf, &len) == GHOSTTY_SUCCESS) {
    out = string_of(env, buf, len);
    ghostty_free(NULL, buf, len);
  }
  ghostty_formatter_free(formatter);
  return out;
}
