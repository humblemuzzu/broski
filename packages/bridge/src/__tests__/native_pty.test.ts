import { describe, test, expect } from 'bun:test'
import {
  isNativePtyAvailable,
  nativeConnectPty,
  nativeCreatePty,
  nativeDeletePty,
  nativeResizePty,
} from '../pty/native-pty'

describe('Native PTY integration', () => {
  test('supports shell I/O with a real TTY', async () => {
    if (!isNativePtyAvailable()) {
      expect(isNativePtyAvailable()).toBe(false)
      return
    }

    const session = await nativeCreatePty({})
    expect(session).toBeTruthy()

    if (!session) return

    const conn = nativeConnectPty(session.id)
    expect(conn).toBeTruthy()

    if (!conn) {
      await nativeDeletePty(session.id)
      return
    }

    let output = ''
    conn.onData((data) => {
      output += data
    })

    conn.write('echo native-pty-ok\n')
    await Bun.sleep(250)

    expect(output).toContain('native-pty-ok')

    await nativeDeletePty(session.id)
  })

  test('supports resize updates (smooth terminal geometry behavior)', async () => {
    if (!isNativePtyAvailable()) {
      expect(isNativePtyAvailable()).toBe(false)
      return
    }

    const session = await nativeCreatePty({ rows: 24, cols: 80 })
    expect(session).toBeTruthy()
    if (!session) return

    const conn = nativeConnectPty(session.id)
    expect(conn).toBeTruthy()
    if (!conn) {
      await nativeDeletePty(session.id)
      return
    }

    let output = ''
    conn.onData((data) => {
      output += data
    })

    conn.write('stty size\n')
    await Bun.sleep(250)

    const resized = nativeResizePty(session.id, 42, 130)
    expect(resized).toBe(true)

    conn.write('stty size\n')
    await Bun.sleep(250)

    expect(output).toContain('42 130')

    await nativeDeletePty(session.id)
  })
})
