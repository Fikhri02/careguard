/** Scam-pattern language (English + common Malay). Presence is not guilt, but hits stack the risk. */
export const PATTERNS: { re: RegExp; why: string }[] = [
  { re: /\b(otp|tac|password|kata laluan|pin)\b/i, why: "Asks for an OTP/TAC/password — real banks never do this" },
  { re: /\b(block|blocked|suspend|disekat|digantung|dibekukan)\b/i, why: "Threatens to block/suspend your account (fake urgency)" },
  { re: /\b(verify|verification|sahkan|pengesahan|update|kemaskini)\b/i, why: "Demands you 'verify' or 'update' details via a link" },
  { re: /\b(urgent|segera|immediately|sekarang juga|dalam \d+ jam)\b/i, why: "Creates urgency to stop you thinking" },
  { re: /\b(parcel|bungkusan|pos|courier|customs|kastam|delivery)\b/i, why: "Parcel/delivery pretext (common Malaysian scam)" },
  { re: /\b(police|polis|pdrm|bank negara|bnm|lhdn|court|mahkamah)\b/i, why: "Impersonates police / a bank / an agency" },
  { re: /\b(prize|menang|hadiah|reward|won|winner|lucky draw)\b/i, why: "Promises a prize/winnings you didn't enter for" },
  { re: /\b(click|klik|tekan link|tap here|log ?masuk di)\b/i, why: "Pushes you to click a link and log in" },
];
