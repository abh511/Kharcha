package app.kharcha

/**
 * Decides on the phone which SMS may leave it. Only bank-style messages about
 * money are sent; texts from people (phone-number senders) and OTPs never are.
 */
object SmsFilter {
    private val MONEY = Regex("""(rs\.?|inr|₹)\s*[0-9]|\b(debited|credited)\b""", RegexOption.IGNORE_CASE)
    private val SECRET = Regex("""\b(otp|one[ -]time password|verification code|passcode|\bpin\b)""", RegexOption.IGNORE_CASE)

    /** Banks send from alphanumeric IDs like "VM-HDFCBK"; people send from numbers like "+919876543210". */
    fun isBankSender(sender: String): Boolean =
        sender.isNotBlank() && !sender.startsWith("+") && sender.any { it.isLetter() }

    fun shouldSend(sender: String, body: String): Boolean =
        isBankSender(sender) && MONEY.containsMatchIn(body) && !SECRET.containsMatchIn(body)
}
