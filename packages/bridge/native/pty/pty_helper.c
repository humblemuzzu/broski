/*
 * Broski Native PTY helper.
 *
 * Provides a tiny C ABI around forkpty + read/write/resize so Bun can use a
 * real PTY.
 */

#if defined(__APPLE__)
#include <util.h>
#else
#include <pty.h>
#endif

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/ioctl.h>
#include <sys/wait.h>
#include <termios.h>
#include <poll.h>
#include <unistd.h>

extern char** environ;

int pty_create(
    int* pid_out,
    char* slave_path_out,
    int slave_path_len,
    unsigned short initial_rows,
    unsigned short initial_cols,
    unsigned short width_px,
    unsigned short height_px,
    const char* shell,
    const char* cwd,
    const char* term_env,
    const char* command,
    char* const* envp
) {
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = initial_rows > 0 ? initial_rows : 24;
    ws.ws_col = initial_cols > 0 ? initial_cols : 80;
    ws.ws_xpixel = width_px;
    ws.ws_ypixel = height_px;

    char slave_name[256];
    int master_fd = -1;
    pid_t pid = forkpty(&master_fd, slave_name, NULL, &ws);
    if (pid < 0) {
        return -1;
    }

    if (pid == 0) {
        /* The caller's environment as its runtime holds it, which a runtime need not keep in the C one. */
        if (envp) {
            environ = (char**)envp;
        }

        if (cwd && cwd[0] != '\0') {
            if (chdir(cwd) != 0) {
                const char* home = getenv("HOME");
                if (home && home[0] != '\0') {
                    chdir(home);
                }
            }
        }

        setenv("TERM", (term_env && term_env[0]) ? term_env : "xterm-256color", 1);

        signal(SIGCHLD, SIG_DFL);
        signal(SIGHUP, SIG_DFL);
        signal(SIGINT, SIG_DFL);
        signal(SIGQUIT, SIG_DFL);
        signal(SIGTERM, SIG_DFL);
        signal(SIGALRM, SIG_DFL);
        signal(SIGPIPE, SIG_DFL);

        const char* sh = (shell && shell[0]) ? shell : getenv("SHELL");
        if (!sh || !sh[0]) {
            sh = "/bin/sh";
        }

        const char* base = strrchr(sh, '/');
        const char* base_name = base ? (base + 1) : sh;

        if (command && command[0] != '\0') {
            execlp(sh, base_name, "-lc", command, (char*)NULL);
        } else {
            char login_name[256];
            snprintf(login_name, sizeof(login_name), "-%s", base_name);
            execlp(sh, login_name, (char*)NULL);
        }

        _exit(127);
    }

    if (pid_out) {
        *pid_out = (int)pid;
    }
    if (slave_path_out && slave_path_len > 0) {
        strncpy(slave_path_out, slave_name, slave_path_len - 1);
        slave_path_out[slave_path_len - 1] = '\0';
    }

    int flags = fcntl(master_fd, F_GETFL, 0);
    if (flags >= 0) {
        fcntl(master_fd, F_SETFL, flags | O_NONBLOCK);
    }

    return master_fd;
}

int pty_resize(int master_fd, unsigned short rows, unsigned short cols, unsigned short width_px, unsigned short height_px) {
    struct winsize ws;
    memset(&ws, 0, sizeof(ws));
    ws.ws_row = rows;
    ws.ws_col = cols;
    ws.ws_xpixel = width_px;
    ws.ws_ypixel = height_px;
    return ioctl(master_fd, TIOCSWINSZ, &ws);
}

int pty_wait_readable(int fd, int timeout_ms) {
    struct pollfd pfd;
    memset(&pfd, 0, sizeof(pfd));
    pfd.fd = fd;
    pfd.events = POLLIN | POLLERR | POLLHUP;
    return poll(&pfd, 1, timeout_ms);
}

int pty_read(int fd, void* buf, int len) {
    return (int)read(fd, buf, (size_t)len);
}

int pty_write(int fd, const void* data, int len) {
    return (int)write(fd, data, (size_t)len);
}

int pty_close(int fd) {
    return close(fd);
}

int pty_kill(int pid, int sig) {
    return kill((pid_t)pid, sig);
}

int pty_waitpid(int pid) {
    int status = 0;
    pid_t result = waitpid((pid_t)pid, &status, WNOHANG);
    if (result == 0) return -1;
    if (result < 0) return -2;
    /* An exit status is 0-255; a signal is told apart from it as 256 + its number. */
    if (WIFEXITED(status)) return WEXITSTATUS(status);
    if (WIFSIGNALED(status)) return 256 + WTERMSIG(status);
    return -2;
}

int pty_errno(void) {
    return errno;
}
