/**
 * Known-good Twilio webhook signature, generated with the official `twilio` package
 * (`getExpectedTwilioSignature`) and cross-checked by hand on 2026-09-13.
 */
export const TWILIO_FIXTURE = {
  authToken: "12345",
  publicUrl: "https://careguard.example.com",
  url: "https://careguard.example.com/whatsapp",
  params: {
    AccountSid: "AC00000000000000000000000000000000",
    Body: "Maybank: akaun anda disekat",
    From: "whatsapp:+60123456789",
    MessageSid: "SM11111111111111111111111111111111",
    NumMedia: "0",
    To: "whatsapp:+14155238886",
  },
  signature: "cKdxRAW6uny0GQf5Nra5cwtXl9Y=",
};
