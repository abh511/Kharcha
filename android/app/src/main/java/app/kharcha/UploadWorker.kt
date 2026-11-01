package app.kharcha

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Sends one SMS. WorkManager waits for a network and retries with backoff, so nothing is lost offline. */
class UploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
    override fun doWork(): Result {
        val prefs = Prefs(applicationContext)
        val server = prefs.server ?: return Result.failure()
        val token = prefs.ingestToken ?: return Result.failure()
        val from = inputData.getString(KEY_FROM) ?: return Result.failure()
        val text = inputData.getString(KEY_TEXT) ?: return Result.failure()
        return try {
            when (val code = Api.sendSms(server, token, from, text, inputData.getLong(KEY_AT, System.currentTimeMillis()))) {
                in 200..299 -> Result.success().also { prefs.recordSent() }
                429, in 500..599 -> Result.retry()
                else -> Result.failure(workDataOf("status" to code)) // 401: token replaced; 400: malformed
            }
        } catch (_: IOException) {
            Result.retry()
        }
    }

    companion object {
        private const val KEY_FROM = "from"
        private const val KEY_TEXT = "text"
        private const val KEY_AT = "at"

        fun enqueue(context: Context, from: String, text: String, receivedAt: Long) {
            val request = OneTimeWorkRequestBuilder<UploadWorker>()
                .setInputData(workDataOf(KEY_FROM to from, KEY_TEXT to text, KEY_AT to receivedAt))
                .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            WorkManager.getInstance(context).enqueue(request)
        }
    }
}
