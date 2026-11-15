#ifndef BROSKI_TERMINAL_H
#define BROSKI_TERMINAL_H

#include <jni.h>
#include <stdint.h>
#include <ghostty/vt.h>

#define FN(name) Java_com_muzammil_broski_terminal_Native_##name

typedef struct {
  GhosttyTerminal terminal;
  GhosttyRenderState render;
  GhosttyRenderStateRowIterator rows;
  GhosttyRenderStateRowCells cells;
  GhosttyKeyEncoder encoder;
  GhosttyKeyEvent event;
  uint8_t *reply;
  size_t reply_len;
  size_t reply_cap;
} Vt;

static inline Vt *vt(jlong handle) { return (Vt *)(intptr_t)handle; }

/** A new Java array holding the terminal's answers collected since the last call, which it empties. */
jbyteArray take_reply(JNIEnv *env, Vt *v);

#endif
