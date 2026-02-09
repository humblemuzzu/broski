import { exportLogsDiagnosticsBundle } from '../logs'

export async function exportDoctorDiagnostics(): Promise<string> {
  return await exportLogsDiagnosticsBundle({
    logsLines: 400,
    logsIncludeErrors: true,
    logsRedact: true,
  })
}
