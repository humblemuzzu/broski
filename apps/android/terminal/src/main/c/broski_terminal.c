// The JNI surface of libghostty-vt for com.muzammil.broski.terminal.Native: one terminal, its render
// state and the bytes it answers a program with. Every call on one handle comes from one thread at a
// time (VtTerminal serialises them); nothing here locks.

#include <stdlib.h>
#include <string.h>
#include "broski_terminal.h"

#define SCROLLBACK_BYTES ((size_t)8 * 1024 * 1024)

enum { CELL_INTS = 4, META_INTS = 16, CLUSTER_MAX = 32, CLUSTER_CAP = 256 };

// Bits of a cell's attribute word above the style flags, mirrored by Cell in Kotlin.
enum {
  ATTR_HAS_FG = 1 << 11,
  ATTR_HAS_BG = 1 << 12,
  ATTR_SELECTED = 1 << 13,
  ATTR_WIDE_SHIFT = 14,
};

typedef struct {
  int count;
  jint cell[CLUSTER_CAP];
  uint32_t codepoints[CLUSTER_CAP][CLUSTER_MAX + 1];
} Clusters;

static jmethodID cluster_method;

static jint argb(GhosttyColorRgb c) {
  return (jint)(0xFF000000u | ((uint32_t)c.r << 16) | ((uint32_t)c.g << 8) | c.b);
}

static GhosttyColorRgb rgb(jint value) {
  GhosttyColorRgb c = {(uint8_t)(value >> 16), (uint8_t)(value >> 8), (uint8_t)value};
  return c;
}

// A program's queries (device attributes, cursor reports) are answered here during a write; the
// answers go back to the program with the write's result.
static void on_write_pty(GhosttyTerminal terminal, void *userdata, const uint8_t *data, size_t len) {
  (void)terminal;
  Vt *v = userdata;
  if (v->reply_len + len > v->reply_cap) {
    size_t cap = v->reply_cap ? v->reply_cap : 256;
    while (cap < v->reply_len + len) cap *= 2;
    uint8_t *grown = realloc(v->reply, cap);
    if (!grown) return;
    v->reply = grown;
    v->reply_cap = cap;
  }
  memcpy(v->reply + v->reply_len, data, len);
  v->reply_len += len;
}

jbyteArray take_reply(JNIEnv *env, Vt *v) {
  jbyteArray out = (*env)->NewByteArray(env, (jsize)v->reply_len);
  if (out && v->reply_len) (*env)->SetByteArrayRegion(env, out, 0, (jsize)v->reply_len, (const jbyte *)v->reply);
  v->reply_len = 0;
  return out;
}

static void free_vt(Vt *v) {
  ghostty_key_event_free(v->event);
  ghostty_key_encoder_free(v->encoder);
  ghostty_render_state_row_cells_free(v->cells);
  ghostty_render_state_row_iterator_free(v->rows);
  ghostty_render_state_free(v->render);
  ghostty_terminal_free(v->terminal);
  free(v->reply);
  free(v);
}

