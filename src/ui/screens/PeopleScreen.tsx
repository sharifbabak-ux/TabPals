import { useState } from "react";
import { Tabs } from "@/ui/components/Tabs";
import { PersonsSection } from "./people/PersonsSection";
import { GroupsSection } from "./people/GroupsSection";

type PeopleTab = "persons" | "groups";

export function PeopleScreen() {
  const [tab, setTab] = useState<PeopleTab>("persons");

  return (
    <div className="screen">
      <Tabs
        options={[
          { value: "persons", label: "اشخاص" },
          { value: "groups", label: "گروه‌ها" }
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === "persons" ? <PersonsSection /> : <GroupsSection />}
    </div>
  );
}
