package app.kharcha

import android.content.Context
import android.provider.Telephony
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.IOException
import java.util.concurrent.TimeUnit

/**
 * Right after setup: sends the last 90 days of bank SMS, oldest first, one at a
 * time (the server allows ~120 a minute). Progress is saved, so a retry resumes.
 * Re-sending is harmless: the server ignores an SMS it already has.
 */
class BackfillWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        val server = prefs.server ?: return Result.failure()
        val token = prefs.ingestToken ?: return Result.failure()
        val since = maxOf(System.currentTimeMillis() - TimeUnit.DAYS.toMillis(90), prefs.backfilledUpTo + 1)

        val cursor = applicationContext.contentResolver.query(
            Telephony.Sms.Inbox.CONTENT_URI,
            arrayOf(Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE),
            "${Telephony.Sms.DATE} >= ?",
            arrayOf(since.toString()),
            "${Telephony.Sms.DATE} ASC",
        ) ?: return Result.failure()

        cursor.use {
            while (it.moveToNext()) {
                if (isStopped) return Result.retry()
                val from = it.getString(0).orEmpty()
                val body = it.getString(1).orEmpty()
                val at = it.getLong(2)
                if (SmsFilter.shouldSend(from, body)) {
                    when (send(server, token, from, body, at)) {
                        Outcome.SENT -> prefs.recordSent()
                        Outcome.RETRY_LATER -> return Result.retry()
                        Outcome.STOP -> return Result.failure()
                    }
                    Thread.sleep(600)
                }
                prefs.backfilledUpTo = at
            }
        }
        prefs.backfillDone = true
        return Result.success()
    }

    private enum class Outcome { SENT, RETRY_LATER, STOP }

    private fun send(server: String, token: String, from: String, body: String, at: Long): Outcome {
        repeat(3) {
            val code = try {
                Api.sendSms(server, token, from, body, at)
            } catch (_: IOException) {
                return Outcome.RETRY_LATER
            }
            when (code) {
                in 200..299 -> return Outcome.SENT
                401 -> return Outcome.STOP
                429 -> Thread.sleep(30_000) // rate-limited: wait, then try the same message again
                in 500..599 -> return Outcome.RETRY_LATER
                else -> return Outcome.SENT // 400: the server can't use it; move on
            }
        }
        return Outcome.RETRY_LATER
    }

    companion object {
        fun start(context: Context) {
            val request = OneTimeWorkRequestBuilder<BackfillWorker>()
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .build()
            WorkManager.getInstance(context).enqueueUniqueWork("backfill", ExistingWorkPolicy.KEEP, request)
        }
    }
}
