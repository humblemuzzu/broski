package com.muzammil.broski.feature.notifications

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.ForegroundInfo
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.OutOfQuotaPolicy
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.muzammil.broski.R
import com.muzammil.broski.app.BroskiApplication
import java.io.IOException
import uniffi.broski_core.ClientException
import uniffi.broski_core.MachineRecord
import uniffi.broski_core.decisionLetter

/**
 * Allow or Deny tapped on an approval: says "Sending…" at once and hands the letter to expedited
 * work, since a receiver may not wait on the network.
 */
class DecisionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val fields = DecisionInput.keys.associateWith { intent.getStringExtra(it) }
        val (alert, decision) = DecisionInput.read(fields::get) ?: return
        val data = DecisionInput.write(alert, decision)
        Notifier(context).postDecision(alert, decision, DecisionState.Sending)
        val work = OneTimeWorkRequestBuilder<DecisionWorker>()
            .setInputData(data)
            .setExpedited(OutOfQuotaPolicy.RUN_AS_NON_EXPEDITED_WORK_REQUEST)
            .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .build()
        WorkManager.getInstance(context).enqueueUniqueWork(alert.tag, ExistingWorkPolicy.KEEP, work)
    }

    companion object {
        fun intent(context: Context, alert: Alert, decision: Decision): Intent {
            val intent = Intent(context, DecisionReceiver::class.java).setAction(ACTION)
            DecisionInput.write(alert, decision).keyValueMap.forEach { (key, value) -> intent.putExtra(key, value as String?) }
            return intent
        }

        private const val ACTION = "com.muzammil.broski.DECISION"
    }
}

/**
 * Seals the decision with the machine's stored record and POSTs it to the relay, then says how it
 * went on the approval. A relay that is busy or unreachable is tried again, a few times.
 */
class DecisionWorker(context: Context, parameters: WorkerParameters) : CoroutineWorker(context, parameters) {
    private val notifier = Notifier(context)

    override suspend fun doWork(): Result {
        val (alert, decision) = DecisionInput.read(inputData::getString) ?: return Result.failure()
        val session = alert.session ?: return Result.failure()
        val outcome = try {
            val record = records(session.machineId) ?: return failed(alert, decision, "no stored record")
            val letter = MachineRecord.fromBytes(record).use { decisionLetter(it, decision.push, session.backend, session.sessionId, alert.request) }
            postLetter(letter)
        } catch (error: ClientException) {
            return failed(alert, decision, error.message)
        } catch (error: IOException) {
            Log.i(TAG, "the relay could not be reached", error)
            RETRY
        }
        return when {
            outcome in 200..299 -> Result.success().also { notifier.postDecision(alert, decision, DecisionState.Sent) }
            (outcome == RETRY || outcome == 429 || outcome >= 500) && runAttemptCount < MAX_ATTEMPTS -> Result.retry()
            else -> failed(alert, decision, "relay answered $outcome")
        }
    }

    /** Below Android 12 expedited work runs as a foreground service, which needs a notification of its own. */
    override suspend fun getForegroundInfo(): ForegroundInfo {
        val notification = NotificationCompat.Builder(applicationContext, Channel.LiveStatus.id)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(applicationContext.getString(R.string.notify_sending_decision))
            .build()
        return ForegroundInfo(FOREGROUND_ID, notification)
    }

    private suspend fun records(machineId: String): ByteArray? =
        (applicationContext as BroskiApplication).core.vault.records().readable[machineId]

    private fun failed(alert: Alert, decision: Decision, why: String?): Result {
        Log.w(TAG, "the decision was not sent: $why")
        notifier.postDecision(alert, decision, DecisionState.Failed)
        return Result.failure()
    }

    private companion object {
        const val TAG = "Decision"
        const val RETRY = -1
        const val MAX_ATTEMPTS = 3
        const val FOREGROUND_ID = 2
    }
}

/** The approval and the choice, as the receiver hands them to the worker. */
internal object DecisionInput {
    val keys = listOf("tag", "channel", "title", "text", "machineName", "machine", "backend", "session", "request", "decision")

    fun write(alert: Alert, decision: Decision): Data {
        val session = requireNotNull(alert.session)
        return workDataOf(
            "tag" to alert.tag, "channel" to alert.channel.name, "title" to alert.title, "text" to alert.text,
            "machineName" to alert.machineName, "machine" to session.machineId, "backend" to session.backend,
            "session" to session.sessionId, "request" to alert.request, "decision" to decision.name,
        )
    }

    /** Null unless every field is there: what reaches a receiver from outside is not trusted to be whole. */
    fun read(field: (String) -> String?): Pair<Alert, Decision>? {
        val session = SessionTarget(field("machine") ?: return null, field("backend") ?: return null, field("session") ?: return null)
        val alert = Alert(
            tag = field("tag") ?: return null,
            channel = Channel.entries.firstOrNull { it.name == field("channel") } ?: return null,
            title = field("title") ?: return null,
            text = field("text") ?: return null,
            machineName = field("machineName") ?: return null,
            session = session,
            request = field("request") ?: return null,
        )
        val decision = Decision.entries.firstOrNull { it.name == field("decision") } ?: return null
        return alert to decision
    }
}