JNIEXPORT jlong JNICALL FN(create)(JNIEnv *env, jclass cls, jint cols, jint rows) {
  (void)cls;
  if (cols <= 0 || rows <= 0 || cols > UINT16_MAX || rows > UINT16_MAX) return 0;
  if (!cluster_method) {
    jclass frame = (*env)->FindClass(env, "com/muzammil/broski/terminal/Frame");
    if (!frame) return 0;
    cluster_method = (*env)->GetMethodID(env, frame, "cluster", "(I[I)V");
    if (!cluster_method) return 0;
  }
  Vt *v = calloc(1, sizeof(Vt));
  if (!v) return 0;
  if (ghostty_terminal_new(NULL, &v->terminal, (uint16_t)cols, (uint16_t)rows) != GHOSTTY_SUCCESS ||
      ghostty_render_state_new(NULL, &v->render) != GHOSTTY_SUCCESS ||
      ghostty_render_state_row_iterator_new(NULL, &v->rows) != GHOSTTY_SUCCESS ||
      ghostty_render_state_row_cells_new(NULL, &v->cells) != GHOSTTY_SUCCESS ||
      ghostty_key_encoder_new(NULL, &v->encoder) != GHOSTTY_SUCCESS ||
      ghostty_key_event_new(NULL, &v->event) != GHOSTTY_SUCCESS) {
    free_vt(v);
    return 0;
  }
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_USERDATA, v);
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_WRITE_PTY, (const void *)on_write_pty);
  // Ghostty's own default (grapheme-width-method = unicode): an emoji with its modifiers is one cell pair.
  GhosttyTerminalModeConfig graphemes = {.mode = GHOSTTY_MODE_GRAPHEME_CLUSTER, .value = true};
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_MODE_DEFAULT, &graphemes);
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_MODE, &graphemes);
  // libghostty-vt keeps 10,000 bytes (one ~400 KB page, about a thousand lines) by default: less than
  // the bridge replays. 8 MB holds about ten thousand phone-width lines, all of a reattach's replay.
  size_t scrollback = SCROLLBACK_BYTES;
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_SCROLLBACK_MAX_BYTES, &scrollback);
  return (jlong)(intptr_t)v;
}

JNIEXPORT void JNICALL FN(free)(JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  free_vt(vt(handle));
}

JNIEXPORT jbyteArray JNICALL FN(write)(JNIEnv *env, jclass cls, jlong handle, jbyteArray data) {
  (void)cls;
  Vt *v = vt(handle);
  jsize len = (*env)->GetArrayLength(env, data);
  jbyte *bytes = (*env)->GetByteArrayElements(env, data, NULL);
  if (!bytes) return NULL;
  ghostty_terminal_vt_write(v->terminal, (const uint8_t *)bytes, (size_t)len);
  (*env)->ReleaseByteArrayElements(env, data, bytes, JNI_ABORT);
  return take_reply(env, v);
}

JNIEXPORT void JNICALL FN(reset)(JNIEnv *env, jclass cls, jlong handle) {
  (void)env; (void)cls;
  ghostty_terminal_reset(vt(handle)->terminal);
}

JNIEXPORT jboolean JNICALL FN(resize)(JNIEnv *env, jclass cls, jlong handle, jint cols, jint rows, jint cw, jint ch) {
  (void)env; (void)cls;
  if (cols <= 0 || rows <= 0 || cols > UINT16_MAX || rows > UINT16_MAX || cw < 0 || ch < 0) return JNI_FALSE;
  return ghostty_terminal_resize(vt(handle)->terminal, (uint16_t)cols, (uint16_t)rows, (uint32_t)cw, (uint32_t)ch) ==
         GHOSTTY_SUCCESS;
}

JNIEXPORT void JNICALL FN(setColors)(JNIEnv *env, jclass cls, jlong handle, jint fg, jint bg, jint cursor) {
  (void)env; (void)cls;
  Vt *v = vt(handle);
  GhosttyColorRgb f = rgb(fg), b = rgb(bg), c = rgb(cursor);
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_COLOR_FOREGROUND, &f);
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_COLOR_BACKGROUND, &b);
  ghostty_terminal_set(v->terminal, GHOSTTY_TERMINAL_OPT_COLOR_CURSOR, &c);
}

