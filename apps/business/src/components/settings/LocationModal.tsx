// Add a location (biz-settings 01.1 "Add a location"; not drawn): a name for it and its address,
// or for a service business a city and how far it travels. A modal on the web (?modal=location),
// a sheet on the phone (?sheet=location).

import { useState, type FormEvent } from "react";
import { spotsApi, type CustomersWhere } from "@opencast/contracts";
import { Button, Field, Modal, SelectField, Sheet } from "@opencast/ui";
import { useQueryClient } from "@tanstack/react-query";
import { ApiError, call } from "../../api/client";
import { addressPlace, cityPlace } from "./place";
import "./common.css";
import "./InviteModal.css";

const MILES = [5, 10, 20, 30, 50];

export function LocationModal({ businessId, where, open, onClose, phone }: { businessId: string; where: CustomersWhere; open: boolean; onClose: () => void; phone: boolean }) {
  const qc = useQueryClient();
  const area = where === "service_area";
  const [label, setLabel] = useState("");
  const [text, setText] = useState("");
  const [miles, setMiles] = useState(10);
  const [error, setError] = useState<{ field: "text" | "form"; message: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    const place = area ? cityPlace(text) : addressPlace(text);
    if (!place) return setError({ field: "text", message: area ? "Enter a city in the Inland Empire, like Riverside." : "Enter a street and a city, like 1150 E Washington St, Colton." });
    setBusy(true);
    try {
      await call(spotsApi.addLocation, {
        params: { businessId },
        body: {
          kind: area ? "service_area" : "location",
          ...(label.trim() ? { label: label.trim() } : {}),
          ...(place.streetAddress ? { streetAddress: place.streetAddress } : {}),
          city: place.city,
          latitude: place.latitude,
          longitude: place.longitude,
          ...(area ? { radiusMiles: miles } : {})
        }
      });
      void qc.invalidateQueries({ queryKey: [spotsApi.getBusiness.method, spotsApi.getBusiness.path] });
      setLabel("");
      setText("");
      onClose();
    } catch (err) {
      setError({ field: "form", message: err instanceof ApiError ? err.message : "Something went wrong. Try again." });
    } finally {
      setBusy(false);
    }
  };

  const body = (
    <form id="bz-location" className="bz-invite" onSubmit={save} noValidate>
      <Field label="Name it" labelAside="Optional" placeholder="Colton" value={label} maxLength={80} onChange={(e) => setLabel(e.target.value)} />
      {area ? (
        <div className="bz-invite__two">
          <Field label="City" value={text} onChange={(e) => setText(e.target.value)} error={error?.field === "text" ? error.message : undefined} />
          <SelectField label="Miles around it" value={String(miles)} onChange={(e) => setMiles(Number(e.target.value))}>
            {MILES.map((m) => (
              <option key={m} value={m}>
                {m} miles
              </option>
            ))}
          </SelectField>
        </div>
      ) : (
        <Field
          label="Address"
          labelAside="Private. Stations see the city"
          placeholder="Street and city"
          autoComplete="street-address"
          value={text}
          onChange={(e) => setText(e.target.value)}
          error={error?.field === "text" ? error.message : undefined}
        />
      )}
      {error?.field === "form" && (
        <p className="bz-error" role="alert">
          {error.message}
        </p>
      )}
    </form>
  );
  const footer = (
    <Button variant="primary" type="submit" form="bz-location" block disabled={busy}>
      Add a location
    </Button>
  );
  const props = { open, onClose, title: area ? "Add a service area" : "Add a location", subtitle: "Spots can target it, as they do your first.", footer };
  return phone ? <Sheet {...props}>{body}</Sheet> : <Modal {...props}>{body}</Modal>;
}
