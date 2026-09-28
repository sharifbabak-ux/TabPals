import { PersonsSection } from "./people/PersonsSection";
import { GroupsSection } from "./people/GroupsSection";

export function PeopleScreen() {
  return (
    <div className="screen">
      <PersonsSection />
      <hr className="section-divider" />
      <GroupsSection />
    </div>
  );
}