static jint cell_attrs(GhosttyRenderStateRowCells cells, jint *fg, jint *bg) {
  GhosttyStyle style = {0};
  GhosttyColorRgb color;
  GhosttyCell raw = 0;
  GhosttyCellWide wide = GHOSTTY_CELL_WIDE_NARROW;
  bool selected = false;
  jint attrs = 0;
  if (ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_STYLE, &style) == GHOSTTY_SUCCESS) {
    attrs = style.flags;
  }
  *fg = 0;
  *bg = 0;
  if (ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_FG_COLOR, &color) == GHOSTTY_SUCCESS) {
    *fg = argb(color);
    attrs |= ATTR_HAS_FG;
  }
  if (ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_BG_COLOR, &color) == GHOSTTY_SUCCESS) {
    *bg = argb(color);
    attrs |= ATTR_HAS_BG;
  }
  ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_SELECTED, &selected);
  if (selected) attrs |= ATTR_SELECTED;
  if (ghostty_render_state_row_cells_get(cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_RAW, &raw) == GHOSTTY_SUCCESS) {
    ghostty_cell_get(raw, GHOSTTY_CELL_DATA_WIDE, &wide);
  }
  return attrs | ((jint)wide << ATTR_WIDE_SHIFT);
}

// One row's cells into out, CELL_INTS per cell: codepoint, fg, bg, attrs. A cell of several
// codepoints gets -1 and is handed to the frame whole once the arrays are released.
static void fill_row(Vt *v, jint *out, int row, int cols, Clusters *clusters) {
  if (ghostty_render_state_row_get(v->rows, GHOSTTY_RENDER_STATE_ROW_DATA_CELLS, &v->cells) != GHOSTTY_SUCCESS) return;
  for (int x = 0; x < cols && ghostty_render_state_row_cells_next(v->cells); x++) {
    jint *cell = out + ((size_t)row * cols + x) * CELL_INTS;
    uint32_t codepoints[CLUSTER_MAX];
    GhosttyCodepointBuffer buffer = {.ptr = codepoints, .cap = CLUSTER_MAX};
    GhosttyResult read =
        ghostty_render_state_row_cells_get(v->cells, GHOSTTY_RENDER_STATE_ROW_CELLS_DATA_GRAPHEMES_BUF, &buffer);
    size_t len = (read == GHOSTTY_SUCCESS || read == GHOSTTY_OUT_OF_SPACE) ? buffer.len : 0;
    if (len > CLUSTER_MAX) len = CLUSTER_MAX;
    if (len > 1 && clusters->count < CLUSTER_CAP) {
      cell[0] = -1;
      clusters->cell[clusters->count] = row * cols + x;
      clusters->codepoints[clusters->count][0] = (uint32_t)len;
      memcpy(&clusters->codepoints[clusters->count][1], codepoints, len * sizeof(uint32_t));
      clusters->count++;
    } else {
      cell[0] = len ? (jint)codepoints[0] : 0;
    }
    cell[3] = cell_attrs(v->cells, &cell[1], &cell[2]);
  }
}

static void fill_meta(Vt *v, jint *meta, GhosttyRenderStateDirty dirty) {
  GhosttyRenderStateCursor cursor = GHOSTTY_INIT_SIZED(GhosttyRenderStateCursor);
  GhosttyRenderStateColors colors = GHOSTTY_INIT_SIZED(GhosttyRenderStateColors);
  GhosttyTerminalScrollbar scrollbar = {0};
  ghostty_render_state_get(v->render, GHOSTTY_RENDER_STATE_DATA_CURSOR, &cursor);
  ghostty_render_state_get(v->render, GHOSTTY_RENDER_STATE_DATA_COLORS, &colors);
  ghostty_terminal_get(v->terminal, GHOSTTY_TERMINAL_DATA_SCROLLBAR, &scrollbar);
  memset(meta, 0, META_INTS * sizeof(jint));
  meta[0] = (jint)dirty;
  meta[1] = cursor.visible && cursor.viewport_has_value;
  meta[2] = cursor.viewport_has_value ? cursor.viewport_x : 0;
  meta[3] = cursor.viewport_has_value ? cursor.viewport_y : 0;
  meta[4] = (jint)cursor.visual_style;
  meta[5] = cursor.blinking;
  meta[6] = argb(colors.foreground);
  meta[7] = argb(colors.background);
  meta[8] = colors.cursor_has_value ? argb(colors.cursor) : 0;
  meta[9] = colors.cursor_has_value;
  meta[10] = (jint)scrollbar.total;
  meta[11] = (jint)scrollbar.offset;
  meta[12] = (jint)scrollbar.len;
}

