// /balance/statements: the newest statement (the Balance page's "Statements, View" can link here).

import { Navigate } from "react-router";
import { ledgerApi } from "@opencast/contracts";
import { Button, ControlTitle } from "@opencast/ui";
import { useApi } from "../../api/hooks";
import { useBusiness } from "../../business/BusinessContext";
import { Quiet } from "../common";
import "./Statement.css";

export default function Statements() {
  const b = useBusiness();
  const list = useApi(ledgerApi.listStatements, { params: { businessId: b.id } });
  if (list.isLoading) return <Quiet />;
  const newest = list.data?.[0];
  if (newest) return <Navigate to={`${b.base}/balance/statements/${newest.id}`} replace />;
  return (
    <div>
      <ControlTitle title="Statements" />
      <p className="bz-stmt__quiet" role={list.error ? "alert" : undefined}>
        {list.error?.message ?? "Your first statement starts with the first money you add."}
      </p>
      <Button size="sm" href={b.can("money") ? `${b.base}/balance` : `${b.base}/results`}>
        {b.can("money") ? "Balance" : "Where it aired"}
      </Button>
    </div>
  );
}
