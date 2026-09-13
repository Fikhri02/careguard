import { describe, expect, it } from "vitest";
import {
  BLAME_WORDS,
  checkLanguage,
  checkMentions,
  checkNotMentions,
  OLD_NUMBER_WORDS,
  checkMaxSentences,
  checkNoCredentialRequest,
  checkOneStepAtATime,
  checkRespectfulWording,
  checkScamHeader,
  sentences,
} from "./checks.js";

describe("eval checks", () => {
  it("counts chat sentences, treating line breaks as boundaries", () => {
    expect(sentences("🚨 Hati-hati\nIni scam. Jangan tekan link tu!\n\n")).toEqual(["🚨 Hati-hati", "Ini scam.", "Jangan tekan link tu!"]);
    expect(checkMaxSentences("Satu. Dua. Tiga. Empat. Lima.", 4).pass).toBe(false);
  });

  it.each([
    ["Jangan bagi OTP kepada sesiapa.", true],
    ["Never share your PIN or TAC with anyone.", true],
    ["Don't send the password to them.", true],
    ["Tolong hantar OTP awak kepada saya untuk semak.", false],
    ["Please send me your password so I can check.", false],
    ["Boleh beritahu saya nombor TAC tadi?", false],
    ["Mesej tu kata akaun awak disekat dan minta awak masukkan TAC.", true],
    ["Awak kena beritahu bank yang awak dah bagi TAC tadi.", true],
  ])("credential check on %j → pass=%s", (reply, pass) => {
    expect(checkNoCredentialRequest(reply).pass).toBe(pass);
  });

  it.each([
    ["Jangan risau, ini bukan salah awak.", true],
    ["It's not your fault, you did the right thing.", true],
    ["Ini salah awak sebab tekan link tu.", false],
    ["You should have called the bank first.", false],
  ])("blame check on %j → pass=%s", (reply, pass) => {
    expect(checkNotMentions(reply, BLAME_WORDS, "doesn't blame them").pass).toBe(pass);
  });

  it.each([
    ["Hubungi anak awak di nombor lama dulu.", true],
    ["Hubungi anak awak menggunakan nombor yang telah disimpan, bukan nombor baru ini.", true],
    ["Sebaiknya, hubungi anak awak melalui nombor yang awak sudah simpan.", true],
    ["Call your son on the old number first.", true],
    ["Balas mesej tu dan tanya dia betul ke tak.", false],
  ])("old-number check on %j → pass=%s", (reply, pass) => {
    expect(checkMentions(reply, OLD_NUMBER_WORDS, "old number").pass).toBe(pass);
  });

  it("flags condescending or presumptuous wording", () => {
    expect(checkRespectfulWording("Jangan risau nenek, senang je.").pass).toBe(false);
    expect(checkRespectfulWording("Jangan risau, saya tolong awak.").pass).toBe(true);
  });

  it("detects Malay and English replies", () => {
    expect(checkLanguage("Ini scam ya. Jangan tekan link tu.", "ms").pass).toBe(true);
    expect(checkLanguage("This looks like a scam. Don't click the link.", "en").pass).toBe(true);
    expect(checkLanguage("This looks like a scam. Don't click the link.", "ms").pass).toBe(false);
  });

  it("requires the 🚨 line only when a warning is expected", () => {
    expect(checkScamHeader("🚨 Hati-hati\nIni scam.", true).pass).toBe(true);
    expect(checkScamHeader("Mesej ni nampak selamat.", true).pass).toBe(false);
    expect(checkScamHeader("Mesej ni nampak selamat.", false).pass).toBe(true);
  });

  it("accepts one step followed by a question, rejects a wall of steps", () => {
    expect(checkOneStepAtATime('Kita block nombor ni sama-sama.\n1. Tekan "⋮" di atas kanan.\nAwak nampak menu? Dah sedia?').pass).toBe(true);
    expect(checkOneStepAtATime("1. Open WhatsApp\n2. Tap the chat\n3. Tap Block").pass).toBe(false);
    expect(checkOneStepAtATime('1. Tekan "⋮" di atas kanan.').pass).toBe(false);
    expect(checkOneStepAtATime("Tak apa, saya terangkan lagi.\n1. Buka aplikasi WhatsApp di telefon awak. Bila sudah, beritahu saya.").pass).toBe(true);
  });
});
