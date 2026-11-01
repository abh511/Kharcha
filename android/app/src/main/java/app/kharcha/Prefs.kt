package app.kharcha

import android.content.Context

/** Everything the app remembers. The ingest token only lets this phone send SMS; it can't read your data. */
class Prefs(context: Context) {
    private val sp = context.getSharedPreferences("kharcha", Context.MODE_PRIVATE)

    var server: String?
        get() = sp.getString("server", null)
        set(v) = sp.edit().putString("server", v).apply()

    var email: String?
        get() = sp.getString("email", null)
        set(v) = sp.edit().putString("email", v).apply()

    var ingestToken: String?
        get() = sp.getString("ingestToken", null)
        set(v) = sp.edit().putString("ingestToken", v).apply()

    /** Newest SMS timestamp the 90-day import has sent, so a retry resumes instead of starting over. */
    var backfilledUpTo: Long
        get() = sp.getLong("backfilledUpTo", 0)
        set(v) = sp.edit().putLong("backfilledUpTo", v).apply()

    var backfillDone: Boolean
        get() = sp.getBoolean("backfillDone", false)
        set(v) = sp.edit().putBoolean("backfillDone", v).apply()

    val sentCount: Int get() = sp.getInt("sentCount", 0)
    val lastSentAt: Long get() = sp.getLong("lastSentAt", 0)

    @Synchronized
    fun recordSent() {
        sp.edit().putInt("sentCount", sentCount + 1).putLong("lastSentAt", System.currentTimeMillis()).apply()
    }

    fun clear() = sp.edit().clear().apply()
}
