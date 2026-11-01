package app.kharcha

import org.json.JSONObject
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

/** The three Kharcha server calls the app needs. Blocking: call off the main thread. */
object Api {
    class HttpError(val code: Int, message: String) : IOException(message)

    /** Email + password → session token, used once to create the ingest token. */
    fun login(server: String, email: String, password: String): String =
        post(server, "/api/auth/login", JSONObject().put("email", email).put("password", password), null).getString("token")

    /** The secret this phone sends SMS with. Replaces any previous one (e.g. an old forwarder app's). */
    fun createIngestToken(server: String, jwt: String): String =
        post(server, "/api/me/ingest-token", JSONObject(), jwt).getString("token")

    /** Returns the HTTP status: 200/202 = stored or already had it, 401 = token revoked, 429/5xx = try later. */
    fun sendSms(server: String, token: String, from: String, text: String, receivedAt: Long): Int {
        val body = JSONObject().put("from", from).put("text", text).put("receivedStamp", receivedAt)
        return request(server, "/api/ingest/sms", body, token).first
    }

    private fun post(server: String, path: String, body: JSONObject, bearer: String?): JSONObject {
        val (code, text) = request(server, path, body, bearer)
        val json = runCatching { JSONObject(text) }.getOrDefault(JSONObject())
        if (code !in 200..299) throw HttpError(code, json.optString("error", "Server error ($code)"))
        return json
    }

    private fun request(server: String, path: String, body: JSONObject, bearer: String?): Pair<Int, String> {
        val conn = URL(server.trimEnd('/') + path).openConnection() as HttpURLConnection
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 15_000
            conn.readTimeout = 30_000
            conn.doOutput = true
            conn.setRequestProperty("content-type", "application/json")
            if (bearer != null) conn.setRequestProperty("authorization", "Bearer $bearer")
            conn.outputStream.use { it.write(body.toString().toByteArray()) }
            val code = conn.responseCode
            val stream = if (code < 400) conn.inputStream else conn.errorStream
            return code to (stream?.bufferedReader()?.use { it.readText() } ?: "")
        } finally {
            conn.disconnect()
        }
    }
}
