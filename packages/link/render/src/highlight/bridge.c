#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>

#include "highlights.h"
#include "wasm-rt-impl.h"

/* Control block and buffer layout of @pierre/highlights (dist/highlighter.js). */
#define INPUT_OFFSET 81920u
#define INPUT_PADDING 96u
#define MODE_UTF16_LINE_RECORDS 3u
/* Release grown Wasm memory once a small input follows a large (> 8 MiB) one. */
#define RESET_AFTER_PAGES 128u

extern uint32_t broski_highlights_is_id_start(uint32_t code_point);
extern uint32_t broski_highlights_is_id_continue(uint32_t code_point);

struct w2c_env {
    w2c_highlights* instance;
};

static w2c_highlights instance;
static struct w2c_env env = {&instance};
static bool rt_initialized = false;
static bool instantiated = false;

static u32 id_class(struct w2c_env* host, u32 ptr, u32 len, bool start) {
    wasm_rt_memory_t* memory = w2c_highlights_memory(host->instance);
    if ((uint64_t)ptr + 4 > memory->size) return 0;
    const uint8_t* b = memory->data + ptr;
    uint32_t code_point;
    if (len == 2) {
        code_point = (uint32_t)(b[0] & 31) << 6 | (b[1] & 63);
    } else if (len == 3) {
        code_point = (uint32_t)(b[0] & 15) << 12 | (b[1] & 63) << 6 | (b[2] & 63);
    } else if (len == 4) {
        code_point = (uint32_t)(b[0] & 7) << 18 | (b[1] & 63) << 12 |
                     (b[2] & 63) << 6 | (b[3] & 63);
    } else {
        return 0;
    }
    if (code_point > 0x10ffff) return 0;
    return start ? broski_highlights_is_id_start(code_point)
                 : broski_highlights_is_id_continue(code_point);
}

u32 w2c_env_is_id_start(struct w2c_env* host, u32 ptr, u32 len) {
    return id_class(host, ptr, len, true);
}

u32 w2c_env_is_id_continue(struct w2c_env* host, u32 ptr, u32 len) {
    return id_class(host, ptr, len, false);
}

static void reset_instance(void) {
    if (!instantiated) return;
    wasm2c_highlights_free(&instance);
    instantiated = false;
}

static void ensure_instance(void) {
    if (!rt_initialized) {
        wasm_rt_init();
        rt_initialized = true;
    }
    if (!instantiated) {
        wasm2c_highlights_instantiate(&instance, &env);
        instantiated = true;
    }
}

static void write_u32(uint8_t* at, uint32_t value) {
    at[0] = value & 0xff;
    at[1] = (value >> 8) & 0xff;
    at[2] = (value >> 16) & 0xff;
    at[3] = value >> 24;
}

static uint32_t read_u32(const uint8_t* at) {
    return (uint32_t)at[0] | (uint32_t)at[1] << 8 |
           (uint32_t)at[2] << 16 | (uint32_t)at[3] << 24;
}

int64_t broski_highlights_tokenize(const uint8_t* source, size_t length, uint8_t language,
                                   const uint32_t** records) {
    *records = NULL;
    if (length > UINT32_MAX - WASM_DEFAULT_PAGE_SIZE * 2) return -1;

    if (instantiated && w2c_highlights_memory(&instance)->pages > RESET_AFTER_PAGES &&
        length <= WASM_DEFAULT_PAGE_SIZE) {
        reset_instance();
    }
    ensure_instance();

    wasm_rt_memory_t* memory = w2c_highlights_memory(&instance);
    uint64_t needed_pages =
        ((uint64_t)INPUT_OFFSET + length + INPUT_PADDING + WASM_DEFAULT_PAGE_SIZE - 1) /
        WASM_DEFAULT_PAGE_SIZE;
    if (needed_pages > memory->pages &&
        wasm_rt_grow_memory(memory, needed_pages - memory->pages) == (uint64_t)-1) {
        return -1;
    }

    uint8_t* data = memory->data;
    if (length > 0) memcpy(data + INPUT_OFFSET, source, length);
    data[INPUT_OFFSET + length] = 0;
    data[0] = language;
    data[1] = MODE_UTF16_LINE_RECORDS;
    write_u32(data + 2, (uint32_t)length);

    WASM_RT_SAVE_STACK_DEPTH();
    if (WASM_RT_SETJMP(g_wasm_rt_jmp_buf) != WASM_RT_TRAP_NONE) {
        reset_instance();
        return -1;
    }
    w2c_highlights_highlight(&instance);

    data = memory->data;
    uint32_t start = read_u32(data + 6);
    uint32_t byte_length = read_u32(data + 10);
    if ((uint64_t)start + byte_length > memory->size || start % 4 != 0 || byte_length % 8 != 0) {
        return -1;
    }
    *records = (const uint32_t*)(data + start);
    return (int64_t)(byte_length / 4);
}
