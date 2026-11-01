package app.kharcha

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/** Android calls this for every incoming SMS, even when the app isn't open. */
class SmsReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
        if (Prefs(context).ingestToken == null) return
        val parts = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        // A long SMS arrives in several parts.
        parts.groupBy { it.originatingAddress.orEmpty() }.forEach { (from, msgs) ->
            val text = msgs.joinToString("") { it.messageBody.orEmpty() }
            if (SmsFilter.shouldSend(from, text)) UploadWorker.enqueue(context, from, text, msgs.first().timestampMillis)
        }
    }
}
