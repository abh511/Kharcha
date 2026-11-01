package app.kharcha

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.text.format.DateUtils
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import androidx.work.WorkManager
import java.io.IOException
import java.util.concurrent.Executors

/** Log in once → allow SMS once → done. Everything after that happens in the background. */
class MainActivity : Activity() {
    private val prefs by lazy { Prefs(this) }
    private val io = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        val server = findViewById<EditText>(R.id.server)
        server.setText(prefs.server ?: BuildConfig.DEFAULT_SERVER)
        findViewById<Button>(R.id.loginButton).setOnClickListener {
            logIn(server.text.toString().trim(), findViewById<EditText>(R.id.email).text.toString().trim(), findViewById<EditText>(R.id.password).text.toString())
        }
        findViewById<Button>(R.id.allowButton).setOnClickListener {
            requestPermissions(arrayOf(Manifest.permission.RECEIVE_SMS, Manifest.permission.READ_SMS), REQUEST_SMS)
        }
        findViewById<Button>(R.id.openButton).setOnClickListener {
            startActivity(Intent(Intent.ACTION_VIEW, Uri.parse(prefs.server)))
        }
        findViewById<Button>(R.id.logoutButton).setOnClickListener {
            WorkManager.getInstance(this).cancelAllWork()
            prefs.clear()
            render()
        }
    }

    override fun onResume() {
        super.onResume()
        render()
    }

    override fun onDestroy() {
        io.shutdown()
        super.onDestroy()
    }

    private fun logIn(serverInput: String, email: String, password: String) {
        val error = findViewById<TextView>(R.id.loginError)
        val button = findViewById<Button>(R.id.loginButton)
        val server = serverInput.trimEnd('/').let { if (it.startsWith("http")) it else "https://$it" }
        if (email.isEmpty() || password.isEmpty() || serverInput.isEmpty()) {
            error.text = "Fill in your email, password and server address."
            error.visibility = View.VISIBLE
            return
        }
        error.visibility = View.GONE
        button.isEnabled = false
        button.text = "Logging in…"
        io.execute {
            val failure = try {
                val jwt = Api.login(server, email, password)
                val token = Api.createIngestToken(server, jwt)
                prefs.server = server
                prefs.email = email
                prefs.ingestToken = token
                null
            } catch (e: Api.HttpError) {
                e.message
            } catch (_: IOException) {
                "Couldn't reach $server. Check the address and your internet."
            } catch (_: Exception) {
                "That doesn't look like a Kharcha server. Check the address."
            }
            runOnUiThread {
                button.isEnabled = true
                button.text = "Log in"
                if (failure != null) {
                    error.text = failure
                    error.visibility = View.VISIBLE
                }
                render()
            }
        }
    }

    private fun smsAllowed() =
        checkSelfPermission(Manifest.permission.RECEIVE_SMS) == PackageManager.PERMISSION_GRANTED &&
            checkSelfPermission(Manifest.permission.READ_SMS) == PackageManager.PERMISSION_GRANTED

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == REQUEST_SMS && smsAllowed()) BackfillWorker.start(this)
        render()
    }

    private fun render() {
        val loggedIn = prefs.ingestToken != null
        findViewById<View>(R.id.login).visibility = if (loggedIn) View.GONE else View.VISIBLE
        findViewById<View>(R.id.connected).visibility = if (loggedIn) View.VISIBLE else View.GONE
        if (!loggedIn) return

        val allowed = smsAllowed()
        if (allowed && !prefs.backfillDone) BackfillWorker.start(this) // no-op if already running
        findViewById<Button>(R.id.allowButton).visibility = if (allowed) View.GONE else View.VISIBLE
        findViewById<TextView>(R.id.title).text = if (allowed) "You're all set" else "One last step"

        val last = prefs.lastSentAt
        findViewById<TextView>(R.id.detail).text = if (!allowed) {
            "Allow Kharcha to read SMS so it can record your payments. Only bank messages about money are sent, never personal texts or OTPs."
        } else buildString {
            append("Logged in as ${prefs.email}.\n")
            append("Every bank payment SMS now goes to Kharcha automatically, even when this app is closed.\n\n")
            append(if (prefs.backfillDone) "Your last 90 days are imported. " else "Importing your last 90 days of bank SMS… ")
            val n = prefs.sentCount
            append("$n bank message${if (n == 1) "" else "s"} sent")
            if (last > 0) {
                val ago = System.currentTimeMillis() - last
                append(", latest ${if (ago < DateUtils.MINUTE_IN_MILLIS) "just now" else DateUtils.getRelativeTimeSpanString(last)}")
            }
            append('.')
        }
    }

    companion object {
        private const val REQUEST_SMS = 1
    }
}
