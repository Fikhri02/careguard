import type { FamilyMember } from "@careguard/shared";

/**
 * Tells the model who the elder's saved family is, so "siapa keluarga saya?" gets a real answer and it never
 * asks for a number that is already saved. One entry per destination: the same person can be saved twice.
 */
export function familyContext(members: FamilyMember[]): string {
  if (members.length === 0) {
    return "Family: no family member is saved for this user yet. If something risky happens, offer to save a son's or daughter's number.";
  }
  const byDestination = new Map<string, { names: Set<string>; telegram: boolean }>();
  for (const member of members) {
    const destination = member.telegramChatId ? `telegram:${member.telegramChatId}` : member.phone;
    const entry = byDestination.get(destination) ?? { names: new Set<string>(), telegram: member.telegramChatId !== null };
    entry.names.add(member.name ?? (member.telegramChatId ? "a family member" : member.phone));
    byDestination.set(destination, entry);
  }
  const people = [...byDestination.values()].map(
    ({ names, telegram }) => `${[...names].join(" / ")} (${telegram ? "alerted on Telegram" : "alerted by phone"})`,
  );
  return (
    `Family saved for this user: ${people.join("; ")}. They are alerted automatically when a high-risk scam arrives. ` +
    "If the user asks who their family is, tell them. Never ask for a family number that is already saved."
  );
}