static jboolean hand_clusters(JNIEnv *env, jobject frame, const Clusters *clusters) {
  for (int i = 0; i < clusters->count; i++) {
    jsize len = (jsize)clusters->codepoints[i][0];
    jintArray codepoints = (*env)->NewIntArray(env, len);
    if (!codepoints) return JNI_FALSE;
    (*env)->SetIntArrayRegion(env, codepoints, 0, len, (const jint *)&clusters->codepoints[i][1]);
    (*env)->CallVoidMethod(env, frame, cluster_method, clusters->cell[i], codepoints);
    (*env)->DeleteLocalRef(env, codepoints);
    if ((*env)->ExceptionCheck(env)) return JNI_FALSE;
  }
  return JNI_TRUE;
}

// Takes what changed since the last update into the frame's arrays: the dirty rows' cells (with a 1
// in `dirty` for each), and the cursor, colours and scroll position in `meta`. False when the arrays
// do not fit the terminal's size, which the caller then grows.
JNIEXPORT jboolean JNICALL FN(update)(JNIEnv *env, jclass cls, jlong handle, jobject frame, jintArray cellArray,
                                      jintArray dirtyArray, jintArray metaArray) {
  (void)cls;
  Vt *v = vt(handle);
  uint16_t cols = 0, rows = 0;
  GhosttyRenderStateDirty dirty = GHOSTTY_RENDER_STATE_DIRTY_FALSE;
  if (ghostty_render_state_update(v->render, v->terminal) != GHOSTTY_SUCCESS) return JNI_FALSE;
  ghostty_render_state_get(v->render, GHOSTTY_RENDER_STATE_DATA_COLS, &cols);
  ghostty_render_state_get(v->render, GHOSTTY_RENDER_STATE_DATA_ROWS, &rows);
  ghostty_render_state_get(v->render, GHOSTTY_RENDER_STATE_DATA_DIRTY, &dirty);
  if ((*env)->GetArrayLength(env, cellArray) != (jsize)cols * rows * CELL_INTS ||
      (*env)->GetArrayLength(env, dirtyArray) != rows || (*env)->GetArrayLength(env, metaArray) != META_INTS) {
    return JNI_FALSE;
  }
  Clusters *clusters = malloc(sizeof(Clusters));
  if (!clusters) return JNI_FALSE;
  clusters->count = 0;
  jint *cells = (*env)->GetIntArrayElements(env, cellArray, NULL);
  jint *dirty_rows = (*env)->GetIntArrayElements(env, dirtyArray, NULL);
  jint *meta = (*env)->GetIntArrayElements(env, metaArray, NULL);
  jboolean ok = cells && dirty_rows && meta;
  if (ok) {
    memset(dirty_rows, 0, (size_t)rows * sizeof(jint));
    fill_meta(v, meta, dirty);
    if (ghostty_render_state_get(v->render, GHOSTTY_RENDER_STATE_DATA_ROW_ITERATOR, &v->rows) == GHOSTTY_SUCCESS) {
      uint16_t y = 0;
      while (ghostty_render_state_row_iterator_next_dirty(v->rows, &y)) {
        if (y >= rows) continue;
        fill_row(v, cells, y, cols, clusters);
        dirty_rows[y] = 1;
      }
    }
    ghostty_render_state_clean(v->render);
  }
  if (meta) (*env)->ReleaseIntArrayElements(env, metaArray, meta, ok ? 0 : JNI_ABORT);
  if (dirty_rows) (*env)->ReleaseIntArrayElements(env, dirtyArray, dirty_rows, ok ? 0 : JNI_ABORT);
  if (cells) (*env)->ReleaseIntArrayElements(env, cellArray, cells, ok ? 0 : JNI_ABORT);
  if (ok) ok = hand_clusters(env, frame, clusters);
  free(clusters);
  return ok;
}
