import type { Elder, FamilyMember } from "@careguard/shared";

interface PeopleProps {
  people: Elder[];
  family: FamilyMember[];
  busyId: string | null;
  onLabel: (person: Elder, elderId: string) => void;
}

const displayName = (person: Elder) => person.name ?? person.phone.replace(/^(whatsapp|telegram):/, "");

/** Everyone who has messaged CareGuard. The family labels who is an elder and who is family. */
export function People({ people, family, busyId, onLabel }: PeopleProps) {
  const familyEntry = (person: Elder) => family.find((member) => member.phone === person.phone);
  const relatives = people.filter((person) => !familyEntry(person));

  return (
    <section className="column" aria-labelledby="people-h">
      <h2 id="people-h">People</h2>
      <p className="people-hint">Everyone who has messaged the CareGuard bot. Mark family members so scam alerts reach them straight away.</p>
      {people.length === 0 ? (
        <p className="empty">No one has messaged the bot yet.</p>
      ) : (
        <ul className="people">
          {people.map((person) => {
            const entry = familyEntry(person);
            const selectId = `role-${person.id}`;
            return (
              <li key={person.id} className="person">
                <label htmlFor={selectId} className="person-name">
                  {displayName(person)}
                  <span className="chip chip-quiet">{person.phone.split(":")[0]}</span>
                </label>
                <select
                  id={selectId}
                  className="person-role"
                  value={entry ? entry.elderId : "elder"}
                  disabled={busyId === person.id || entry !== undefined}
                  onChange={(e) => {
                    if (e.target.value !== "elder") onLabel(person, e.target.value);
                  }}
                >
                  <option value="elder">Elder</option>
                  {people
                    .filter((other) => other.id !== person.id && (relatives.includes(other) || other.id === entry?.elderId))
                    .map((other) => (
                      <option key={other.id} value={other.id}>
                        Family of {displayName(other)}
                      </option>
                    ))}
                </select>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
