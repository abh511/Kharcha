package app.kharcha

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SmsFilterTest {
    @Test
    fun sendsBankPaymentMessages() {
        assertTrue(SmsFilter.shouldSend("VM-HDFCBK", "Sent Rs.250.00\nFrom HDFC Bank A/C *1234\nTo SWIGGY\nOn 30/10/26\nRef 430312345678"))
        assertTrue(SmsFilter.shouldSend("AD-SBIUPI", "Dear UPI user A/C X7730 debited by 188.0 on date 30Oct26 trf to UBER INDIA Refno 430300000065"))
        assertTrue(SmsFilter.shouldSend("JD-ICICIT-S", "ICICI Bank Acct XX234 debited for INR 349.00 on 30-Oct-26; NETFLIX credited."))
    }

    @Test
    fun neverSendsPersonalTexts() {
        assertFalse(SmsFilter.shouldSend("+919876543210", "Can you send Rs 500 for dinner?"))
        assertFalse(SmsFilter.shouldSend("9876543210", "Rs 500 debited lol jk"))
        assertFalse(SmsFilter.shouldSend("", "Rs 500 debited"))
    }

    @Test
    fun neverSendsOtpsOrMessagesWithoutMoney() {
        assertFalse(SmsFilter.shouldSend("VM-HDFCBK", "OTP for txn of Rs 500.00 at AMAZON is 482913. Do not share."))
        assertFalse(SmsFilter.shouldSend("AX-SBIBNK", "Your one-time password is 1234 for INR 99"))
        assertFalse(SmsFilter.shouldSend("VM-HDFCBK", "Your card statement is ready. Login to netbanking to view."))
    }
}
