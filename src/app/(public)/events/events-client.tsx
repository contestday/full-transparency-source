"use client";

import { useState } from "react";
import { EventForm } from "./event-form";
import { YourEvents } from "./your-events";
import { MyRestrictions } from "./my-restrictions";

export function EventsClient() {
  const [key, setKey] = useState(0);
  return (
    <div className="space-y-8">
      <MyRestrictions />
      <YourEvents refreshKey={key} />
      <section className="space-y-3" aria-labelledby="add-event">
        <h2 id="add-event" className="text-xl font-bold">
          Add an event
        </h2>
        <EventForm onAdded={() => setKey((k) => k + 1)} />
      </section>
    </div>
  );
}
