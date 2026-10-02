// Getting started 3 of 3: your first spot (/:businessId/start/spot), the upload in the setup shell.
// No frame draws this step: it's New spot's upload (biz-spots 02.1). Once the file is in, the
// checks, rate and budget carry on in the business shell, where the spot then lives.

import { useNavigate } from "react-router";
import { spotsApi } from "@opencast/contracts";
import { Button, ControlTitle } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { SetupBusiness } from "../../components/money/SetupBusiness";
import { errorText } from "../../components/spots/data";
import { NewSpotForm } from "../../components/spots/NewSpotForm";
import { LoadError } from "../../components/spots/parts";
import { useShellOptions } from "../../layout/shell";
import { Quiet } from "../common";
import "./SpotUpload.css";

export default function StartSpot() {
  useShellOptions({});
  return (
    <SetupBusiness>
      <First />
    </SetupBusiness>
  );
}

function First() {
  const b = useBusiness();
  const navigate = useNavigate();
  const business = useApi(spotsApi.getBusiness, { params: { businessId: b.id } }, { enabled: b.can("advertise") });
  if (!b.can("advertise")) {
    return (
      <div className="bz-startspot">
        <ControlTitle title="Your first spot" description="Spots are made by the owner and managers." />
        <Button href={b.base}>Go to {b.business.name}</Button>
      </div>
    );
  }
  return (
    <div className="bz-startspot">
      <ControlTitle title="Your first spot" description="Upload the finished spot. Opencast checks it will air cleanly and adds its code; then you set a rate and a budget, and stations choose it." />
      {business.data ? (
        <NewSpotForm business={business.data} onDone={(s) => navigate(`${b.base}/spots/${s.id}/setup`)} />
      ) : business.error ? (
        <LoadError message={errorText(business.error)} />
      ) : (
        <Quiet />
      )}
      <p className="bz-startspot__later">
        No spot yet? <a href={`${b.base}/spots`}>Skip this for now</a>. You can make one from Spots, or have a station make one for you.
      </p>
    </div>
  );
}
